// penerimaan-barang-dagang-service.js
//
// Mirror pola penerimaan-bahan-pendukung-service.js (2 fase: create header
// lalu add items), disesuaikan untuk barang dagang:
//   - Tidak ada struktur pallet/sak — barang dagang dihitung PCS, jadi tiap
//     baris "item" LANGSUNG jadi 1 baris dbo.BarangDagang (IdBarangDagang +
//     Qty), tanpa breakdown. PenerimaanBarangDagang_d HANYA pengikat tipis
//     (NoPenerimaan, NoBarangDagang — PK di NoBarangDagang sendiri, karena
//     sudah unik 1:1) antara header dan baris BarangDagang yang
//     dihasilkannya.
//   - Tidak ada IdWarehouse — modul ini tidak melacak lokasi gudang sama
//     sekali.
//   - Tidak ada kategori/prefix label seperti bahan baku (Pakai/Proses) —
//     satu kategori saja.
//   - Tim dari tabel GLOBAL dbo.MstTimPenerimaan (filter
//     TipeModul='BARANG_DAGANG'), dipakai ulang lintas modul penerimaan.
const { sql, poolPromise } = require("../../../core/config/db");
const { generateNextCode } = require("../../../core/utils/sequence-code-helper");
const { badReq, notFound, conflict } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  assertNotLocked,
  loadDocDateOnlyFromConfig,
  toDateOnly,
} = require("../../../core/shared/tutup-transaksi-guard");
const barangDagangReadRepo = require("../../label/barang-dagang/repositories/barang-dagang-read.repository");
const barangDagangWriteRepo = require("../../label/barang-dagang/repositories/barang-dagang-write.repository");

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

    const idBarangDagang = Number(it?.idBarangDagang);
    if (!Number.isInteger(idBarangDagang) || idBarangDagang <= 0) {
      throw badReq(`items[${i}].idBarangDagang wajib diisi (dipakai untuk generate label)`);
    }

    const qty = Number(it?.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw badReq(`items[${i}].qty wajib valid (> 0)`);
    }

    const keterangan = it?.keterangan != null ? String(it.keterangan).trim() || null : null;

    return { idSupplier, idBarangDagang, qty, keterangan };
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
    .query(`SELECT Aktif FROM dbo.MstTimPenerimaan WHERE IdTim = @IdTim AND TipeModul = 'BARANG_DAGANG'`);

  const row = result.recordset[0];
  if (!row) {
    throw badReq(`IdTim ${idTim} tidak ditemukan`);
  }
  if (!row.Aktif) {
    throw badReq(`Tim penerimaan dengan IdTim ${idTim} sedang tidak aktif`);
  }
}

// ==========================================
//  FASE 1: CREATE HEADER (analog PenerimaanBahanPendukung_h create)
//  POST /api/penerimaan-barang-dagang
// ==========================================
async function createHeaderPenerimaanBarangDagang(payload, ctx) {
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
      action: "create PenerimaanBarangDagang (header)",
      useLock: true,
    });

    await assertTimAktif(tx, v.idTim);

    const noPenerimaan = await generateUniqueCode(tx, {
      tableName: "dbo.PenerimaanBarangDagang_h",
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
        INSERT INTO dbo.PenerimaanBarangDagang_h
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
//  POST /api/penerimaan-barang-dagang/:noPenerimaan/items
//  Boleh dipanggil >1x untuk NoPenerimaan yang sama.
// ==========================================
async function addItemsPenerimaanBarangDagang(noPenerimaan, payload, ctx) {
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
        FROM dbo.PenerimaanBarangDagang_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoPenerimaan = @NoPenerimaan
      `);
    const header = headerRows.recordset[0];
    if (!header) {
      throw notFound(`PenerimaanBarangDagang dengan NoPenerimaan ${noPenerimaan} tidak ditemukan`);
    }

    const docDateOnly = toDateOnly(header.TglPenerimaan);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "add items PenerimaanBarangDagang",
      useLock: true,
    });

    // Setiap item langsung menghasilkan 1 baris dbo.BarangDagang (barang +
    // atribut label sekaligus), lalu PenerimaanBarangDagang_d cuma mengikat
    // NoPenerimaan ke NoBarangDagang itu — dalam transaksi yang sama.
    const nowDateTime = new Date();

    const createdItems = [];
    for (const item of items) {
      const genCode = () =>
        generateNextCode(tx, {
          tableName: "dbo.BarangDagang",
          columnName: "NoBarangDagang",
          prefix: "BD.",
          width: 10,
        });

      let noBarangDagang = await genCode();
      if (await barangDagangReadRepo.isNoBarangDagangExists(tx, noBarangDagang)) {
        noBarangDagang = await genCode();
        if (await barangDagangReadRepo.isNoBarangDagangExists(tx, noBarangDagang)) {
          throw conflict("Gagal generate NoBarangDagang unik, coba lagi");
        }
      }

      await barangDagangWriteRepo.insertBarangDagangHeader(tx, {
        noBarangDagang,
        header: {
          IdSupplier: item.idSupplier,
          IdBarangDagang: item.idBarangDagang,
          Qty: item.qty,
          Keterangan: item.keterangan,
          CreateBy: actorUsername || null,
        },
        nowDateTime,
      });

      await new sql.Request(tx)
        .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
        .input("NoBarangDagang", sql.VarChar(50), noBarangDagang)
        .input("CreateBy", sql.VarChar(100), actorUsername || null)
        .query(`
          INSERT INTO dbo.PenerimaanBarangDagang_d
            (NoPenerimaan, NoBarangDagang, CreateBy)
          VALUES
            (@NoPenerimaan, @NoBarangDagang, @CreateBy)
        `);

      createdItems.push({ noPenerimaan: String(noPenerimaan), noBarangDagang, ...item });
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

async function listPenerimaanBarangDagang({ page = 1, pageSize = 20, filter = "" } = {}) {
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
    FROM dbo.PenerimaanBarangDagang_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstTimPenerimaan t WITH (NOLOCK) ON t.IdTim = h.IdTim AND t.TipeModul = 'BARANG_DAGANG'
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
    FROM dbo.PenerimaanBarangDagang_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstTimPenerimaan t WITH (NOLOCK) ON t.IdTim = h.IdTim AND t.TipeModul = 'BARANG_DAGANG'
    OUTER APPLY (
      SELECT
        COUNT(1) AS JumlahItem,
        SUM(ISNULL(bd.Qty, 0)) AS TotalQty
      FROM dbo.PenerimaanBarangDagang_d dd
      INNER JOIN dbo.BarangDagang bd ON bd.NoBarangDagang = dd.NoBarangDagang
      WHERE dd.NoPenerimaan = h.NoPenerimaan
    ) agg
    ${whereClause}
    ORDER BY h.NoPenerimaan DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `);

  return { data: dataRes.recordset || [], total };
}

async function getDetailPenerimaanBarangDagang(noPenerimaan) {
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
    FROM dbo.PenerimaanBarangDagang_h h
    LEFT JOIN dbo.MstTimPenerimaan t ON t.IdTim = h.IdTim AND t.TipeModul = 'BARANG_DAGANG'
    WHERE h.NoPenerimaan = @NoPenerimaan
  `);

  const header = headerResult.recordset[0];
  if (!header) return null;

  const itemsResult = await request.query(`
    SELECT
      dd.NoPenerimaan,
      dd.NoBarangDagang,
      bd.IdSupplier,
      sup.NmSupplier AS NamaSupplier,
      bd.IdBarangDagang,
      md.NamaBarangDagang,
      bd.Qty,
      bd.QtyAwal,
      bd.Keterangan,
      bd.HasBeenPrinted
    FROM dbo.PenerimaanBarangDagang_d dd
    INNER JOIN dbo.BarangDagang bd ON bd.NoBarangDagang = dd.NoBarangDagang
    LEFT JOIN dbo.MstSupplier sup ON sup.IdSupplier = bd.IdSupplier
    LEFT JOIN dbo.MstBarangDagang md ON md.IdBarangDagang = bd.IdBarangDagang
    WHERE dd.NoPenerimaan = @NoPenerimaan
    ORDER BY bd.CreatedAt
  `);

  return {
    ...header,
    items: itemsResult.recordset || [],
  };
}

async function deletePenerimaanBarangDagang(noPenerimaan, ctx) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), ctx || {});

    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "penerimaanBarangDagang",
      codeValue: noPenerimaan,
      runner: tx,
      useLock: true,
      throwIfNotFound: false,
    });

    if (!docDateOnly) {
      throw notFound("Data PenerimaanBarangDagang tidak ditemukan");
    }

    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete PenerimaanBarangDagang",
      useLock: true,
    });

    const usedRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT 1
        FROM dbo.PenerimaanBarangDagang_d dd
        INNER JOIN dbo.BarangDagang bd ON bd.NoBarangDagang = dd.NoBarangDagang
        WHERE dd.NoPenerimaan = @NoPenerimaan AND bd.DateUsage IS NOT NULL
      `);
    if (usedRows.recordset.length > 0) {
      throw conflict(
        "Tidak bisa menghapus PenerimaanBarangDagang: sebagian barang dagang sudah terpakai di proses lain",
      );
    }

    const detailRows = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        SELECT NoBarangDagang
        FROM dbo.PenerimaanBarangDagang_d
        WHERE NoPenerimaan = @NoPenerimaan
      `);

    // Hapus dulu baris pengikat (_d) sebelum baris BarangDagang yang
    // direferensikannya (FK_PenerimaanBarangDagang_d_BarangDagang).
    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBarangDagang_d WHERE NoPenerimaan = @NoPenerimaan`);

    for (const row of detailRows.recordset) {
      await new sql.Request(tx)
        .input("NoBarangDagang", sql.VarChar(50), row.NoBarangDagang)
        .query(`DELETE FROM dbo.BarangDagang WHERE NoBarangDagang = @NoBarangDagang`);
    }

    await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`DELETE FROM dbo.PenerimaanBarangDagang_h WHERE NoPenerimaan = @NoPenerimaan`);

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
//  PATCH /api/penerimaan-barang-dagang/:noPenerimaan/complete
// ==========================================
async function completePenerimaanBarangDagang(noPenerimaan, ctx) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), ctx || {});

    const result = await new sql.Request(tx)
      .input("NoPenerimaan", sql.VarChar(20), String(noPenerimaan))
      .query(`
        UPDATE dbo.PenerimaanBarangDagang_h
        SET IsComplete = 1, TglComplete = GETDATE()
        WHERE NoPenerimaan = @NoPenerimaan
      `);

    if (result.rowsAffected[0] === 0) {
      throw notFound("PenerimaanBarangDagang tidak ditemukan");
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
//  STATUS TIM (untuk grid ala mesin washing / penerimaan bahan pendukung)
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
      -- diselesaikan (IsComplete = 0), tidak dibatasi tanggal hari ini.
      SELECT TOP 1
        h.NoPenerimaan, h.TglPenerimaan, h.IsComplete, h.CreateBy
      FROM dbo.PenerimaanBarangDagang_h h WITH (NOLOCK)
      WHERE h.IdTim = t.IdTim
        AND h.IsComplete = 0
      ORDER BY h.NoPenerimaan DESC
    ) today
    OUTER APPLY (
      SELECT COUNT(1) AS JumlahItem
      FROM dbo.PenerimaanBarangDagang_d dd
      INNER JOIN dbo.BarangDagang bd ON bd.NoBarangDagang = dd.NoBarangDagang
      WHERE dd.NoPenerimaan = today.NoPenerimaan
    ) agg
    WHERE t.TipeModul = 'BARANG_DAGANG'
    ORDER BY t.NamaTim ASC;
  `);

  return result.recordset || [];
}

module.exports = {
  createHeaderPenerimaanBarangDagang,
  addItemsPenerimaanBarangDagang,
  listPenerimaanBarangDagang,
  getDetailPenerimaanBarangDagang,
  deletePenerimaanBarangDagang,
  completePenerimaanBarangDagang,
  getTimStatus,
};
