const { sql, poolPromise } = require("../../../core/config/db");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const { badReq, conflict } = require("../../../core/utils/http-error");
const { formatYMD } = require("../../../core/shared/tutup-transaksi-guard");
const { detectCategory } = require("../bongkar-susun-v2-category-registry");
const { createPartial } = require("../../../core/shared/label-partial.helper");
const {
  parseInputsPartial,
  resolveUsedQty,
} = require("../inputs-partial.helper");

exports.createBongkarSusunFurnitureWip = async (payload, ctx) => {
  const { note, inputs, outputs, inputsPartial } = payload;
  const { actorId, actorUsername, requestId } = ctx;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw badReq("inputs wajib berisi minimal 1 label");
  }
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw badReq("outputs wajib berisi minimal 1 output label");
  }

  for (const code of inputs) {
    if (detectCategory(code) !== "furnitureWip") {
      throw badReq(`Label input ${code} bukan kategori furnitureWip`);
    }
  }

  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i];
    const idJenis = out.idJenis ?? out.idFurnitureWIP;
    if (!idJenis || !Number.isFinite(Number(idJenis)) || Number(idJenis) <= 0) {
      throw badReq(`outputs[${i}].idJenis wajib diisi`);
    }
    if (
      out.pcs == null ||
      !Number.isFinite(Number(out.pcs)) ||
      Number(out.pcs) <= 0
    ) {
      throw badReq(`outputs[${i}].pcs wajib diisi dan lebih dari 0`);
    }
  }

  const partialMap = parseInputsPartial(inputsPartial, inputs);

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    await new sql.Request(tx)
      .input("actorId", sql.Int, actorId)
      .input("rid", sql.NVarChar(64), requestId).query(`
        EXEC sys.sp_set_session_context @key=N'actor_id', @value=@actorId;
        EXEC sys.sp_set_session_context @key=N'request_id', @value=@rid;
      `);

    const inputCodesJson = JSON.stringify(inputs.map((c) => ({ code: c })));

    const inputDataRes = await new sql.Request(tx).input(
      "CodesJson",
      sql.NVarChar(sql.MAX),
      inputCodesJson,
    ).query(`
        SELECT
          f.NoFurnitureWIP,
          f.IdFurnitureWIP,
          f.IsPartial,
          f.IdWarehouse,
          f.IdWarna,
          f.Blok,
          f.IdLokasi,
          CASE
            WHEN ISNULL(f.IsPartial, 0) = 1 THEN
              CASE
                WHEN ISNULL(f.Pcs, 0) - ISNULL(fp.TotalPartialPcs, 0) < 0
                  THEN 0
                ELSE ISNULL(f.Pcs, 0) - ISNULL(fp.TotalPartialPcs, 0)
              END
            ELSE ISNULL(f.Pcs, 0)
          END AS AvailablePcs
        FROM dbo.FurnitureWIP f WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN (
          SELECT NoFurnitureWIP, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
          FROM dbo.FurnitureWIPPartial
          GROUP BY NoFurnitureWIP
        ) fp
          ON fp.NoFurnitureWIP = f.NoFurnitureWIP
        WHERE f.NoFurnitureWIP IN (
          SELECT j.code FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        )
        AND f.DateUsage IS NULL
      `);

    if (inputDataRes.recordset.length !== inputs.length) {
      throw badReq(
        "Satu atau lebih label input tidak ditemukan atau sudah terpakai",
      );
    }

    // pcs yang dipakai siklus ini per label: seluruh sisa pcs, kecuali label
    // yang di-override inputsPartial (operator memilih memakai sebagian dari
    // sisa). Label dengan used < available menyisakan pcs — tidak di-DateUsage.
    const usedByCode = new Map();
    for (const row of inputDataRes.recordset) {
      if (Number(row.AvailablePcs || 0) <= 0) {
        throw badReq(`Label ${row.NoFurnitureWIP} tidak memiliki sisa pcs`);
      }
      usedByCode.set(
        row.NoFurnitureWIP,
        Math.trunc(resolveUsedQty(partialMap, row.NoFurnitureWIP, row.AvailablePcs)),
      );
    }
    const usedPcsOf = (row) => usedByCode.get(row.NoFurnitureWIP);

    const totalPcsInput = inputDataRes.recordset.reduce(
      (sum, row) => sum + usedPcsOf(row),
      0,
    );

    const inputByJenis = {};
    for (const row of inputDataRes.recordset) {
      const k = Number(row.IdFurnitureWIP);
      if (!inputByJenis[k]) {
        inputByJenis[k] = { pcs: 0 };
      }
      inputByJenis[k].pcs += usedPcsOf(row);
    }

    const outputByJenis = {};
    for (const out of outputs) {
      const k = Number(out.idJenis ?? out.idFurnitureWIP);
      if (!outputByJenis[k]) {
        outputByJenis[k] = { pcs: 0 };
      }
      outputByJenis[k].pcs += Number(out.pcs);
    }

    const totalPcsOutput = outputs.reduce(
      (sum, out) => sum + Number(out.pcs),
      0,
    );

    for (const idJenis of Object.keys(outputByJenis)) {
      if (!(idJenis in inputByJenis)) {
        throw badReq(
          `idJenis=${idJenis} pada output tidak ada di input manapun`,
        );
      }
    }

    for (const [idJenis, valInput] of Object.entries(inputByJenis)) {
      const valOutput = outputByJenis[idJenis] || { pcs: 0 };
      if (Math.abs(valInput.pcs - valOutput.pcs) > 0.001) {
        throw badReq(
          `Pcs tidak balance untuk idJenis=${idJenis}: input=${valInput.pcs}, output=${valOutput.pcs}`,
        );
      }
    }

    if (Math.abs(totalPcsInput - totalPcsOutput) > 0.001) {
      throw badReq(
        `Total pcs tidak balance: input=${totalPcsInput}, output=${totalPcsOutput}`,
      );
    }
    const genBg = () =>
      generateNextCode(tx, {
        tableName: "BongkarSusun_h",
        columnName: "NoBongkarSusun",
        prefix: "BG.",
        width: 10,
      });

    let noBongkarSusun = await genBg();
    const bgExist = await new sql.Request(tx)
      .input("No", sql.VarChar(50), noBongkarSusun)
      .query(
        `SELECT 1 FROM dbo.BongkarSusun_h WITH (UPDLOCK,HOLDLOCK) WHERE NoBongkarSusun=@No`,
      );
    if (bgExist.recordset.length > 0) {
      noBongkarSusun = await genBg();
      const bgExist2 = await new sql.Request(tx)
        .input("No", sql.VarChar(50), noBongkarSusun)
        .query(
          `SELECT 1 FROM dbo.BongkarSusun_h WITH (UPDLOCK,HOLDLOCK) WHERE NoBongkarSusun=@No`,
        );
      if (bgExist2.recordset.length > 0) {
        throw conflict("Gagal generate NoBongkarSusun unik, coba lagi");
      }
    }

    const nowDate = new Date();
    await new sql.Request(tx)
      .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
      .input("Tanggal", sql.DateTime, nowDate)
      .input("IdUsername", sql.Int, actorId)
      .input("Note", sql.NVarChar(500), note || null).query(`
        INSERT INTO dbo.BongkarSusun_h (NoBongkarSusun, Tanggal, IdUsername, Note)
        VALUES (@NoBongkarSusun, @Tanggal, @IdUsername, @Note)
      `);

    await new sql.Request(tx)
      .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
      .input("CodesJson", sql.NVarChar(sql.MAX), inputCodesJson).query(`
        INSERT INTO dbo.BongkarSusunInputFurnitureWIP (NoBongkarSusun, NoFurnitureWIP)
        SELECT @NoBongkarSusun, j.code
        FROM OPENJSON(@CodesJson)
        WITH (code varchar(50) '$.code') AS j
      `);

    // Label yang SUDAH pernah dipecah (IsPartial = 1) dan label utuh yang
    // dipakai SEBAGIAN (override inputsPartial) dicatat baris
    // FurnitureWIPPartial baru berisi pcs terpakai + ditautkan ke transaksi
    // ini lewat BongkarSusunInputFurnitureWIPPartial — backlink yang dipakai
    // hapus transaksi untuk mengembalikan pcs. createPartial menandai parent
    // IsPartial = 1 (DateUsage tetap NULL) supaya sisa pcsnya terhitung.
    for (const row of inputDataRes.recordset) {
      const used = usedPcsOf(row);
      const available = Number(row.AvailablePcs || 0);
      const wasPartial = row.IsPartial === true || row.IsPartial === 1;
      if (!wasPartial && used >= available) continue;

      const noFurnitureWIPPartial = await createPartial(
        tx,
        "furniturewip",
        row.NoFurnitureWIP,
        used,
      );

      await new sql.Request(tx)
        .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
        .input(
          "NoFurnitureWIPPartial",
          sql.VarChar(50),
          noFurnitureWIPPartial,
        ).query(`
          INSERT INTO dbo.BongkarSusunInputFurnitureWIPPartial (NoBongkarSusun, NoFurnitureWIPPartial)
          VALUES (@NoBongkarSusun, @NoFurnitureWIPPartial)
        `);
    }

    // Label yang sisa pcs-nya habis terpakai (used == available) ditandai
    // terpakai. Label dengan sisa tersisa (override inputsPartial) TIDAK —
    // sisanya masih bisa dipakai siklus berikutnya.
    const fullyUsedCodes = inputDataRes.recordset
      .filter((row) => usedPcsOf(row) >= Number(row.AvailablePcs || 0))
      .map((row) => ({ code: row.NoFurnitureWIP }));
    if (fullyUsedCodes.length > 0) {
      await new sql.Request(tx)
        .input("Tanggal", sql.Date, nowDate)
        .input(
          "CodesJson",
          sql.NVarChar(sql.MAX),
          JSON.stringify(fullyUsedCodes),
        ).query(`
        UPDATE dbo.FurnitureWIP
        SET DateUsage = @Tanggal
        WHERE NoFurnitureWIP IN (
          SELECT j.code FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        )
        AND DateUsage IS NULL
      `);
    }

    const refRow = inputDataRes.recordset[0];
    const createdOutputs = [];

    for (const out of outputs) {
      const genFw = () =>
        generateNextCode(tx, {
          tableName: "FurnitureWIP",
          columnName: "NoFurnitureWIP",
          prefix: "BB.",
          width: 10,
        });

      let newNoFurnitureWIP = await genFw();
      const exist = await new sql.Request(tx)
        .input("No", sql.VarChar(50), newNoFurnitureWIP)
        .query(
          `SELECT 1 FROM dbo.FurnitureWIP WITH (UPDLOCK,HOLDLOCK) WHERE NoFurnitureWIP=@No`,
        );
      if (exist.recordset.length > 0) {
        newNoFurnitureWIP = await genFw();
        const exist2 = await new sql.Request(tx)
          .input("No", sql.VarChar(50), newNoFurnitureWIP)
          .query(
            `SELECT 1 FROM dbo.FurnitureWIP WITH (UPDLOCK,HOLDLOCK) WHERE NoFurnitureWIP=@No`,
          );
        if (exist2.recordset.length > 0) {
          throw conflict("Gagal generate NoFurnitureWIP unik, coba lagi");
        }
      }

      await new sql.Request(tx)
        .input("NoFurnitureWIP", sql.VarChar(50), newNoFurnitureWIP)
        .input("DateCreate", sql.Date, nowDate)
        .input(
          "IdFurnitureWIP",
          sql.Int,
          Math.trunc(Number(out.idJenis ?? out.idFurnitureWIP)),
        )
        .input("Pcs", sql.Int, Math.trunc(Number(out.pcs)))
        .input("Blok", sql.VarChar(50), refRow.Blok ?? null)
        .input("IdLokasi", sql.Int, refRow.IdLokasi ?? null)
        .input("CreateBy", sql.VarChar(50), actorUsername)
        .input("DateTimeCreate", sql.DateTime, nowDate).query(`
          INSERT INTO dbo.FurnitureWIP (
            NoFurnitureWIP, DateCreate, IdFurnitureWIP, Pcs,
            Blok, IdLokasi, CreateBy, DateTimeCreate
          )
          VALUES (
            @NoFurnitureWIP, @DateCreate, @IdFurnitureWIP, @Pcs,
            @Blok, @IdLokasi, @CreateBy, @DateTimeCreate
          )
        `);

      await new sql.Request(tx)
        .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
        .input("NoFurnitureWIP", sql.VarChar(50), newNoFurnitureWIP).query(`
          INSERT INTO dbo.BongkarSusunOutputFurnitureWIP (NoBongkarSusun, NoFurnitureWIP)
          VALUES (@NoBongkarSusun, @NoFurnitureWIP)
        `);

      createdOutputs.push({
        noFurnitureWIP: newNoFurnitureWIP,
        idJenis: Number(out.idJenis ?? out.idFurnitureWIP),
        pcs: Number(out.pcs),
      });
    }

    await tx.commit();

    return {
      noBongkarSusun,
      tanggal: formatYMD(nowDate),
      category: "furnitureWip",
      totalPcsInput,
      totalPcsOutput,
      inputs,
      outputs: createdOutputs,
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};
