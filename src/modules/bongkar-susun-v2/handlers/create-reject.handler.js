const { sql, poolPromise } = require("../../../core/config/db");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const { badReq, conflict } = require("../../../core/utils/http-error");
const { formatYMD } = require("../../../core/shared/tutup-transaksi-guard");
const { detectCategory } = require("../bongkar-susun-v2-category-registry");
const {
  parseInputsPartial,
  resolveUsedQty,
} = require("../inputs-partial.helper");

// Kategori reject (BF.) tidak ber-sak: satu output = satu label RejectV2
// dengan satu berat. Mirip create-gilingan (satu label per output), ditambah
// dukungan input partial: label reject boleh dipakai sebagian lewat
// inputsPartial [{ labelCode, qty }] (qty = kg). Berat yang dipakai dicatat
// sebagai baris baru di dbo.RejectV2Partial (prefix "BK.") yang ditautkan
// lewat dbo.BongkarSusunInputRejectPartial, supaya labelnya bisa dipecah lagi
// di bongkar-susun berikutnya maupun di produksi broker/crusher/gilingan.
//
// Label yang dipakai penuh (tidak ada sisa berat setelah pengurangan semua
// partial, termasuk partial milik transaksi ini) baru di-DateUsage; label
// yang masih menyisakan berat tetap DateUsage NULL.
exports.createBongkarSusunReject = async (payload, ctx) => {
  const { note, inputs, outputs, inputsPartial } = payload;
  const { actorId, actorUsername, requestId } = ctx;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw badReq("inputs wajib berisi minimal 1 label");
  }
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw badReq("outputs wajib berisi minimal 1 output label");
  }

  for (const code of inputs) {
    if (detectCategory(code) !== "reject") {
      throw badReq(`Label input ${code} bukan kategori reject`);
    }
  }

  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i];
    const idJenis = out.idJenis ?? out.idReject;
    if (!idJenis || !Number.isFinite(Number(idJenis)) || Number(idJenis) <= 0) {
      throw badReq(`outputs[${i}].idJenis wajib diisi`);
    }
    if (
      out.berat == null ||
      !Number.isFinite(Number(out.berat)) ||
      Number(out.berat) <= 0
    ) {
      throw badReq(`outputs[${i}].berat wajib diisi dan lebih dari 0`);
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

    const inputDataRes = await new sql.Request(tx)
      .input("CodesJson", sql.NVarChar(sql.MAX), inputCodesJson)
      .query(`
        SELECT
          r.NoReject,
          r.IdReject,
          r.IdWarehouse,
          CONVERT(varchar(8), r.Jam, 108) AS Jam,
          r.Blok,
          r.IdLokasi,
          ISNULL(r.Berat, 0) AS Berat,
          ISNULL(rp.TotalPartialBerat, 0) AS TotalPartialBerat
        FROM dbo.RejectV2 r WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN (
          SELECT NoReject, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
          FROM dbo.RejectV2Partial
          GROUP BY NoReject
        ) rp ON rp.NoReject = r.NoReject
        WHERE r.NoReject IN (
          SELECT j.code FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        )
        AND r.DateUsage IS NULL
      `);

    if (inputDataRes.recordset.length !== inputs.length) {
      throw badReq(
        "Satu atau lebih label input tidak ditemukan atau sudah terpakai",
      );
    }

    // Sisa berat per label = Berat - total partial (partial dari modul mana pun).
    // Dipakai penuh kecuali di-override inputsPartial.
    const usedByLabel = new Map();
    const inputByJenis = {};
    for (const row of inputDataRes.recordset) {
      const available =
        Number(row.Berat || 0) - Number(row.TotalPartialBerat || 0);
      const usable = available > 0 ? available : 0;
      const used = resolveUsedQty(partialMap, row.NoReject, usable);
      if (used <= 0) {
        throw badReq(
          `Label ${row.NoReject} sudah habis, tidak ada berat tersisa`,
        );
      }
      usedByLabel.set(row.NoReject, used);
      const k = Number(row.IdReject);
      inputByJenis[k] = (inputByJenis[k] || 0) + used;
    }

    const outputByJenis = {};
    for (const out of outputs) {
      const k = Number(out.idJenis ?? out.idReject);
      outputByJenis[k] = (outputByJenis[k] || 0) + Number(out.berat);
    }

    const totalBeratInput = Array.from(usedByLabel.values()).reduce(
      (s, v) => s + v,
      0,
    );
    const totalBeratOutput = outputs.reduce(
      (sum, out) => sum + Number(out.berat),
      0,
    );

    for (const idJenis of Object.keys(outputByJenis)) {
      if (!(idJenis in inputByJenis)) {
        throw badReq(
          `idJenis=${idJenis} pada output tidak ada di input manapun`,
        );
      }
    }

    for (const [idJenis, beratInput] of Object.entries(inputByJenis)) {
      const beratOutput = outputByJenis[idJenis] || 0;
      if (Math.abs(beratInput - beratOutput) > 0.001) {
        throw badReq(
          `Berat tidak balance untuk idJenis=${idJenis}: input=${beratInput}kg, output=${beratOutput}kg`,
        );
      }
    }

    if (Math.abs(totalBeratInput - totalBeratOutput) > 0.001) {
      throw badReq(
        `Total berat tidak balance: input=${totalBeratInput}kg, output=${totalBeratOutput}kg`,
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
        INSERT INTO dbo.BongkarSusunInputReject (NoBongkarSusun, NoReject)
        SELECT @NoBongkarSusun, j.code
        FROM OPENJSON(@CodesJson)
        WITH (code varchar(50) '$.code') AS j
      `);

    // Baris RejectV2Partial dicatat untuk label yang dipakai sebagian ATAU
    // label yang sudah pernah dipecah (supaya berat siklus ini punya jejak
    // yang bisa dihapus balik saat transaksi dihapus). Label utuh yang sekali
    // pakai penuh tidak butuh baris partial.
    const genRejectPartial = () =>
      generateNextCode(tx, {
        tableName: "RejectV2Partial",
        columnName: "NoRejectPartial",
        prefix: "BK.",
        width: 10,
      });

    const createdPartials = [];
    for (const row of inputDataRes.recordset) {
      const available =
        Number(row.Berat || 0) - Number(row.TotalPartialBerat || 0);
      const usable = available > 0 ? available : 0;
      const used = usedByLabel.get(row.NoReject);
      const wasPartial = Number(row.TotalPartialBerat || 0) > 0;
      if (!wasPartial && used >= usable - 0.001) continue;

      let noRejectPartial = await genRejectPartial();
      const partialExist = await new sql.Request(tx)
        .input("No", sql.VarChar(50), noRejectPartial)
        .query(
          `SELECT 1 FROM dbo.RejectV2Partial WITH (UPDLOCK,HOLDLOCK) WHERE NoRejectPartial=@No`,
        );
      if (partialExist.recordset.length > 0) {
        noRejectPartial = await genRejectPartial();
        const partialExist2 = await new sql.Request(tx)
          .input("No", sql.VarChar(50), noRejectPartial)
          .query(
            `SELECT 1 FROM dbo.RejectV2Partial WITH (UPDLOCK,HOLDLOCK) WHERE NoRejectPartial=@No`,
          );
        if (partialExist2.recordset.length > 0) {
          throw conflict("Gagal generate NoRejectPartial unik, coba lagi");
        }
      }

      await new sql.Request(tx)
        .input("NoRejectPartial", sql.VarChar(50), noRejectPartial)
        .input("NoReject", sql.VarChar(50), row.NoReject)
        .input("Berat", sql.Decimal(18, 3), Number(used)).query(`
          INSERT INTO dbo.RejectV2Partial (NoRejectPartial, NoReject, Berat)
          VALUES (@NoRejectPartial, @NoReject, @Berat)
        `);

      await new sql.Request(tx)
        .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
        .input("NoRejectPartial", sql.VarChar(50), noRejectPartial).query(`
          INSERT INTO dbo.BongkarSusunInputRejectPartial (NoBongkarSusun, NoRejectPartial)
          VALUES (@NoBongkarSusun, @NoRejectPartial)
        `);

      createdPartials.push({
        noRejectPartial,
        noReject: row.NoReject,
        berat: Number(used),
      });

      await new sql.Request(tx)
        .input("NoReject", sql.VarChar(50), row.NoReject).query(`
          UPDATE dbo.RejectV2
          SET IsPartial = 1
          WHERE NoReject = @NoReject
        `);
    }

    // Tandai terpakai hanya label yang benar-benar habis: sisa berat
    // (setelah semua partial, termasuk yang dibuat transaksi ini) <= 0.
    await new sql.Request(tx)
      .input("Tanggal", sql.Date, nowDate)
      .input("CodesJson", sql.NVarChar(sql.MAX), inputCodesJson).query(`
        UPDATE r
        SET DateUsage = @Tanggal
        FROM dbo.RejectV2 r
        LEFT JOIN (
          SELECT NoReject, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
          FROM dbo.RejectV2Partial
          GROUP BY NoReject
        ) rp ON rp.NoReject = r.NoReject
        WHERE r.NoReject IN (
          SELECT j.code FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        )
        AND r.DateUsage IS NULL
        AND (ISNULL(r.Berat, 0) - ISNULL(rp.TotalPartialBerat, 0)) <= 0
      `);

    const refRow = inputDataRes.recordset[0];
    const createdOutputs = [];

    for (const out of outputs) {
      const genReject = () =>
        generateNextCode(tx, {
          tableName: "RejectV2",
          columnName: "NoReject",
          prefix: "BF.",
          width: 10,
        });

      let newNoReject = await genReject();
      const exist = await new sql.Request(tx)
        .input("No", sql.VarChar(50), newNoReject)
        .query(
          `SELECT 1 FROM dbo.RejectV2 WITH (UPDLOCK,HOLDLOCK) WHERE NoReject=@No`,
        );
      if (exist.recordset.length > 0) {
        newNoReject = await genReject();
        const exist2 = await new sql.Request(tx)
          .input("No", sql.VarChar(50), newNoReject)
          .query(
            `SELECT 1 FROM dbo.RejectV2 WITH (UPDLOCK,HOLDLOCK) WHERE NoReject=@No`,
          );
        if (exist2.recordset.length > 0) {
          throw conflict("Gagal generate NoReject unik, coba lagi");
        }
      }

      await new sql.Request(tx)
        .input("NoReject", sql.VarChar(50), newNoReject)
        .input("IdReject", sql.Int, Math.trunc(Number(out.idJenis ?? out.idReject)))
        .input("DateCreate", sql.Date, nowDate)
        .input("IdWarehouse", sql.Int, refRow.IdWarehouse)
        .input("Berat", sql.Decimal(18, 3), Number(out.berat))
        .input("Jam", sql.VarChar(8), refRow.Jam ?? null)
        .input("CreateBy", sql.VarChar(50), actorUsername)
        .input("DateTimeCreate", sql.DateTime, nowDate)
        .input("IsPartial", sql.Bit, 0)
        .input("Blok", sql.VarChar(50), refRow.Blok ?? null)
        .input("IdLokasi", sql.Int, refRow.IdLokasi ?? null).query(`
          INSERT INTO dbo.RejectV2 (
            NoReject, IdReject, DateCreate, DateUsage, IdWarehouse,
            Berat, Jam, CreateBy, DateTimeCreate, IsPartial, Blok, IdLokasi
          )
          VALUES (
            @NoReject, @IdReject, @DateCreate, NULL, @IdWarehouse,
            @Berat, @Jam, @CreateBy, @DateTimeCreate, @IsPartial, @Blok, @IdLokasi
          )
        `);

      await new sql.Request(tx)
        .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
        .input("NoReject", sql.VarChar(50), newNoReject).query(`
          INSERT INTO dbo.BongkarSusunOutputReject (NoBongkarSusun, NoReject)
          VALUES (@NoBongkarSusun, @NoReject)
        `);

      createdOutputs.push({
        noReject: newNoReject,
        idJenis: Number(out.idJenis ?? out.idReject),
        berat: Number(out.berat),
      });
    }

    await tx.commit();

    return {
      noBongkarSusun,
      tanggal: formatYMD(nowDate),
      category: "reject",
      totalBeratInput,
      totalBeratOutput,
      inputs,
      inputsPartial: createdPartials.length > 0 ? createdPartials : undefined,
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