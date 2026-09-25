// penerimaan-bahan-pendukung-service.js
//
// Mengikuti pola penerimaan-bahan-baku-service.js (2 fase: create header lalu
// add items), TAPI disederhanakan sesuai kebutuhan bahan pendukung:
//   - Tidak ada struktur pallet/sak — barang pendukung (baut/pipa/plat/dll)
//     dihitung PCS, jadi tiap baris "item" LANGSUNG jadi 1 baris
//     dbo.BahanPendukung (IdCabinetMaterial + Qty), tanpa breakdown.
//     PenerimaanBahanPendukung_d HANYA pengikat tipis (NoPenerimaan,
//     NoBahanPendukung — PK di NoBahanPendukung sendiri, karena sudah unik
//     1:1) antara header dan baris BahanPendukung yang dihasilkannya.
//   - Tidak ada IdWarehouse — modul ini tidak melacak lokasi gudang sama
//     sekali (beda dengan FurnitureWIP).
//   - Tidak ada kategori/prefix label seperti bahan baku (Pakai/Proses) —
//     satu kategori saja, jadi tidak perlu resolveKategoriPrefix ataupun
//     multi-kategori per section.
//   - Tim dari tabel GLOBAL dbo.MstTimPenerimaan (bukan MstTimPenerimaanBB
//     yang khusus bahan baku) — supaya bisa dipakai ulang modul penerimaan
//     lain di masa depan.
const { sql, poolPromise } = require("../../../core/config/db");
const { generateNextCode } = require("../../../core/utils/sequence-code-helper");
const { badReq, notFound, conflict } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  assertNotLocked,
  loadDocDateOnlyFromConfig,
  toDateOnly,
} = require("../../../core/shared/tutup-transaksi-guard");
const bahanPendukungReadRepo = require("../../label/bahan-pendukung/repositories/bahan-pendukung-read.repository");
const bahanPendukungWriteRepo = require("../../label/bahan-pendukung/repositories/bahan-pendukung-write.repository");

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

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badReq("items wajib berisi minimal 1 barang");
  }

  return items.map((it, i) => {
    const idSupplier = Number(it?.idSupplier);
    if (!Number.isInteger(idSupplier) || idSupplier <= 0) {
      throw badReq(`items[${i}].idSupplier wajib diisi`);
    }

    const idCabinetMaterial = Number(it?.idCabinetMaterial);
    if (!Number.isInteger(idCabinetMaterial) || idCabinetMaterial <= 0) {
      throw badReq(`items[${i}].idCabinetMaterial wajib diisi (dipakai untuk generate label)`);
    }

    const qty = Number(it?.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw badReq(`items[${i}].qty wajib valid (> 0)`);
    }

    const keterangan = it?.keterangan != null ? String(it.keterangan).trim() || null : null;

    return { idSupplier, idCabinetMaterial, qty, keterangan };
  });
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
    .query(`SELECT Aktif FROM dbo.MstTimPenerimaan WHERE IdTim = @IdTim AND TipeModul = 'BAHAN_PENDUKUNG'`);

  const row = result.recordset[0];
  if (!row) {
    throw badReq(`IdTim ${idTim} tidak ditemukan`);
  }
  if (!row.Aktif) {
    throw badReq(`Tim penerimaan dengan IdTim ${idTim} sedang tidak aktif`);
  }
}

// ==========================================
//  FASE 1: CREATE HEADER (analog PenerimaanBahanBaku_h create)
//  POST /api/penerimaan-bahan-pendukung
// ==========================================
async function createHeaderPenerimaanBahanPendukung(payload, ctx) {
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
      action: "create PenerimaanBahanPendukung (header)",
      useLock: true,
    });

    await assertTimAktif(tx, v.idTim);

    const noPenerimaan = await generateUniqueCode(tx, {
      tableName: "dbo.PenerimaanBahanPendukung_h",
      columnName: "NoPenerimaan",
      prefix: "PP.",
      width: 10,
    });

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), noPenerimaan)
      .input("TglPenerimaan", sql.Date, v.tglPenerimaan)
      .input("IdTim", sql.Int, v.idTim)
      .input("CreateBy", sql.VarChar(100), actorUsername || null)
      .query(`
        INSERT INTO dbo.PenerimaanBahanPendukung_h
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
//  FASE 2: ADD ITEMS ke NoPenerimaan yang SUDAH ADA
//  POST /api/penerimaan-bahan-pendukung/:noPenerimaan/items
//  Boleh dipanggil >1x untuk NoPenerimaan yang sama.
// ==========================================
async function addItemsPenerimaanBahanPendukung(noPenerimaan, payload, ctx) {
  const items = normalizeItems(payload?.items);
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
        SELECT NoPenerimaan, TglPenerimaan
        FROM dbo.PenerimaanBahanPendukung_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoPenerimaan = @NoPenerimaan
      `);
    const header = headerRows.recordset[0];
    if (!header) {
      throw notFound(`PenerimaanBahanPendukung dengan NoPenerimaan ${noPenerimaan} tidak ditemukan`);
    }

    const docDateOnly = toDateOnly(header.TglPenerimaan);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "add items PenerimaanBahanPendukung",
      useLock: true,
    });

    // Setiap item langsung menghasilkan 1 baris dbo.BahanPendukung (barang +
    // atribut label sekaligus), lalu PenerimaanBahanPendukung_d cuma
    // mengikat NoPenerimaan ke NoBahanPendukung itu — dalam transaksi yang
    // sama, mengikuti pola create-furniture-wip.handler.js.
    const nowDateTime = new Date();

    const createdItems = [];
    for (const item of items) {
      const genCode = () =>
        generateNextCode(tx, {
          tableName: "dbo.BahanPendukung",
          columnName: "NoBahanPendukung",
          prefix: "BP.",
          width: 10,
        });

      let noBahanPendukung = await genCode();
      if (await bahanPendukungReadRepo.isNoBahanPendukungExists(tx, noBahanPendukung)) {
        noBahanPendukung = await genCode();
        if (await bahanPendukungReadRepo.isNoBahanPendukungExists(tx, noBahanPendukung)) {
          throw conflict("Gagal generate NoBahanPendukung unik, coba lagi");
        }
      }

      await bahanPendukungWriteRepo.insertBahanPendukungHeader(tx, {
        noBahanPendukung,
        header: {
          IdSupplier: item.idSupplier,
          IdCabinetMaterial: item.idCabinetMaterial,
          Qty: item.qty,
          // QtyAwal: snapshot kuantitas asli saat penerimaan. Qty (live)
          // dipotong oleh konsumsi parsial di proses produksi, QtyAwal
          // TIDAK pernah berubah — dipakai riwayat penerimaan.
          QtyAwal: item.qty,
          Keterangan: item.keterangan,
          CreateBy: actorUsername || null,
        },
        nowDateTime,
      });

      await new sql.Request(tx)
        .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
        .input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung)
        .input("CreateBy", sql.VarChar(100), actorUsername || null)
        .query(`
          INSERT INTO dbo.PenerimaanBahanPendukung_d
            (NoPenerimaan, NoBahanPendukung, CreateBy)
          VALUES
            (@NoPenerimaan, @NoBahanPendukung, @CreateBy)
        `);

      createdItems.push({ noPenerimaan: String(noPenerimaan), noBahanPendukung, ...item });
    }

    await tx.commit();

    return {
      noPenerimaan: String(noPenerimaan),
      items: createdItems,
      audit: { actorId: audit.actorId, requestId: audit.requestId },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

async function listPenerimaanBahanPendukung({ page = 1, pageSize = 20, filter = "" } = {}) {
  const pool = await poolPromise;

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const filterTerm = String(filter || "").trim();

  const whereClause = `
    WHERE (
      @Filter = ''
      OR h.NoPenerimaan LIKE '%' + @Filter + '%'
      OR ISNULL(t.NamaTim, '') LIKE '%' + @Filter + '%'
    )
  `;

  const countReq = pool.request();
  countReq.input("Filter", sql.VarChar(100), filterTerm);
  const countRes = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM dbo.PenerimaanBahanPendukung_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstTimPenerimaan t WITH (NOLOCK) ON t.IdTim = h.IdTim AND t.TipeModul = 'BAHAN_PENDUKUNG'
    ${whereClause};
  `);
  const total = countRes.recordset?.[0]?.total || 0;
  if (total === 0) return { data: [], total: 0 };

  const dataReq = pool.request();
  dataReq.input("Filter", sql.VarChar(100), filterTerm);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("limit", sql.Int, ps);
  const dataRes = await dataReq.query(`
    SELECT
      h.NoPenerimaan,
      CONVERT(varchar(10), h.TglPenerimaan, 23) AS TglPenerimaan,
      h.IdTim,
      t.NamaTim,
      h.IsComplete,
      h.CreateBy,
      h.TglComplete,
      agg.JumlahItem,
      agg.TotalQty
    FROM dbo.PenerimaanBahanPendukung_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstTimPenerimaan t WITH (NOLOCK) ON t.IdTim = h.IdTim AND t.TipeModul = 'BAHAN_PENDUKUNG'
    OUTER APPLY (
      SELECT
        COUNT(1) AS JumlahItem,
        SUM(ISNULL(bp.QtyAwal, bp.Qty)) AS TotalQty
      FROM dbo.PenerimaanBahanPendukung_d dd
      INNER JOIN dbo.BahanPendukung bp ON bp.NoBahanPendukung = dd.NoBahanPendukung
      WHERE dd.NoPenerimaan = h.NoPenerimaan
    ) agg
    ${whereClause}
    ORDER BY h.NoPenerimaan DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `);

  return { data: dataRes.recordset || [], total };
}

async function getDetailPenerimaanBahanPendukung(noPenerimaan) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan));

  const headerResult = await request.query(`
    SELECT
      h.NoPenerimaan,
      CONVERT(varchar(10), h.TglPenerimaan, 23) AS TglPenerimaan,
      h.IdTim,
      t.NamaTim,
      h.IsComplete,
      h.CreateBy,
      h.TglComplete
    FROM dbo.PenerimaanBahanPendukung_h h
    LEFT JOIN dbo.MstTimPenerimaan t ON t.IdTim = h.IdTim AND t.TipeModul = 'BAHAN_PENDUKUNG'
    WHERE h.NoPenerimaan = @NoPenerimaan
  `);

  const header = headerResult.recordset[0];
  if (!header) return null;

  const itemsResult = await request.query(`
    SELECT
      dd.NoPenerimaan,
      dd.NoBahanPendukung,
      bp.IdSupplier,
      sup.NmSupplier AS NamaSupplier,
      bp.IdCabinetMaterial,
      cm.Nama AS NamaCabinetMaterial,
      ISNULL(bp.QtyAwal, bp.Qty) AS Qty,
      bp.Qty AS QtySisa,
      bp.Keterangan,
      bp.HasBeenPrinted
    FROM dbo.PenerimaanBahanPendukung_d dd
    INNER JOIN dbo.BahanPendukung bp ON bp.NoBahanPendukung = dd.NoBahanPendukung
    LEFT JOIN dbo.MstSupplier sup ON sup.IdSupplier = bp.IdSupplier
    LEFT JOIN dbo.MstCabinetMaterial cm ON cm.IdCabinetMaterial = bp.IdCabinetMaterial
    WHERE dd.NoPenerimaan = @NoPenerimaan
    ORDER BY bp.CreatedAt
  `);

  return {
    ...header,
    items: itemsResult.recordset || [],
  };
}

async function deletePenerimaanBahanPendukung(noPenerimaan, ctx) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), ctx || {});

    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "penerimaanBahanPendukung",
      codeValue: noPenerimaan,
      runner: tx,
      useLock: true,
      throwIfNotFound: false,
    });

    if (!docDateOnly) {
      throw notFound("Data PenerimaanBahanPendukung tidak ditemukan");
    }

    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete PenerimaanBahanPendukung",
      useLock: true,
    });

    const usedRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT 1
        FROM dbo.PenerimaanBahanPendukung_d dd
        INNER JOIN dbo.BahanPendukung bp ON bp.NoBahanPendukung = dd.NoBahanPendukung
        WHERE dd.NoPenerimaan = @NoPenerimaan AND bp.DateUsage IS NOT NULL
      `);
    if (usedRows.recordset.length > 0) {
      throw conflict(
        "Tidak bisa menghapus PenerimaanBahanPendukung: sebagian bahan pendukung sudah terpakai di proses lain",
      );
    }

    const detailRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT NoBahanPendukung
        FROM dbo.PenerimaanBahanPendukung_d
        WHERE NoPenerimaan = @NoPenerimaan
      `);

    // Hapus dulu baris pengikat (_d) sebelum baris BahanPendukung yang
    // direferensikannya (FK_PenerimaanBahanPendukung_d_BahanPendukung).
    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBahanPendukung_d WHERE NoPenerimaan = @NoPenerimaan`);

    for (const row of detailRows.recordset) {
      await new sql.Request(tx)
        .input("NoBahanPendukung", sql.VarChar(50), row.NoBahanPendukung)
        .query(`DELETE FROM dbo.BahanPendukung WHERE NoBahanPendukung = @NoBahanPendukung`);
    }

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBahanPendukung_h WHERE NoPenerimaan = @NoPenerimaan`);

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
//  PATCH /api/penerimaan-bahan-pendukung/:noPenerimaan/complete
// ==========================================
async function completePenerimaanBahanPendukung(noPenerimaan, ctx) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), ctx || {});

    const result = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        UPDATE dbo.PenerimaanBahanPendukung_h
        SET IsComplete = 1, TglComplete = GETDATE()
        WHERE NoPenerimaan = @NoPenerimaan
      `);

    if (result.rowsAffected[0] === 0) {
      throw notFound("PenerimaanBahanPendukung tidak ditemukan");
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
//  STATUS TIM (untuk grid ala mesin washing / penerimaan bahan baku)
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
      ISNULL(today.IsComplete, 0) AS IsComplete,
      today.CreateBy,
      ISNULL(agg.JumlahItem, 0) AS JumlahItem
    FROM dbo.MstTimPenerimaan t WITH (NOLOCK)
    OUTER APPLY (
      -- Tim dianggap aktif selama masih ada NoPenerimaan yang BELUM
      -- diselesaikan (IsComplete = 0), tidak dibatasi tanggal hari ini lagi.
      SELECT TOP 1
        h.NoPenerimaan, h.TglPenerimaan, h.IsComplete, h.CreateBy
      FROM dbo.PenerimaanBahanPendukung_h h WITH (NOLOCK)
      WHERE h.IdTim = t.IdTim
        AND h.IsComplete = 0
      ORDER BY h.NoPenerimaan DESC
    ) today
    OUTER APPLY (
      SELECT COUNT(1) AS JumlahItem
      FROM dbo.PenerimaanBahanPendukung_d dd
      INNER JOIN dbo.BahanPendukung bp ON bp.NoBahanPendukung = dd.NoBahanPendukung
      WHERE dd.NoPenerimaan = today.NoPenerimaan
    ) agg
    WHERE t.TipeModul = 'BAHAN_PENDUKUNG'
    ORDER BY t.NamaTim ASC;
  `);

  return result.recordset || [];
}

module.exports = {
  createHeaderPenerimaanBahanPendukung,
  addItemsPenerimaanBahanPendukung,
  listPenerimaanBahanPendukung,
  getDetailPenerimaanBahanPendukung,
  deletePenerimaanBahanPendukung,
  completePenerimaanBahanPendukung,
  getTimStatus,
};
