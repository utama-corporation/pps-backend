const { sql, poolPromise } = require("../../core/config/db");
const { generateNextCode } = require("../../core/utils/sequence-code-helper");
const {
  resolveEffectiveDateForCreate,
  toDateOnly,
} = require("../../core/shared/tutup-transaksi-guard");
const { badReq, notFound } = require("../../core/utils/http-error");

const VALID_STATUSES = [
  "STOCK HABIS",
  "PERLU PRODUKSI",
  "MENDEKATI MINIMUM",
  "STOCK AMAN",
];

const SORT_KEYS = ["itemCode", "barang", "stok", "min", "max", "mpq", "qty", "status"];

function toNum(value) {
  return typeof value === "number" ? value : parseFloat(value) || 0;
}

function calcStatus(stock, minStock) {
  if (stock <= 0) return "STOCK HABIS";
  if (minStock > 0 && stock < minStock) return "PERLU PRODUKSI";
  if (minStock > 0 && stock < minStock * 1.1) return "MENDEKATI MINIMUM";
  return "STOCK AMAN";
}

function calcQtyRekomendasi(stock, minStock, maxStock, mpq) {
  if (calcStatus(stock, minStock) === "STOCK AMAN") return 0;
  const delta = maxStock - stock;
  if (delta <= 0) return 0;
  if (mpq > 0) return Math.ceil(delta / mpq) * mpq;
  return delta;
}

function summarize(items) {
  const summary = {
    total: items.length,
    perluProduksi: 0,
    stockHabis: 0,
    mendekatiMinimum: 0,
    stockAman: 0,
  };
  for (const item of items) {
    if (item.Status === "PERLU PRODUKSI") summary.perluProduksi += 1;
    else if (item.Status === "STOCK HABIS") summary.stockHabis += 1;
    else if (item.Status === "MENDEKATI MINIMUM") summary.mendekatiMinimum += 1;
    else summary.stockAman += 1;
  }
  return summary;
}

function sortItems(items, sort, dir) {
  const key = SORT_KEYS.includes(sort) ? sort : "barang";
  const factor = dir === "desc" ? -1 : 1;
  const cmp = (a, b) => {
    if (key === "itemCode") return a.ItemCode.localeCompare(b.ItemCode);
    if (key === "barang") return a.NamaBJ.localeCompare(b.NamaBJ);
    if (key === "stok") return a.Stock - b.Stock;
    if (key === "min") return a.MinStock - b.MinStock;
    if (key === "max") return a.MaxStock - b.MaxStock;
    if (key === "mpq") return a.MPQ - b.MPQ;
    if (key === "qty") return a.QtyRekomendasi - b.QtyRekomendasi;
    return a.Status.localeCompare(b.Status);
  };
  return [...items].sort((a, b) => cmp(a, b) * factor);
}

async function getMonitoring({ search = "", status = "", sort = "barang", dir = "asc", page = 1, pageSize = 20 } = {}) {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    ;WITH PartialSum AS (
      SELECT NoBJ, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
      FROM dbo.BarangJadiPartial
      GROUP BY NoBJ
    ),
    EffectiveDetail AS (
      SELECT
        bj.IdBJ,
        CASE
          WHEN bj.IsPartial = 1 THEN
            CASE
              WHEN ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0) < 0 THEN 0
              ELSE ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0)
            END
          ELSE ISNULL(bj.Pcs, 0)
        END AS PcsEfektif
      FROM dbo.BarangJadi bj
      LEFT JOIN PartialSum ps ON ps.NoBJ = bj.NoBJ
      WHERE bj.DateUsage IS NULL
    ),
    Stok AS (
      SELECT IdBJ, SUM(PcsEfektif) AS Stock
      FROM EffectiveDetail
      GROUP BY IdBJ
    )
    SELECT
      m.IdBJ,
      ISNULL(m.ItemCode, '') AS ItemCode,
      m.NamaBJ,
      ISNULL(u.NamaUOM, '') AS UOM,
      ISNULL(st.Stock, 0) AS Stock,
      ISNULL(m.MinStock, 0) AS MinStock,
      ISNULL(m.MaxStock, 0) AS MaxStock,
      ISNULL(m.MPQ, 0) AS MPQ
    FROM dbo.MstBarangJadi m
    LEFT JOIN dbo.MstUOM u ON u.IdUOM = m.IdUOM
    LEFT JOIN Stok st ON st.IdBJ = m.IdBJ
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.NamaBJ ASC;
  `);

  const allItems = (result.recordset || []).map((row) => {
    const stock = toNum(row.Stock);
    const minStock = toNum(row.MinStock);
    const maxStock = toNum(row.MaxStock);
    const mpq = toNum(row.MPQ);
    return {
      IdBJ: row.IdBJ,
      ItemCode: row.ItemCode,
      NamaBJ: row.NamaBJ,
      UOM: row.UOM,
      Stock: stock,
      MinStock: minStock,
      MaxStock: maxStock,
      MPQ: mpq,
      QtyRekomendasi: calcQtyRekomendasi(stock, minStock, maxStock, mpq),
      Status: calcStatus(stock, minStock),
    };
  });

  const summary = summarize(allItems);
  const searchLower = String(search || "").trim().toLowerCase();
  const statusUpper = String(status || "").trim().toUpperCase();

  let filtered = allItems;
  if (searchLower) {
    filtered = filtered.filter(
      (item) =>
        item.ItemCode.toLowerCase().includes(searchLower) ||
        item.NamaBJ.toLowerCase().includes(searchLower),
    );
  }
  if (statusUpper) {
    if (!VALID_STATUSES.includes(statusUpper)) {
      throw badReq("Status filter tidak valid");
    }
    filtered = filtered.filter((item) => item.Status === statusUpper);
  }

  filtered = sortItems(filtered, sort, dir);

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safePageSize = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 200);
  const offset = (safePage - 1) * safePageSize;
  const data = filtered.slice(offset, offset + safePageSize);

  return {
    data,
    total: filtered.length,
    summary,
    meta: {
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(Math.ceil(filtered.length / safePageSize), 1),
      hasNextPage: safePage * safePageSize < filtered.length,
      hasPrevPage: safePage > 1,
      search: String(search || "").trim(),
      status: statusUpper,
      sort: SORT_KEYS.includes(sort) ? sort : "barang",
      dir: dir === "desc" ? "desc" : "asc",
    },
  };
}


async function createSpk({ tanggal = null, keterangan = null, items = [] } = {}, { actorId } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badReq("Daftar barang tidak boleh kosong");
  }
  if (!actorId) {
    throw badReq("Actor tidak ditemukan");
  }

  const seen = new Set();
  for (const item of items) {
    const idBJ = parseInt(item?.IdBJ, 10);
    const qty = Number(item?.QtySPK);
    if (!Number.isFinite(idBJ) || idBJ <= 0) {
      throw badReq("IdBJ tidak valid");
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw badReq("Qty SPK harus lebih dari 0");
    }
    if (seen.has(idBJ)) {
      throw badReq("Terdapat barang duplikat dalam daftar SPK");
    }
    seen.add(idBJ);
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.SPKBarangJadi_H",
        columnName: "NoSPK",
        prefix: "SPK.",
        width: 10,
      });

    let noSPK = await gen();
    const dup = await new sql.Request(tx).input("NoSPK", sql.VarChar(20), noSPK).query(`
      SELECT 1
      FROM dbo.SPKBarangJadi_H WITH (UPDLOCK, HOLDLOCK)
      WHERE NoSPK = @NoSPK
    `);
    if (dup.recordset.length > 0) {
      noSPK = await gen();
    }

    const effectiveDate = resolveEffectiveDateForCreate(tanggal);

    const insertResult = await new sql.Request(tx)
      .input("NoSPK", sql.VarChar(20), noSPK)
      .input("Tanggal", sql.Date, effectiveDate)
      .input("Keterangan", sql.VarChar(255), keterangan ? String(keterangan).slice(0, 255) : null)
      .input("CreatedBy", sql.Int, actorId)
      .query(`
        INSERT INTO dbo.SPKBarangJadi_H (NoSPK, Tanggal, Status, Keterangan, CreatedBy, CreatedDate)
        VALUES (@NoSPK, @Tanggal, 'OPEN', @Keterangan, @CreatedBy, GETDATE());
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdSPK;
      `);

    const idSPK = insertResult.recordset[0].IdSPK;

    for (const item of items) {
      const idBJ = parseInt(item.IdBJ, 10);
      const snapshot = await getSnapshotByIdBJTx(tx, idBJ);
      if (!snapshot) {
        throw badReq(`Barang dengan Id ${idBJ} tidak ditemukan atau nonaktif`);
      }

      const qtySPK = Number(item.QtySPK);
      const qtyRekomendasi = calcQtyRekomendasi(
        snapshot.Stock,
        snapshot.MinStock,
        snapshot.MaxStock,
        snapshot.MPQ,
      );

      await new sql.Request(tx)
        .input("IdSPK", sql.Int, idSPK)
        .input("IdBJ", sql.Int, idBJ)
        .input("MinStock", sql.Decimal(18, 2), snapshot.MinStock)
        .input("MaxStock", sql.Decimal(18, 2), snapshot.MaxStock)
        .input("StockSaatSPK", sql.Decimal(18, 2), snapshot.Stock)
        .input("MPQ", sql.Decimal(18, 2), snapshot.MPQ)
        .input("QtyRekomendasi", sql.Decimal(18, 2), qtyRekomendasi)
        .input("QtySPK", sql.Decimal(18, 2), qtySPK)
        .input("CreatedBy", sql.Int, actorId)
        .query(`
          INSERT INTO dbo.SPKBarangJadi_D (
            IdSPK, IdBJ, MinStock, MaxStock, StockSaatSPK, MPQ,
            QtyRekomendasi, QtySPK, QtyProduksi, QtySelesai, Status,
            Keterangan, CreatedBy, CreatedDate
          )
          VALUES (
            @IdSPK, @IdBJ, @MinStock, @MaxStock, @StockSaatSPK, @MPQ,
            @QtyRekomendasi, @QtySPK, 0, 0, 'OPEN',
            NULL, @CreatedBy, GETDATE()
          );
        `);
    }

    await tx.commit();
    return await getSpkDetail(noSPK);
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {
    }
    throw error;
  }
}

async function getSnapshotByIdBJTx(tx, idBJ) {
  const result = await new sql.Request(tx).input("IdBJ", sql.Int, idBJ).query(`
      ;WITH PartialSum AS (
        SELECT p.NoBJ, SUM(ISNULL(p.Pcs, 0)) AS TotalPartialPcs
        FROM dbo.BarangJadiPartial p
        JOIN dbo.BarangJadi bj2 ON bj2.NoBJ = p.NoBJ
        WHERE bj2.IdBJ = @IdBJ
        GROUP BY p.NoBJ
      ),
      Stok AS (
        SELECT bj.IdBJ,
          SUM(
            CASE
              WHEN bj.IsPartial = 1 THEN
                CASE
                  WHEN ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0) < 0 THEN 0
                  ELSE ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0)
                END
              ELSE ISNULL(bj.Pcs, 0)
            END
          ) AS Stock
        FROM dbo.BarangJadi bj
        LEFT JOIN PartialSum ps ON ps.NoBJ = bj.NoBJ
        WHERE bj.IdBJ = @IdBJ
          AND bj.DateUsage IS NULL
        GROUP BY bj.IdBJ
      )
      SELECT
        m.IdBJ,
        ISNULL(st.Stock, 0) AS Stock,
        ISNULL(m.MinStock, 0) AS MinStock,
        ISNULL(m.MaxStock, 0) AS MaxStock,
        ISNULL(m.MPQ, 0) AS MPQ
      FROM dbo.MstBarangJadi m
      LEFT JOIN Stok st ON st.IdBJ = m.IdBJ
      WHERE m.IdBJ = @IdBJ
        AND ISNULL(m.Enable, 1) = 1;
  `);

  const row = result.recordset?.[0];
  if (!row) return null;

  return {
    IdBJ: row.IdBJ,
    Stock: toNum(row.Stock),
    MinStock: toNum(row.MinStock),
    MaxStock: toNum(row.MaxStock),
    MPQ: toNum(row.MPQ),
  };
}

async function getSpkDetail(noSPK) {
  const pool = await poolPromise;
  const code = String(noSPK || "").trim();
  if (!code) throw badReq("NoSPK wajib diisi");

  const headerResult = await pool
    .request()
    .input("NoSPK", sql.VarChar(20), code)
    .query(`
      SELECT IdSPK, NoSPK, Tanggal, Status, Keterangan, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
      FROM dbo.SPKBarangJadi_H
      WHERE NoSPK = @NoSPK;
    `);

  const header = headerResult.recordset?.[0];
  if (!header) throw notFound("SPK tidak ditemukan");

  const detailResult = await pool
    .request()
    .input("IdSPK", sql.Int, header.IdSPK)
    .query(`
      SELECT
        d.IdSPKDetail,
        d.IdBJ,
        ISNULL(m.ItemCode, '') AS ItemCode,
        m.NamaBJ,
        ISNULL(u.NamaUOM, '') AS UOM,
        d.MinStock,
        d.MaxStock,
        d.StockSaatSPK,
        d.MPQ,
        d.QtyRekomendasi,
        d.QtySPK,
        d.QtyProduksi,
        d.QtySelesai,
        d.Status,
        d.Keterangan
      FROM dbo.SPKBarangJadi_D d
      LEFT JOIN dbo.MstBarangJadi m ON m.IdBJ = d.IdBJ
      LEFT JOIN dbo.MstUOM u ON u.IdUOM = m.IdUOM
      WHERE d.IdSPK = @IdSPK
      ORDER BY d.IdSPKDetail ASC;
    `);

  const items = (detailResult.recordset || []).map((row) => ({
    IdSPKDetail: row.IdSPKDetail,
    IdBJ: row.IdBJ,
    ItemCode: row.ItemCode,
    NamaBJ: row.NamaBJ,
    UOM: row.UOM,
    MinStock: toNum(row.MinStock),
    MaxStock: toNum(row.MaxStock),
    StockSaatSPK: toNum(row.StockSaatSPK),
    MPQ: toNum(row.MPQ),
    QtyRekomendasi: toNum(row.QtyRekomendasi),
    QtySPK: toNum(row.QtySPK),
    QtyProduksi: toNum(row.QtyProduksi),
    QtySelesai: toNum(row.QtySelesai),
    Status: row.Status,
    Keterangan: row.Keterangan ?? null,
  }));

  return {
    IdSPK: header.IdSPK,
    NoSPK: header.NoSPK,
    Tanggal: toDateOnly(header.Tanggal),
    Status: header.Status,
    Keterangan: header.Keterangan ?? null,
    CreatedBy: header.CreatedBy ?? null,
    CreatedDate: header.CreatedDate ?? null,
    items,
  };
}

async function getSpkHistory({ idBJ = null, page = 1, pageSize = 10 } = {}) {
  const parsedId = parseInt(idBJ, 10);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    throw badReq("IdBJ wajib diisi");
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("IdBJ", sql.Int, parsedId)
    .query(`
      SELECT
        h.NoSPK,
        h.Tanggal,
        h.Status AS StatusSPK,
        d.QtySPK,
        d.QtySelesai,
        d.Status AS StatusBaris,
        d.StockSaatSPK,
        d.QtyRekomendasi
      FROM dbo.SPKBarangJadi_D d
      INNER JOIN dbo.SPKBarangJadi_H h ON h.IdSPK = d.IdSPK
      WHERE d.IdBJ = @IdBJ
      ORDER BY h.Tanggal DESC, h.IdSPK DESC;
    `);

  const allItems = (result.recordset || []).map((row) => ({
    NoSPK: row.NoSPK,
    Tanggal: toDateOnly(row.Tanggal),
    StatusSPK: row.StatusSPK,
    StatusBaris: row.StatusBaris,
    StockSaatSPK: toNum(row.StockSaatSPK),
    QtyRekomendasi: toNum(row.QtyRekomendasi),
    QtySPK: toNum(row.QtySPK),
    QtySelesai: toNum(row.QtySelesai),
  }));

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safePageSize = Math.min(Math.max(parseInt(pageSize, 10) || 10, 1), 100);
  const offset = (safePage - 1) * safePageSize;

  return {
    data: allItems.slice(offset, offset + safePageSize),
    total: allItems.length,
    meta: {
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(Math.ceil(allItems.length / safePageSize), 1),
      hasNextPage: safePage * safePageSize < allItems.length,
      hasPrevPage: safePage > 1,
    },
  };
}

module.exports = {
  getMonitoring,
  createSpk,
  getSpkDetail,
  getSpkHistory,
};
