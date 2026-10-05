// penerimaan-bahan-baku-service.js
const { sql, poolPromise } = require("../../../core/config/db");
const { generateNextCode } = require("../../../core/utils/sequence-code-helper");
const { badReq, notFound, conflict } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  assertNotLocked,
  loadDocDateOnlyFromConfig,
  toDateOnly,
} = require("../../../core/shared/tutup-transaksi-guard");

// Kode kategori bahan baku yang didukung modul Penerimaan Bahan Baku,
// dan prefix label-nya di-resolve dinamis dari dbo.MstKategori (bukan
// di-hardcode) — lihat resolveKategoriPrefix(). Berdasarkan data MstKategori
// aktual: KodeKategori "bahanbaku" (NamaKategori "Bahan Baku", generik —
// dipakai sebagai alur "Proses") punya PrefixLabel "A.", sedangkan
// "bahanbakupakai" ("Bahan Baku Pakai") punya PrefixLabel "AB.".
const SUPPORTED_KODE_KATEGORI = new Set(["bahanbaku", "bahanbakupakai"]);

/// Ambil PrefixLabel dari dbo.MstKategori untuk sebuah KodeKategori.
/// [runner] boleh berupa pool (read-only, mis. saat list) atau transaksi
/// (mis. saat create, supaya ikut serialisasi transaksi yang sama).
async function resolveKategoriPrefix(runner, kodeKategori) {
  const result = await new sql.Request(runner)
    .input("KodeKategori", sql.VarChar(50), kodeKategori)
    .query(`
      SELECT PrefixLabel
      FROM dbo.MstKategori
      WHERE KodeKategori = @KodeKategori AND ISNULL(Enable, 1) = 1
    `);

  const prefix = result.recordset[0]?.PrefixLabel;
  if (!prefix) {
    throw badReq(`Kategori "${kodeKategori}" tidak ditemukan atau tidak aktif di MstKategori`);
  }
  return prefix;
}

function normalizeSaks(saks, palletIndex) {
  if (!Array.isArray(saks) || saks.length === 0) {
    throw badReq(`pallets[${palletIndex}].saks wajib berisi minimal 1 sak`);
  }

  const seen = new Set();
  return saks.map((sak, sakIndex) => {
    const noSak = Number.parseInt(sak?.noSak, 10);
    const berat = Number(sak?.berat);

    if (!Number.isFinite(noSak) || noSak <= 0) {
      throw badReq(`pallets[${palletIndex}].saks[${sakIndex}].noSak wajib valid`);
    }
    if (!Number.isFinite(berat) || berat <= 0) {
      throw badReq(`pallets[${palletIndex}].saks[${sakIndex}].berat wajib valid`);
    }

    // Opsional (form timbangan web): berat asli timbangan + status lembab.
    // Tanpa beratAct (alur tablet) perilaku lama dipertahankan.
    const beratActRaw = sak?.beratAct;
    const beratAct =
      beratActRaw == null || beratActRaw === "" ? null : Number(beratActRaw);
    if (beratAct !== null && (!Number.isFinite(beratAct) || beratAct <= 0)) {
      throw badReq(`pallets[${palletIndex}].saks[${sakIndex}].beratAct wajib valid`);
    }
    const isLembab = sak?.isLembab === true || sak?.isLembab === 1 ? 1 : 0;

    const key = String(noSak);
    if (seen.has(key)) {
      throw badReq(`noSak duplikat di pallets[${palletIndex}]: ${sak.noSak}`);
    }
    seen.add(key);

    return {
      NoSak: Math.trunc(noSak),
      Berat: berat,
      BeratAct: beratAct,
      IsLembab: isLembab,
    };
  });
}

// Aturan potongan berat supplier (meniru FrmBahanBakuv2.BtnTambahDetail_Click):
//  - MstSupplier.Potongan terisi -> persen tetap = floor(Potongan) / 10
//  - kosong -> persen acak di [Min..Max] dari MinMaxBahanBaku (bilangan bulat
//    Min..Max, lalu dibagi 10)
// Berat tersimpan = BeratAct * (1 - persen / 100).
async function getPotonganRule(runner, idSupplier) {
  const sup = await new sql.Request(runner)
    .input("IdSupplier", sql.Int, idSupplier)
    .query(`SELECT Potongan FROM dbo.MstSupplier WHERE IdSupplier = @IdSupplier`);
  const row = sup.recordset[0];
  if (!row) throw badReq(`Supplier ${idSupplier} tidak ditemukan`);

  if (row.Potongan != null) {
    return { mode: "tetap", percent: Math.floor(Number(row.Potongan)) / 10 };
  }

  const mm = await new sql.Request(runner).query(
    `SELECT TOP 1 [Min] AS Lower, [Max] AS Upper FROM dbo.MinMaxBahanBaku`,
  );
  const lower = Number(mm.recordset[0]?.Lower ?? 0);
  const upper = Number(mm.recordset[0]?.Upper ?? 0);
  return {
    mode: "acak",
    lower,
    upper,
    minPercent: lower / 10,
    maxPercent: upper / 10,
  };
}

// Server tidak mengundi angka acak; klien mengundi dari rentang yang
// disediakan getPotonganRule, server hanya memastikan hasilnya masuk rentang.
function assertBeratSesuaiPotongan(sak, rule, palletIndex, sakIndex) {
  if (sak.BeratAct == null) return;
  const lowPct = rule.mode === "acak" ? rule.minPercent : rule.percent;
  const highPct = rule.mode === "acak" ? rule.maxPercent : rule.percent;
  const tol = 0.011; // pembulatan 2 desimal
  const lo = sak.BeratAct * (1 - highPct / 100) - tol;
  const hi = sak.BeratAct * (1 - lowPct / 100) + tol;
  if (sak.Berat < lo || sak.Berat > hi) {
    throw badReq(
      `pallets[${palletIndex}].saks[${sakIndex}].berat tidak sesuai aturan potongan supplier`,
    );
  }
}

function normalizePallets(pallets) {
  if (!Array.isArray(pallets) || pallets.length === 0) {
    throw badReq("pallets wajib berisi minimal 1 pallet");
  }

  return pallets.map((p, i) => {
    const idJenisPlastik = Number(p?.idJenisPlastik);
    if (!Number.isInteger(idJenisPlastik) || idJenisPlastik <= 0) {
      throw badReq(`pallets[${i}].idJenisPlastik wajib diisi`);
    }

    return {
      idJenisPlastik,
      idWarehouse: p.idWarehouse != null ? Number(p.idWarehouse) : null,
      keterangan: p.keterangan != null ? String(p.keterangan).trim() || null : null,
      idStatus: p.idStatus != null ? Number(p.idStatus) : 1,
      moisture: p.moisture != null ? Number(p.moisture) : null,
      meltingIndex: p.meltingIndex != null ? Number(p.meltingIndex) : null,
      elasticity: p.elasticity != null ? Number(p.elasticity) : null,
      tenggelam: p.tenggelam != null ? Number(p.tenggelam) : null,
      density: p.density != null ? Number(p.density) : null,
      density2: p.density2 != null ? Number(p.density2) : null,
      density3: p.density3 != null ? Number(p.density3) : null,
      blok: p.blok ? String(p.blok).trim() : "BSS",
      idLokasi: p.idLokasi != null ? Number(p.idLokasi) : 1,
      saks: normalizeSaks(p.saks, i),
    };
  });
}

function validateHeaderPayload(payload) {
  const tglPenerimaan = String(payload?.tglPenerimaan || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tglPenerimaan)) {
    throw badReq("tglPenerimaan wajib diisi dengan format YYYY-MM-DD");
  }

  const idTim = Number(payload?.idTim);
  if (!Number.isInteger(idTim) || idTim <= 0) {
    throw badReq("idTim wajib diisi");
  }

  return { tglPenerimaan, idTim };
}

function validateAddPalletsPayload(payload) {
  const idSupplier = Number(payload?.idSupplier);
  if (!Number.isInteger(idSupplier) || idSupplier <= 0) {
    throw badReq("idSupplier wajib diisi");
  }

  const noPlat = payload?.noPlat ? String(payload.noPlat).trim() || null : null;

  const kodeKategori = String(payload?.kodeKategori || payload?.kategori || "")
    .trim()
    .toLowerCase();
  if (!SUPPORTED_KODE_KATEGORI.has(kodeKategori)) {
    throw badReq(
      `kodeKategori tidak valid: ${payload?.kodeKategori}. Gunakan salah satu dari: ${[...SUPPORTED_KODE_KATEGORI].join(", ")}`,
    );
  }

  const pallets = normalizePallets(payload?.pallets);

  return { idSupplier, noPlat, kodeKategori, pallets };
}

async function generateUniqueCode(tx, opts) {
  let code = await generateNextCode(tx, opts);
  const existing = await new sql.Request(tx)
    .input("Code", sql.VarChar(50), code)
    .query(`SELECT 1 FROM ${opts.tableName} WITH (UPDLOCK, HOLDLOCK) WHERE ${opts.columnName} = @Code`);

  if (existing.recordset.length > 0) {
    code = await generateNextCode(tx, opts);
    const existing2 = await new sql.Request(tx)
      .input("Code", sql.VarChar(50), code)
      .query(`SELECT 1 FROM ${opts.tableName} WITH (UPDLOCK, HOLDLOCK) WHERE ${opts.columnName} = @Code`);
    if (existing2.recordset.length > 0) {
      throw conflict(`Gagal generate ${opts.columnName} unik, coba lagi`);
    }
  }

  return code;
}

async function assertTimAktif(tx, idTim) {
  const result = await new sql.Request(tx)
    .input("IdTim", sql.Int, idTim)
    .query(`SELECT Aktif FROM dbo.MstTimPenerimaan WHERE IdTim = @IdTim AND TipeModul = 'BAHAN_BAKU'`);

  const row = result.recordset[0];
  if (!row) {
    throw badReq(`IdTim ${idTim} tidak ditemukan`);
  }
  if (!row.Aktif) {
    throw badReq(`Tim penerimaan bahan baku dengan IdTim ${idTim} sedang tidak aktif`);
  }
}

// ==========================================
//  FASE 1: CREATE HEADER (analog WashingProduksi_h create)
//  POST /api/penerimaan-bahan-baku
//  Hanya membuat baris dokumen — belum ada pallet/isi sama sekali.
//  Kategori/Supplier/No Plat/pallet baru diisi di fase 2 (addPallets),
//  bisa dipanggil lebih dari sekali (satu kali per section Pakai/Proses)
//  untuk NoPenerimaan yang sama.
// ==========================================
async function createHeaderPenerimaanBahanBaku(payload, ctx) {
  const v = validateHeaderPayload(payload);
  const { actorId, actorUsername, requestId } = ctx || {};

  if (!actorId) {
    throw badReq("actorId kosong / tidak valid. Controller harus inject actorId dari token.");
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const audit = await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    const docDateOnly = toDateOnly(v.tglPenerimaan);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "create PenerimaanBahanBaku (header)",
      useLock: true,
    });

    await assertTimAktif(tx, v.idTim);

    const noPenerimaan = await generateUniqueCode(tx, {
      tableName: "dbo.PenerimaanBahanBaku_h",
      columnName: "NoPenerimaan",
      prefix: "PB.",
      width: 10,
    });

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), noPenerimaan)
      .input("TglPenerimaan", sql.Date, v.tglPenerimaan)
      .input("IdTim", sql.Int, v.idTim)
      .input("CreateBy", sql.VarChar(100), actorUsername || null)
      .query(`
        INSERT INTO dbo.PenerimaanBahanBaku_h
          (NoPenerimaan, TglPenerimaan, IdTim, CreateBy)
        VALUES
          (@NoPenerimaan, @TglPenerimaan, @IdTim, @CreateBy)
      `);

    await tx.commit();

    return {
      noPenerimaan,
      tglPenerimaan: v.tglPenerimaan,
      idTim: v.idTim,
      audit: { actorId: audit.actorId, requestId: audit.requestId },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

// ==========================================
//  FASE 2: ADD PALLETS ke NoPenerimaan yang SUDAH ADA (analog menambah
//  label/output ke WashingProduksi_h yang sudah dibuat).
//  POST /api/penerimaan-bahan-baku/:noPenerimaan/pallets
//  Membuat SATU NoBahanBaku baru (1 kategori/supplier/no plat) + semua
//  pallet/sak-nya, di-link ke NoPenerimaan tsb lewat
//  PenerimaanBahanBakuOutput. Boleh dipanggil >1x untuk NoPenerimaan yang
//  sama (mis. sekali untuk section Pakai, sekali untuk section Proses).
// ==========================================
async function addPalletsPenerimaanBahanBaku(noPenerimaan, payload, ctx) {
  const v = validateAddPalletsPayload(payload);
  const { actorId, actorUsername, requestId } = ctx || {};

  if (!actorId) {
    throw badReq("actorId kosong / tidak valid. Controller harus inject actorId dari token.");
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const audit = await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    const headerRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT NoPenerimaan, TglPenerimaan, IsComplete
        FROM dbo.PenerimaanBahanBaku_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoPenerimaan = @NoPenerimaan
      `);
    const header = headerRows.recordset[0];
    if (!header) {
      throw notFound(`PenerimaanBahanBaku dengan NoPenerimaan ${noPenerimaan} tidak ditemukan`);
    }
    if (header.IsComplete) {
      throw conflict("Penerimaan sudah selesai, tidak bisa menambah pallet");
    }

    const docDateOnly = toDateOnly(header.TglPenerimaan);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "add pallets PenerimaanBahanBaku",
      useLock: true,
    });

    const prefix = await resolveKategoriPrefix(tx, v.kodeKategori);

    if (v.pallets.some((p) => p.saks.some((s) => s.BeratAct != null))) {
      const rule = await getPotonganRule(tx, v.idSupplier);
      v.pallets.forEach((p, pi) =>
        p.saks.forEach((s, si) => assertBeratSesuaiPotongan(s, rule, pi, si)),
      );
    }

    const noBahanBaku = await generateUniqueCode(tx, {
      tableName: "dbo.BahanBaku_h",
      columnName: "NoBahanBaku",
      prefix,
      width: 10,
    });

    const nowDate = new Date();

    await new sql.Request(tx)
      .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
      .input("IdSupplier", sql.Int, v.idSupplier)
      .input("NoPlat", sql.VarChar(20), v.noPlat)
      .input("DateCreate", sql.Date, header.TglPenerimaan)
      .input("CreateBy", sql.VarChar(100), actorUsername || null)
      .input("DateTimeCreate", sql.DateTime, nowDate)
      .query(`
        INSERT INTO dbo.BahanBaku_h
          (NoBahanBaku, IdSupplier, NoPlat, DateCreate, CreateBy, DateTimeCreate)
        VALUES
          (@NoBahanBaku, @IdSupplier, @NoPlat, @DateCreate, @CreateBy, @DateTimeCreate)
      `);

    const createdOutputs = [];
    let noPallet = 1;

    for (const pallet of v.pallets) {
      const saksJson = JSON.stringify(pallet.saks);

      await new sql.Request(tx)
        .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
        .input("NoPallet", sql.Int, noPallet)
        .input("IdJenisPlastik", sql.Int, pallet.idJenisPlastik)
        .input("IdWarehouse", sql.Int, pallet.idWarehouse)
        .input("Keterangan", sql.NVarChar(200), pallet.keterangan)
        .input("IdStatus", sql.Int, pallet.idStatus)
        .input("Moisture", sql.Decimal(10, 3), pallet.moisture)
        .input("MeltingIndex", sql.Decimal(10, 3), pallet.meltingIndex)
        .input("Elasticity", sql.Decimal(10, 3), pallet.elasticity)
        .input("Tenggelam", sql.Decimal(10, 3), pallet.tenggelam)
        .input("Density", sql.Decimal(10, 3), pallet.density)
        .input("Density2", sql.Decimal(10, 3), pallet.density2)
        .input("Density3", sql.Decimal(10, 3), pallet.density3)
        .input("HasBeenPrinted", sql.Int, 0)
        .input("Blok", sql.VarChar(50), pallet.blok)
        .input("IdLokasi", sql.Int, pallet.idLokasi)
        .query(`
          INSERT INTO dbo.BahanBakuPallet_h (
            NoBahanBaku, NoPallet, IdJenisPlastik, IdWarehouse, Keterangan,
            IdStatus, Moisture, MeltingIndex, Elasticity, Tenggelam,
            Density, Density2, Density3, HasBeenPrinted, Blok, IdLokasi
          )
          VALUES (
            @NoBahanBaku, @NoPallet, @IdJenisPlastik, @IdWarehouse, @Keterangan,
            @IdStatus, @Moisture, @MeltingIndex, @Elasticity, @Tenggelam,
            @Density, @Density2, @Density3, @HasBeenPrinted, @Blok, @IdLokasi
          )
        `);

      await new sql.Request(tx)
        .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
        .input("NoPallet", sql.Int, noPallet)
        .input("TimeCreate", sql.DateTime, nowDate)
        .input("IdLokasi", sql.Int, pallet.idLokasi)
        .input("SaksJson", sql.NVarChar(sql.MAX), saksJson)
        .query(`
          INSERT INTO dbo.BahanBaku_d (
            NoBahanBaku, NoPallet, NoSak, Berat, DateUsage,
            IsPartial, BeratAct, TimeCreate, IdLokasi, IsLembab
          )
          SELECT
            @NoBahanBaku, @NoPallet, j.NoSak, j.Berat, NULL,
            0, j.BeratAct, @TimeCreate, @IdLokasi, j.IsLembab
          FROM OPENJSON(@SaksJson)
          WITH (
            NoSak int '$.NoSak',
            Berat decimal(18,3) '$.Berat',
            BeratAct decimal(18,3) '$.BeratAct',
            IsLembab bit '$.IsLembab'
          ) AS j
        `);

      await new sql.Request(tx)
        .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
        .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
        .input("NoPallet", sql.Int, noPallet)
        .input("SaksJson", sql.NVarChar(sql.MAX), saksJson)
        .query(`
          INSERT INTO dbo.PenerimaanBahanBakuOutput (NoPenerimaan, NoBahanBaku, NoPallet, NoSak)
          SELECT @NoPenerimaan, @NoBahanBaku, @NoPallet, j.NoSak
          FROM OPENJSON(@SaksJson)
          WITH (NoSak int '$.NoSak') AS j
        `);

      createdOutputs.push({
        noBahanBaku,
        noPallet,
        idJenisPlastik: pallet.idJenisPlastik,
        jumlahSak: pallet.saks.length,
        totalBerat: pallet.saks.reduce((sum, sak) => sum + sak.Berat, 0),
      });

      noPallet += 1;
    }

    await tx.commit();

    return {
      noPenerimaan: String(noPenerimaan),
      noBahanBaku,
      idSupplier: v.idSupplier,
      noPlat: v.noPlat,
      kodeKategori: v.kodeKategori,
      prefix,
      outputs: createdOutputs,
      audit: { actorId: audit.actorId, requestId: audit.requestId },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

async function listPenerimaanBahanBaku({ page = 1, pageSize = 20, filter = "", kodeKategori = "" } = {}) {
  const pool = await poolPromise;

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const filterTerm = String(filter || "").trim();
  const kodeKategoriTerm = String(kodeKategori || "").trim().toLowerCase();

  let prefixTerm = "";
  if (kodeKategoriTerm) {
    if (!SUPPORTED_KODE_KATEGORI.has(kodeKategoriTerm)) {
      throw badReq(`kodeKategori tidak valid: ${kodeKategori}`);
    }
    prefixTerm = await resolveKategoriPrefix(pool, kodeKategoriTerm);
  }

  // Satu NoPenerimaan sekarang bisa punya LEBIH dari satu NoBahanBaku (satu
  // per section Pakai/Proses yang ditambah lewat addPallets). BB memilih
  // SATU NoBahanBaku "utama" per NoPenerimaan untuk ditampilkan di baris
  // riwayat ini: yang cocok dengan @PrefixTerm (filter kategori aktif) bila
  // ada, kalau tidak ada filter, yang pertama (NoBahanBaku terkecil).
  const bbCte = `
    WITH BBAll AS (
      SELECT DISTINCT o.NoPenerimaan, bb.NoBahanBaku, bb.IdSupplier, bb.NoPlat
      FROM dbo.PenerimaanBahanBakuOutput o WITH (NOLOCK)
      INNER JOIN dbo.BahanBaku_h bb WITH (NOLOCK) ON bb.NoBahanBaku = o.NoBahanBaku
    ),
    BB AS (
      SELECT NoPenerimaan, NoBahanBaku, IdSupplier, NoPlat,
        ROW_NUMBER() OVER (
          PARTITION BY NoPenerimaan
          ORDER BY
            CASE WHEN @PrefixTerm <> '' AND NoBahanBaku LIKE @PrefixTerm + '%' THEN 0 ELSE 1 END,
            NoBahanBaku
        ) AS rn
      FROM BBAll
    )
  `;

  const whereClause = `
    WHERE 1 = 1
      AND (
        @Filter = ''
        OR h.NoPenerimaan LIKE '%' + @Filter + '%'
        OR ISNULL(sup.NmSupplier, '') LIKE '%' + @Filter + '%'
        OR ISNULL(t.NamaTim, '') LIKE '%' + @Filter + '%'
      )
      AND (
        @PrefixTerm = ''
        OR EXISTS (
          SELECT 1 FROM BBAll x
          WHERE x.NoPenerimaan = h.NoPenerimaan AND x.NoBahanBaku LIKE @PrefixTerm + '%'
        )
      )
  `;

  const countReq = pool.request();
  countReq.input("Filter", sql.VarChar(100), filterTerm);
  countReq.input("PrefixTerm", sql.VarChar(20), prefixTerm);
  const countRes = await countReq.query(`
    ${bbCte}
    SELECT COUNT(1) AS total
    FROM dbo.PenerimaanBahanBaku_h h WITH (NOLOCK)
    LEFT JOIN BB bb ON bb.NoPenerimaan = h.NoPenerimaan AND bb.rn = 1
    LEFT JOIN dbo.MstSupplier sup WITH (NOLOCK) ON sup.IdSupplier = bb.IdSupplier
    LEFT JOIN dbo.MstTimPenerimaan t WITH (NOLOCK) ON t.IdTim = h.IdTim AND t.TipeModul = 'BAHAN_BAKU'
    ${whereClause};
  `);
  const total = countRes.recordset?.[0]?.total || 0;
  if (total === 0) return { data: [], total: 0 };

  const dataReq = pool.request();
  dataReq.input("Filter", sql.VarChar(100), filterTerm);
  dataReq.input("PrefixTerm", sql.VarChar(20), prefixTerm);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("limit", sql.Int, ps);
  const dataRes = await dataReq.query(`
    ${bbCte}
    SELECT
      h.NoPenerimaan,
      CONVERT(varchar(10), h.TglPenerimaan, 23) AS TglPenerimaan,
      h.IdTim,
      t.NamaTim,
      bb.IdSupplier,
      sup.NmSupplier AS NamaSupplier,
      bb.NoPlat,
      h.CreateBy,
      h.DateTimeCreate,
      h.IsComplete,
      h.TglComplete,
      bb.NoBahanBaku,
      agg.JumlahPallet,
      agg.TotalBerat
    FROM dbo.PenerimaanBahanBaku_h h WITH (NOLOCK)
    LEFT JOIN BB bb ON bb.NoPenerimaan = h.NoPenerimaan AND bb.rn = 1
    LEFT JOIN dbo.MstSupplier sup WITH (NOLOCK) ON sup.IdSupplier = bb.IdSupplier
    LEFT JOIN dbo.MstTimPenerimaan t WITH (NOLOCK) ON t.IdTim = h.IdTim AND t.TipeModul = 'BAHAN_BAKU'
    OUTER APPLY (
      SELECT
        COUNT(DISTINCT o.NoPallet) AS JumlahPallet,
        SUM(ISNULL(d.Berat, 0)) AS TotalBerat
      FROM dbo.PenerimaanBahanBakuOutput o
      LEFT JOIN dbo.BahanBaku_d d
        ON d.NoBahanBaku = o.NoBahanBaku AND d.NoPallet = o.NoPallet AND d.NoSak = o.NoSak
      WHERE o.NoPenerimaan = h.NoPenerimaan AND o.NoBahanBaku = bb.NoBahanBaku
    ) agg
    ${whereClause}
    ORDER BY h.NoPenerimaan DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `);

  return { data: dataRes.recordset || [], total };
}

async function getDetailPenerimaanBahanBaku(noPenerimaan) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan));

  const headerResult = await request.query(`
    SELECT
      h.NoPenerimaan,
      CONVERT(varchar(10), h.TglPenerimaan, 23) AS TglPenerimaan,
      h.IdTim,
      t.NamaTim,
      h.CreateBy,
      h.DateTimeCreate,
      h.IsComplete,
      h.TglComplete
    FROM dbo.PenerimaanBahanBaku_h h
    LEFT JOIN dbo.MstTimPenerimaan t ON t.IdTim = h.IdTim AND t.TipeModul = 'BAHAN_BAKU'
    WHERE h.NoPenerimaan = @NoPenerimaan
  `);

  const header = headerResult.recordset[0];
  if (!header) return null;

  // Satu NoPenerimaan bisa membawa >1 NoBahanBaku (1 per section Pakai/
  // Proses) — masing-masing punya Supplier/No Plat sendiri, jadi
  // dikembalikan per-batch di sini, BUKAN sebagai field tunggal di header.
  const batchesResult = await request.query(`
    SELECT DISTINCT
      o.NoBahanBaku,
      bb.IdSupplier,
      sup.NmSupplier AS NamaSupplier,
      bb.NoPlat
    FROM dbo.PenerimaanBahanBakuOutput o
    INNER JOIN dbo.BahanBaku_h bb ON bb.NoBahanBaku = o.NoBahanBaku
    LEFT JOIN dbo.MstSupplier sup ON sup.IdSupplier = bb.IdSupplier
    WHERE o.NoPenerimaan = @NoPenerimaan
    ORDER BY o.NoBahanBaku
  `);

  const outputResult = await request.query(`
    SELECT
      o.NoBahanBaku,
      o.NoPallet,
      o.NoSak,
      p.IdJenisPlastik,
      COALESCE(mbb.Nama, jp.Jenis) AS NamaJenisPlastik,
      p.Keterangan,
      ISNULL(CAST(p.HasBeenPrinted AS int), 0) AS HasBeenPrinted,
      p.Moisture, p.MeltingIndex, p.Elasticity, p.Tenggelam,
      p.Density, p.Density2, p.Density3,
      d.Berat,
      d.BeratAct,
      ISNULL(d.IsLembab, 0) AS IsLembab,
      d.DateUsage
    FROM dbo.PenerimaanBahanBakuOutput o
    LEFT JOIN dbo.BahanBakuPallet_h p
      ON p.NoBahanBaku = o.NoBahanBaku AND p.NoPallet = o.NoPallet
    LEFT JOIN dbo.MstBahanBaku mbb ON mbb.IdBB = p.IdJenisPlastik
    LEFT JOIN dbo.MstJenisPlastik jp ON jp.IdJenisPlastik = p.IdJenisPlastik
    LEFT JOIN dbo.BahanBaku_d d
      ON d.NoBahanBaku = o.NoBahanBaku AND d.NoPallet = o.NoPallet AND d.NoSak = o.NoSak
    WHERE o.NoPenerimaan = @NoPenerimaan
    ORDER BY o.NoBahanBaku, o.NoPallet, o.NoSak
  `);

  return {
    ...header,
    batches: batchesResult.recordset || [],
    outputs: outputResult.recordset || [],
  };
}

async function deletePenerimaanBahanBaku(noPenerimaan, ctx) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), ctx || {});

    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "penerimaanBahanBaku",
      codeValue: noPenerimaan,
      runner: tx,
      useLock: true,
      throwIfNotFound: false,
    });

    if (!docDateOnly) {
      throw notFound("Data PenerimaanBahanBaku tidak ditemukan");
    }

    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete PenerimaanBahanBaku",
      useLock: true,
    });

    const outputRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT DISTINCT NoBahanBaku
        FROM dbo.PenerimaanBahanBakuOutput WITH (UPDLOCK, HOLDLOCK)
        WHERE NoPenerimaan = @NoPenerimaan
      `);

    const usedRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT 1
        FROM dbo.PenerimaanBahanBakuOutput o
        INNER JOIN dbo.BahanBaku_d d
          ON d.NoBahanBaku = o.NoBahanBaku AND d.NoPallet = o.NoPallet AND d.NoSak = o.NoSak
        WHERE o.NoPenerimaan = @NoPenerimaan AND d.DateUsage IS NOT NULL
      `);

    if (usedRows.recordset.length > 0) {
      throw conflict(
        "Tidak bisa menghapus PenerimaanBahanBaku: sebagian label bahan baku sudah terpakai di proses lain",
      );
    }

    // Bisa >1 NoBahanBaku (Pakai & Proses) di bawah satu NoPenerimaan.
    const noBahanBakuList = outputRows.recordset.map((r) => r.NoBahanBaku);

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBahanBakuOutput WHERE NoPenerimaan = @NoPenerimaan`);

    for (const noBahanBaku of noBahanBakuList) {
      await new sql.Request(tx)
        .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
        .query(`DELETE FROM dbo.BahanBaku_d WHERE NoBahanBaku = @NoBahanBaku`);

      await new sql.Request(tx)
        .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
        .query(`DELETE FROM dbo.BahanBakuPallet_h WHERE NoBahanBaku = @NoBahanBaku`);

      await new sql.Request(tx)
        .input("NoBahanBaku", sql.VarChar(50), noBahanBaku)
        .query(`DELETE FROM dbo.BahanBaku_h WHERE NoBahanBaku = @NoBahanBaku`);
    }

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBahanBakuOperator_d WHERE NoPenerimaan = @NoPenerimaan`);

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBahanBaku_h WHERE NoPenerimaan = @NoPenerimaan`);

    await tx.commit();
    return true;
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

// ==========================================
//  TANDAI SELESAI (IsComplete = 1)
//  PATCH /api/penerimaan-bahan-baku/:noPenerimaan/complete
// ==========================================
async function completePenerimaanBahanBaku(noPenerimaan, ctx) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), ctx || {});

    const result = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        UPDATE dbo.PenerimaanBahanBaku_h
        SET IsComplete = 1, TglComplete = GETDATE()
        WHERE NoPenerimaan = @NoPenerimaan
      `);

    if (result.rowsAffected[0] === 0) {
      throw notFound("PenerimaanBahanBaku tidak ditemukan");
    }

    await tx.commit();
    return true;
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

// ==========================================
//  STATUS TIM (untuk grid ala mesin washing)
//  Tim dianggap aktif selama masih ada NoPenerimaan yang BELUM
//  diselesaikan (IsComplete = 0), tidak dibatasi tanggal hari ini lagi
//  (mirror pola penerimaan-bahan-pendukung-service.js#getTimStatus).
// ==========================================
async function getTimStatus() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT
      t.IdTim,
      t.NamaTim,
      t.Aktif,
      today.NoPenerimaan,
      CONVERT(varchar(10), today.TglPenerimaan, 23) AS TglPenerimaan,
      ISNULL(today.IsComplete, 0) AS IsComplete
    FROM dbo.MstTimPenerimaan t WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        h.NoPenerimaan, h.TglPenerimaan, h.IsComplete
      FROM dbo.PenerimaanBahanBaku_h h WITH (NOLOCK)
      WHERE h.IdTim = t.IdTim
        AND h.IsComplete = 0
      ORDER BY h.DateTimeCreate DESC
    ) today
    WHERE t.TipeModul = 'BAHAN_BAKU'
    ORDER BY t.NamaTim ASC;
  `);

  return result.recordset || [];
}

// Opsi form input penerimaan (dropdown supplier, jenis per kategori, max sak).
// kodeKategori "bahanbaku" = alur Proses (IsProses=1), "bahanbakupakai" = Pakai.
async function getFormOptions(kodeKategori) {
  const kode = String(kodeKategori || "").trim().toLowerCase();
  if (!SUPPORTED_KODE_KATEGORI.has(kode)) {
    throw badReq(
      `kodeKategori tidak valid. Gunakan salah satu dari: ${[...SUPPORTED_KODE_KATEGORI].join(", ")}`,
    );
  }
  const isProses = kode === "bahanbaku" ? 1 : 0;

  const pool = await poolPromise;
  const [suppliers, jenis, maxSak] = await Promise.all([
    pool.request().query(`
      SELECT IdSupplier, NmSupplier AS NamaSupplier
      FROM dbo.MstSupplier WITH (NOLOCK)
      ORDER BY NmSupplier ASC
    `),
    pool
      .request()
      .input("IsProses", sql.Bit, isProses)
      .query(`
        SELECT IdBB, Nama
        FROM dbo.MstBahanBaku WITH (NOLOCK)
        WHERE ISNULL(IsEnable, 1) = 1 AND ISNULL(IsProses, 0) = @IsProses
        ORDER BY Nama ASC
      `),
    pool.request().query(`SELECT JlhSak FROM dbo.MstMaxSak WHERE IdBagian = 1`),
  ]);

  return {
    kodeKategori: kode,
    suppliers: suppliers.recordset || [],
    jenis: jenis.recordset || [],
    maxSak: Number(maxSak.recordset[0]?.JlhSak ?? 0),
  };
}

async function getPotongan(idSupplier) {
  const id = Number(idSupplier);
  if (!Number.isInteger(id) || id <= 0) throw badReq("idSupplier wajib diisi");
  const pool = await poolPromise;
  return getPotonganRule(pool, id);
}

// ==========================================
//  EDIT / HAPUS pallet & sak, LAPORAN (padanan FrmBahanBakuv2: Ubah Pallet,
//  Hapus Pallet, Hapus Detail, Laporan). Semua operasi hanya untuk pallet
//  yang tertaut ke NoPenerimaan terkait, dan ditolak bila penerimaan sudah
//  selesai atau periode terkunci.
// ==========================================
async function loadPalletContext(tx, noPenerimaan, noBahanBaku, noPallet, action) {
  const hdr = await new sql.Request(tx)
    .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
    .query(`
      SELECT NoPenerimaan, TglPenerimaan, IsComplete
      FROM dbo.PenerimaanBahanBaku_h WITH (UPDLOCK, HOLDLOCK)
      WHERE NoPenerimaan = @NoPenerimaan
    `);
  const header = hdr.recordset[0];
  if (!header) throw notFound(`PenerimaanBahanBaku ${noPenerimaan} tidak ditemukan`);
  if (header.IsComplete) {
    throw conflict("Penerimaan sudah selesai, data tidak bisa diubah");
  }

  await assertNotLocked({
    date: toDateOnly(header.TglPenerimaan),
    runner: tx,
    action,
    useLock: true,
  });

  const palletNo = Number.parseInt(noPallet, 10);
  if (!Number.isInteger(palletNo) || palletNo <= 0) throw badReq("noPallet tidak valid");

  const palletRes = await new sql.Request(tx)
    .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
    .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
    .input("NoPallet", sql.Int, palletNo)
    .query(`
      SELECT p.IdLokasi, bb.IdSupplier
      FROM dbo.BahanBakuPallet_h p WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.BahanBaku_h bb ON bb.NoBahanBaku = p.NoBahanBaku
      WHERE p.NoBahanBaku = @NoBahanBaku AND p.NoPallet = @NoPallet
        AND EXISTS (
          SELECT 1 FROM dbo.PenerimaanBahanBakuOutput o
          WHERE o.NoPenerimaan = @NoPenerimaan
            AND o.NoBahanBaku = p.NoBahanBaku
            AND o.NoPallet = p.NoPallet
        )
    `);
  const pallet = palletRes.recordset[0];
  if (!pallet) {
    throw notFound(`Pallet ${noPallet} pada ${noBahanBaku} tidak ditemukan di penerimaan ini`);
  }
  return { palletNo, idLokasi: pallet.IdLokasi, idSupplier: pallet.IdSupplier };
}

async function runEditTx(ctx, fn) {
  const { actorId, actorUsername, requestId } = ctx || {};
  if (!actorId) {
    throw badReq("actorId kosong / tidak valid. Controller harus inject actorId dari token.");
  }
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

async function assertNoSakTerpakai(tx, noBahanBaku, palletNo, noSak) {
  const req = new sql.Request(tx)
    .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
    .input("NoPallet", sql.Int, palletNo);
  let where = "";
  if (noSak != null) {
    req.input("NoSak", sql.Int, noSak);
    where = "AND NoSak = @NoSak";
  }
  const used = await req.query(`
    SELECT TOP 1 NoSak FROM dbo.BahanBaku_d
    WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet
      AND DateUsage IS NOT NULL ${where}
  `);
  if (used.recordset.length > 0) {
    throw conflict("Tidak bisa diubah/dihapus: sak sudah terpakai di proses lain");
  }
}

// Ubah jenis & keterangan pallet (VB: BtnSimpanUbahPallet).
async function updatePalletPenerimaan(noPenerimaan, noBahanBaku, noPallet, payload, ctx) {
  const idJenis = Number(payload?.idJenisPlastik);
  if (!Number.isInteger(idJenis) || idJenis <= 0) throw badReq("idJenisPlastik wajib diisi");
  const keterangan =
    payload?.keterangan != null ? String(payload.keterangan).trim() || null : null;

  return runEditTx(ctx, async (tx) => {
    const c = await loadPalletContext(tx, noPenerimaan, noBahanBaku, noPallet, "ubah pallet PenerimaanBahanBaku");

    const isProses = String(noBahanBaku).startsWith("AB.") ? 0 : 1;
    const jenis = await new sql.Request(tx)
      .input("IdBB", sql.Int, idJenis)
      .input("IsProses", sql.Bit, isProses)
      .query(`
        SELECT 1 FROM dbo.MstBahanBaku
        WHERE IdBB = @IdBB AND ISNULL(IsEnable, 1) = 1 AND ISNULL(IsProses, 0) = @IsProses
      `);
    if (jenis.recordset.length === 0) {
      throw badReq("Jenis bahan baku tidak valid untuk kategori ini");
    }

    await new sql.Request(tx)
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .input("IdJenisPlastik", sql.Int, idJenis)
      .input("Keterangan", sql.NVarChar(200), keterangan)
      .query(`
        UPDATE dbo.BahanBakuPallet_h
        SET IdJenisPlastik = @IdJenisPlastik, Keterangan = @Keterangan
        WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet
      `);
    return { noBahanBaku, noPallet: c.palletNo, idJenisPlastik: idJenis, keterangan };
  });
}

// Tambah sak ke pallet yang sudah ada. NoSak diberikan server (max+1).
async function addSaksPenerimaan(noPenerimaan, noBahanBaku, noPallet, payload, ctx) {
  const input = Array.isArray(payload?.saks) ? payload.saks : [];
  if (input.length === 0) throw badReq("saks wajib berisi minimal 1 sak");

  return runEditTx(ctx, async (tx) => {
    const c = await loadPalletContext(tx, noPenerimaan, noBahanBaku, noPallet, "tambah sak PenerimaanBahanBaku");

    const maxRes = await new sql.Request(tx)
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .query(`
        SELECT ISNULL(MAX(NoSak), 0) AS MaxSak
        FROM dbo.BahanBaku_d WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet
      `);
    let nextNo = Number(maxRes.recordset[0].MaxSak) + 1;

    const saks = normalizeSaks(
      input.map((s) => ({ ...s, noSak: nextNo++ })),
      0,
    );
    if (saks.some((s) => s.BeratAct == null)) {
      throw badReq("beratAct wajib diisi untuk setiap sak");
    }

    const rule = await getPotonganRule(tx, c.idSupplier);
    saks.forEach((s, i) => assertBeratSesuaiPotongan(s, rule, 0, i));

    const saksJson = JSON.stringify(saks);
    const nowDate = new Date();
    await new sql.Request(tx)
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .input("TimeCreate", sql.DateTime, nowDate)
      .input("IdLokasi", sql.Int, c.idLokasi)
      .input("SaksJson", sql.NVarChar(sql.MAX), saksJson)
      .query(`
        INSERT INTO dbo.BahanBaku_d (
          NoBahanBaku, NoPallet, NoSak, Berat, DateUsage,
          IsPartial, BeratAct, TimeCreate, IdLokasi, IsLembab
        )
        SELECT
          @NoBahanBaku, @NoPallet, j.NoSak, j.Berat, NULL,
          0, j.BeratAct, @TimeCreate, @IdLokasi, j.IsLembab
        FROM OPENJSON(@SaksJson)
        WITH (
          NoSak int '$.NoSak',
          Berat decimal(18,3) '$.Berat',
          BeratAct decimal(18,3) '$.BeratAct',
          IsLembab bit '$.IsLembab'
        ) AS j
      `);
    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .input("SaksJson", sql.NVarChar(sql.MAX), saksJson)
      .query(`
        INSERT INTO dbo.PenerimaanBahanBakuOutput (NoPenerimaan, NoBahanBaku, NoPallet, NoSak)
        SELECT @NoPenerimaan, @NoBahanBaku, @NoPallet, j.NoSak
        FROM OPENJSON(@SaksJson) WITH (NoSak int '$.NoSak') AS j
      `);
    return { noBahanBaku, noPallet: c.palletNo, noSak: saks.map((s) => s.NoSak) };
  });
}

// Hapus satu sak (VB: BtnHapusDetail). Pallet wajib tetap punya >= 1 sak.
async function deleteSakPenerimaan(noPenerimaan, noBahanBaku, noPallet, noSak, ctx) {
  const sakNo = Number.parseInt(noSak, 10);
  if (!Number.isInteger(sakNo) || sakNo <= 0) throw badReq("noSak tidak valid");

  return runEditTx(ctx, async (tx) => {
    const c = await loadPalletContext(tx, noPenerimaan, noBahanBaku, noPallet, "hapus sak PenerimaanBahanBaku");
    await assertNoSakTerpakai(tx, noBahanBaku, c.palletNo, sakNo);

    const cnt = await new sql.Request(tx)
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .query(`
        SELECT COUNT(*) AS N FROM dbo.BahanBaku_d
        WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet
      `);
    if (Number(cnt.recordset[0].N) <= 1) {
      throw badReq("Pallet harus punya minimal 1 sak. Hapus pallet jika ingin menghapus semuanya");
    }

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .input("NoSak", sql.Int, sakNo)
      .query(`
        DELETE FROM dbo.PenerimaanBahanBakuOutput
        WHERE NoPenerimaan = @NoPenerimaan AND NoBahanBaku = @NoBahanBaku
          AND NoPallet = @NoPallet AND NoSak = @NoSak;
        DELETE FROM dbo.BahanBaku_d
        WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet AND NoSak = @NoSak;
      `);
    return { noBahanBaku, noPallet: c.palletNo, noSak: sakNo };
  });
}

// Hapus pallet beserta seluruh sak-nya (VB: BtnHapusPallet). Bila batch
// (NoBahanBaku) jadi kosong, header BahanBaku_h ikut dihapus.
async function deletePalletPenerimaan(noPenerimaan, noBahanBaku, noPallet, ctx) {
  return runEditTx(ctx, async (tx) => {
    const c = await loadPalletContext(tx, noPenerimaan, noBahanBaku, noPallet, "hapus pallet PenerimaanBahanBaku");
    await assertNoSakTerpakai(tx, noBahanBaku, c.palletNo, null);

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .input("NoPallet", sql.Int, c.palletNo)
      .query(`
        DELETE FROM dbo.PenerimaanBahanBakuOutput
        WHERE NoPenerimaan = @NoPenerimaan AND NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet;
        DELETE FROM dbo.BahanBaku_d WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet;
        DELETE FROM dbo.BahanBakuPallet_h WHERE NoBahanBaku = @NoBahanBaku AND NoPallet = @NoPallet;
      `);

    const left = await new sql.Request(tx)
      .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
      .query(`SELECT COUNT(*) AS N FROM dbo.BahanBakuPallet_h WHERE NoBahanBaku = @NoBahanBaku`);
    let batchDeleted = false;
    if (Number(left.recordset[0].N) === 0) {
      await new sql.Request(tx)
        .input("NoBahanBaku", sql.VarChar(50), String(noBahanBaku))
        .query(`DELETE FROM dbo.BahanBaku_h WHERE NoBahanBaku = @NoBahanBaku`);
      batchDeleted = true;
    }
    return { noBahanBaku, noPallet: c.palletNo, batchDeleted };
  });
}

// Laporan penerimaan per pallet & kondisi (padanan CrPenBahanBakuPerPallet).
async function getLaporanPenerimaan(noPenerimaan) {
  const pool = await poolPromise;
  const rows = await pool
    .request()
    .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
    .query(`
      SELECT
        h.NoBahanBaku,
        CONVERT(varchar(10), h.DateCreate, 23) AS DateCreate,
        h.NoPlat,
        sup.NmSupplier AS NamaSupplier,
        COALESCE(mbb.Nama, jp.Jenis) AS Jenis,
        p.NoPallet,
        CASE WHEN ISNULL(d.IsLembab, 0) = 1 THEN 'LEMBAB' ELSE 'KERING' END AS Kondisi,
        COUNT(d.NoSak) AS JumlahSak,
        SUM(ISNULL(d.BeratAct, d.Berat)) AS BeratTimbangan,
        SUM(ISNULL(d.Berat, 0)) AS Berat
      FROM dbo.PenerimaanBahanBakuOutput o
      INNER JOIN dbo.BahanBaku_h h ON h.NoBahanBaku = o.NoBahanBaku
      INNER JOIN dbo.BahanBakuPallet_h p
        ON p.NoBahanBaku = o.NoBahanBaku AND p.NoPallet = o.NoPallet
      INNER JOIN dbo.BahanBaku_d d
        ON d.NoBahanBaku = o.NoBahanBaku AND d.NoPallet = o.NoPallet AND d.NoSak = o.NoSak
      LEFT JOIN dbo.MstSupplier sup ON sup.IdSupplier = h.IdSupplier
      LEFT JOIN dbo.MstBahanBaku mbb ON mbb.IdBB = p.IdJenisPlastik
      LEFT JOIN dbo.MstJenisPlastik jp ON jp.IdJenisPlastik = p.IdJenisPlastik
      WHERE o.NoPenerimaan = @NoPenerimaan
      GROUP BY h.NoBahanBaku, h.DateCreate, h.NoPlat, sup.NmSupplier,
               COALESCE(mbb.Nama, jp.Jenis), p.NoPallet, ISNULL(d.IsLembab, 0)
      ORDER BY h.NoBahanBaku, p.NoPallet
    `);
  return { perPallet: rows.recordset || [] };
}

module.exports = {
  updatePalletPenerimaan,
  addSaksPenerimaan,
  deleteSakPenerimaan,
  deletePalletPenerimaan,
  getLaporanPenerimaan,
  getFormOptions,
  getPotongan,
  createHeaderPenerimaanBahanBaku,
  addPalletsPenerimaanBahanBaku,
  listPenerimaanBahanBaku,
  getDetailPenerimaanBahanBaku,
  deletePenerimaanBahanBaku,
  completePenerimaanBahanBaku,
  getTimStatus,
};
