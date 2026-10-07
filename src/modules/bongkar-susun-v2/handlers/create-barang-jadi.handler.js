const { sql, poolPromise } = require("../../../core/config/db");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const { badReq, conflict } = require("../../../core/utils/http-error");
const { formatYMD } = require("../../../core/shared/tutup-transaksi-guard");
const { detectCategory } = require("../bongkar-susun-v2-category-registry");
// Memecah label fisik jadi partial — helper yang sama dipakai penjualan &
// retur-v3, supaya konvensi "sisa pcs = Pcs parent - SUM(partial)" dan
// "parent IsPartial = 1, DateUsage tetap NULL" konsisten di semua modul.
const { createPartial } = require("../../../core/shared/label-partial.helper");
const {
  parseInputsPartial,
  resolveUsedQty,
} = require("../inputs-partial.helper");

const CATEGORY = "barangjadi";

exports.createBongkarSusunBarangJadi = async (payload, ctx) => {
  const { note, inputs, outputs, inputsPartial } = payload;
  const { actorId, actorUsername, requestId } = ctx;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw badReq("inputs wajib berisi minimal 1 label");
  }
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw badReq("outputs wajib berisi minimal 1 output label");
  }

  for (const code of inputs) {
    if (detectCategory(code) !== "barangJadi") {
      throw badReq(`Label input ${code} bukan kategori barangJadi`);
    }
  }

  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i];
    const idJenis = out.idJenis ?? out.idBJ;
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
          b.NoBJ,
          b.IdBJ,
          b.IsPartial,
          b.IdWarehouse,
          b.Blok,
          b.IdLokasi,
          ISNULL(b.Pcs, 0) AS ParentPcs,
          -- Sisa pcs yang masih boleh dipakai. Rumus & gate IsPartial sama
          -- dengan furnitureWip (create-furniture-wip.handler.js), jadi angka
          -- yang dilihat operator saat scan = angka yang dipakai di sini.
          CASE
            WHEN ISNULL(b.IsPartial, 0) = 1 THEN
              CASE
                WHEN ISNULL(b.Pcs, 0) - ISNULL(bjp.TotalPartialPcs, 0) < 0
                  THEN 0
                ELSE ISNULL(b.Pcs, 0) - ISNULL(bjp.TotalPartialPcs, 0)
              END
            ELSE ISNULL(b.Pcs, 0)
          END AS AvailablePcs
        FROM dbo.BarangJadi b WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN (
          SELECT NoBJ, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
          FROM dbo.BarangJadiPartial WITH (UPDLOCK, HOLDLOCK)
          GROUP BY NoBJ
        ) bjp ON bjp.NoBJ = b.NoBJ
        WHERE b.NoBJ IN (
          SELECT j.code FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        )
        AND b.DateUsage IS NULL
    `);

    if (inputDataRes.recordset.length !== inputs.length) {
      throw badReq(
        "Satu atau lebih label input tidak ditemukan atau sudah terpakai",
      );
    }

    // Label yang sudah pernah dipecah (IsPartial = 1) boleh dipakai, tapi
    // hanya sebesar sisa pcs-nya — pcs yang sudah dialokasikan ke partial
    // lain (penjualan/retur-v3/bongkar-susun sebelumnya) tidak boleh ikut
    // dibongkar lagi. Sisa pcs dihitung dengan rumus yang sama dipakai
    // label-service & penjualan: Pcs parent - SUM(BarangJadiPartial.Pcs).
    for (const row of inputDataRes.recordset) {
      if (Number(row.AvailablePcs || 0) <= 0) {
        throw badReq(
          `Label ${row.NoBJ} sudah habis pcs-nya (sisa 0 pcs), tidak bisa dibongkar susun`,
        );
      }
    }

// pcs yang dipakai siklus ini per label: seluruh sisa pcs, kecuali label
    // yang di-override inputsPartial (operator memilih memakai sebagian dari
    // sisa). Label dengan used < available menyisakan pcs — tidak di-DateUsage.
    const usedByCode = new Map();
    for (const row of inputDataRes.recordset) {
      usedByCode.set(
        row.NoBJ,
        Math.trunc(resolveUsedQty(partialMap, row.NoBJ, row.AvailablePcs)),
      );
    }
    const usedPcsOf = (row) => usedByCode.get(row.NoBJ);

    const totalPcsInput = inputDataRes.recordset.reduce(
      (sum, row) => sum + usedPcsOf(row),
      0,
    );

    const refRow = inputDataRes.recordset[0];
    const refIdBJ = Number(refRow.IdBJ);

    for (const row of inputDataRes.recordset) {
      if (Number(row.IdBJ) !== refIdBJ) {
        throw badReq("Semua input barangJadi harus memiliki IdBJ yang sama");
      }
    }

    const inputByJenis = {};
    for (const row of inputDataRes.recordset) {
      const k = refIdBJ;
      if (!inputByJenis[k]) inputByJenis[k] = { pcs: 0 };
      inputByJenis[k].pcs += usedPcsOf(row);
    }

    const outputByJenis = {};
    for (const out of outputs) {
      const k = Number(out.idJenis ?? out.idBJ);
      if (k !== refIdBJ) {
        throw badReq(
          `outputs.idJenis harus sama dengan IdBJ input (${refIdBJ})`,
        );
      }
      if (!outputByJenis[k]) outputByJenis[k] = { pcs: 0 };
      outputByJenis[k].pcs += Number(out.pcs);
    }

    const totalPcsOutput = outputs.reduce(
      (sum, out) => sum + Number(out.pcs),
      0,
    );

    for (const idJenis of Object.keys(outputByJenis)) {
      if (!(idJenis in inputByJenis)) {
        throw badReq(`idBJ=${idJenis} pada output tidak ada di input manapun`);
      }
    }

    for (const [idJenis, valInput] of Object.entries(inputByJenis)) {
      const valOutput = outputByJenis[idJenis] || { pcs: 0 };
      if (Math.abs(valInput.pcs - valOutput.pcs) > 0.001) {
        throw badReq(
          `Pcs tidak balance untuk idBJ=${idJenis}: input=${valInput.pcs}, output=${valOutput.pcs}`,
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

// Tabel input hanya menyimpan labelnya. Pcs yang terpakai + kode partial
    // dicatat di tabel link BongkarSusunInputBarangJadiPartial — struktur yang
    // sama dengan furnitureWip/mixer, dipakai query balance & join partial di
    // detail.
    //
    // Baris BarangJadiPartial dibuat untuk dua kasus:
    //  - label yang SUDAH pernah dipecah (sisa pcs < Pcs asli): sisa pcs yang
    //    dipakai siklus ini dicatat sebagai baris baru.
    //  - label utuh yang hanya dipakai SEBAGIAN (override inputsPartial).
    // Label utuh yang dipakai penuh TIDAK dapat baris partial — konsumsi penuh,
    // konvensi yang sama dipakai penjualan.
    const createdPartials = [];
    // Label yang dicatat lewat tabel partial TIDAK ikut masuk ke
    // BongkarSusunInputBarangJadi — satu label hanya ada di salah satu tabel.
    const partialLabelCodes = new Set();

    for (const row of inputDataRes.recordset) {
      const availablePcs = Number(row.AvailablePcs || 0);
      const parentPcs = Number(row.ParentPcs || 0);
      const usedPcs = usedPcsOf(row);
      const wasPartial = parentPcs > availablePcs;

      if (wasPartial || usedPcs < availablePcs) {
        const noBJPartial = await createPartial(
          tx,
          CATEGORY,
          row.NoBJ,
          Math.trunc(usedPcs),
        );

        await new sql.Request(tx)
          .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
          .input("NoBJPartial", sql.VarChar(50), noBJPartial)
          .query(`
            INSERT INTO dbo.BongkarSusunInputBarangjadiPartial (NoBongkarSusun, NoBJPartial)
            VALUES (@NoBongkarSusun, @NoBJPartial)
          `);

        partialLabelCodes.add(row.NoBJ);
        createdPartials.push({
          labelCode: row.NoBJ,
          noBJPartial,
          pcs: Math.trunc(usedPcs),
          totalPcs: parentPcs,
        });
      }
    }

    // Hanya label yang dipakai penuh (tanpa baris partial) yang masuk sini.
    const fullInputCodes = inputs.filter((c) => !partialLabelCodes.has(c));
    if (fullInputCodes.length > 0) {
      await new sql.Request(tx)
        .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
        .input(
          "CodesJson",
          sql.NVarChar(sql.MAX),
          JSON.stringify(fullInputCodes.map((c) => ({ code: c }))),
        ).query(`
          INSERT INTO dbo.BongkarSusunInputBarangjadi (NoBongkarSusun, NoBJ)
          SELECT @NoBongkarSusun, j.code
          FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        `);
    }

// Label yang sisa pcs-nya habis terpakai (used == available) ditandai
    // terpakai. Label dengan sisa tersisa (override inputsPartial) TIDAK —
    // sisanya masih bisa dipakai siklus berikutnya. Baris partial milik
    // penjualan/retur-v3/siklus sebelumnya TIDAK dihapus di sini.
    const fullyUsedCodes = inputDataRes.recordset
      .filter((row) => usedPcsOf(row) >= Number(row.AvailablePcs || 0))
      .map((row) => ({ code: row.NoBJ }));
    if (fullyUsedCodes.length > 0) {
      await new sql.Request(tx)
        .input("Tanggal", sql.Date, nowDate)
        .input(
          "CodesJson",
          sql.NVarChar(sql.MAX),
          JSON.stringify(fullyUsedCodes),
).query(`
        UPDATE dbo.BarangJadi
        SET DateUsage = @Tanggal
        WHERE NoBJ IN (
          SELECT j.code FROM OPENJSON(@CodesJson)
          WITH (code varchar(50) '$.code') AS j
        )
        AND DateUsage IS NULL
      `);
    }

    const createdOutputs = [];

    for (const out of outputs) {
      const genBj = () =>
        generateNextCode(tx, {
          tableName: "BarangJadi",
          columnName: "NoBJ",
          prefix: "BA.",
          width: 10,
        });

      let newNoBJ = await genBj();
      const exist = await new sql.Request(tx)
        .input("No", sql.VarChar(50), newNoBJ)
        .query(
          `SELECT 1 FROM dbo.BarangJadi WITH (UPDLOCK,HOLDLOCK) WHERE NoBJ=@No`,
        );
      if (exist.recordset.length > 0) {
        newNoBJ = await genBj();
        const exist2 = await new sql.Request(tx)
          .input("No", sql.VarChar(50), newNoBJ)
          .query(
            `SELECT 1 FROM dbo.BarangJadi WITH (UPDLOCK,HOLDLOCK) WHERE NoBJ=@No`,
          );
        if (exist2.recordset.length > 0) {
          throw conflict("Gagal generate NoBJ unik, coba lagi");
        }
      }

      await new sql.Request(tx)
        .input("NoBJ", sql.VarChar(50), newNoBJ)
        .input("DateCreate", sql.Date, nowDate)
        .input("Jam", sql.VarChar(20), null)
        .input("Pcs", sql.Int, Math.trunc(Number(out.pcs)))
        .input("IdBJ", sql.Int, refIdBJ)
        .input("Berat", sql.Decimal(18, 3), 0)
        .input("IsPartial", sql.Bit, 0)
        .input("DateUsage", sql.Date, null)
        .input("IdWarehouse", sql.Int, refRow.IdWarehouse ?? null)
        .input("CreateBy", sql.VarChar(50), actorUsername)
        .input("DateTimeCreate", sql.DateTime, nowDate)
        .input("Blok", sql.VarChar(50), refRow.Blok ?? null)
        .input("IdLokasi", sql.Int, refRow.IdLokasi ?? null).query(`
          INSERT INTO dbo.BarangJadi (
            NoBJ, DateCreate, Jam, Pcs, IdBJ, Berat, IsPartial, DateUsage,
            IdWarehouse, CreateBy, DateTimeCreate, Blok, IdLokasi
          )
          VALUES (
            @NoBJ, @DateCreate, @Jam, @Pcs, @IdBJ, @Berat, @IsPartial, @DateUsage,
            @IdWarehouse, @CreateBy, @DateTimeCreate, @Blok, @IdLokasi
          )
        `);

      await new sql.Request(tx)
        .input("NoBongkarSusun", sql.VarChar(50), noBongkarSusun)
        .input("NoBJ", sql.VarChar(50), newNoBJ).query(`
          INSERT INTO dbo.BongkarSusunOutputBarangjadi (NoBongkarSusun, NoBJ)
          VALUES (@NoBongkarSusun, @NoBJ)
        `);

      createdOutputs.push({
        noBJ: newNoBJ,
        idJenis: Number(out.idJenis ?? out.idBJ),
        pcs: Number(out.pcs),
      });
    }

    await tx.commit();

    return {
      noBongkarSusun,
      tanggal: formatYMD(nowDate),
      category: "barangJadi",
      totalPcsInput,
      totalPcsOutput,
      inputs,
      outputs: createdOutputs,
      // Input yang pemakaiannya tercatat sebagai baris BarangJadiPartial
      // (label yang sudah pernah dipecah sebelumnya).
      partials: createdPartials,
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};
