// barang-dagang-read.repository.js
// Mirror pola bahan-pendukung-read.repository.js. Traceability ke dokumen
// penerimaan langsung lewat PenerimaanBarangDagang_d.NoBarangDagang (tidak
// ada tabel junction terpisah).
const { sql, poolPromise } = require("../../../../core/config/db");

exports.getAll = async ({ page, limit, search, includeUsed = false }) => {
  const pool = await poolPromise;
  const request = pool.request();
  const offset = (page - 1) * limit;
  const dateUsageFilter = includeUsed ? "" : "AND b.DateUsage IS NULL";

  const baseQuery = `
    SELECT
      b.NoBarangDagang,
      b.IdSupplier,
      sup.NmSupplier AS NamaSupplier,
      b.IdBarangDagang,
      md.NamaBarangDagang,
      b.Qty,
      b.QtyAwal,
      b.Keterangan,
      b.IsPartial,
      CASE WHEN b.DateUsage IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS Used,
      ISNULL(CAST(b.HasBeenPrinted AS int), 0) AS HasBeenPrinted,
      b.Blok,
      b.IdLokasi,
      d.NoPenerimaan
    FROM [dbo].[BarangDagang] b
    LEFT JOIN [dbo].[MstSupplier] sup ON sup.IdSupplier = b.IdSupplier
    LEFT JOIN [dbo].[MstBarangDagang] md ON md.IdBarangDagang = b.IdBarangDagang
    LEFT JOIN [dbo].[PenerimaanBarangDagang_d] d ON d.NoBarangDagang = b.NoBarangDagang
    WHERE 1=1
      ${dateUsageFilter}
      ${
        search
          ? `AND (
               b.NoBarangDagang LIKE @search
               OR b.Blok LIKE @search
               OR ISNULL(md.NamaBarangDagang,'') LIKE @search
               OR ISNULL(sup.NmSupplier,'') LIKE @search
               OR ISNULL(d.NoPenerimaan,'') LIKE @search
             )`
          : ""
      }
    ORDER BY b.NoBarangDagang DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;

  const countQuery = `
    SELECT COUNT(1) AS total
    FROM [dbo].[BarangDagang] b
    LEFT JOIN [dbo].[MstSupplier] sup ON sup.IdSupplier = b.IdSupplier
    LEFT JOIN [dbo].[MstBarangDagang] md ON md.IdBarangDagang = b.IdBarangDagang
    LEFT JOIN [dbo].[PenerimaanBarangDagang_d] d ON d.NoBarangDagang = b.NoBarangDagang
    WHERE 1=1
      ${dateUsageFilter}
      ${
        search
          ? `AND (
               b.NoBarangDagang LIKE @search
               OR b.Blok LIKE @search
               OR ISNULL(md.NamaBarangDagang,'') LIKE @search
               OR ISNULL(sup.NmSupplier,'') LIKE @search
               OR ISNULL(d.NoPenerimaan,'') LIKE @search
             )`
          : ""
      }
  `;

  request.input("offset", sql.Int, offset);
  request.input("limit", sql.Int, limit);
  if (search) {
    request.input("search", sql.VarChar, `%${search}%`);
  }

  const [dataResult, countResult] = await Promise.all([
    request.query(baseQuery),
    request.query(countQuery),
  ]);

  return {
    data: dataResult.recordset || [],
    total: countResult.recordset?.[0]?.total ?? 0,
  };
};

exports.getExistingForUpdate = async (tx, noBarangDagang) => {
  const res = await new sql.Request(tx).input("NoBarangDagang", sql.VarChar(50), noBarangDagang).query(`
    SELECT TOP 1
      NoBarangDagang, IdSupplier, IdBarangDagang,
      Qty, QtyAwal, Keterangan, IsPartial, DateUsage,
      CreateBy, CreatedAt, Blok, IdLokasi
    FROM dbo.BarangDagang WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBarangDagang = @NoBarangDagang;
  `);
  return res.recordset?.[0] || null;
};

exports.getHeaderForDelete = async (tx, noBarangDagang) => {
  const res = await new sql.Request(tx).input("NoBarangDagang", sql.VarChar(50), noBarangDagang).query(`
    SELECT TOP 1 NoBarangDagang, CreatedAt, DateUsage
    FROM dbo.BarangDagang WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBarangDagang = @NoBarangDagang;
  `);
  return res.recordset?.[0] || null;
};

exports.isNoBarangDagangExists = async (tx, noBarangDagang) => {
  const res = await new sql.Request(tx).input("NoBarangDagang", sql.VarChar(50), noBarangDagang).query(`
    SELECT 1
    FROM dbo.BarangDagang WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBarangDagang = @NoBarangDagang
  `);
  return res.recordset.length > 0;
};

exports.getByNoBarangDagang = async (noBarangDagang) => {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("NoBarangDagang", sql.VarChar(50), noBarangDagang).query(`
      SELECT
        b.NoBarangDagang, b.IdSupplier, sup.NmSupplier AS NamaSupplier,
        b.IdBarangDagang, md.NamaBarangDagang,
        b.Qty, b.QtyAwal, b.Keterangan,
        b.IsPartial,
        ISNULL(CAST(b.HasBeenPrinted AS int), 0) AS HasBeenPrinted,
        b.CreateBy,
        b.CreatedAt,
        d.NoPenerimaan
      FROM dbo.BarangDagang b
      LEFT JOIN dbo.MstSupplier sup ON sup.IdSupplier = b.IdSupplier
      LEFT JOIN dbo.MstBarangDagang md ON md.IdBarangDagang = b.IdBarangDagang
      LEFT JOIN dbo.PenerimaanBarangDagang_d d ON d.NoBarangDagang = b.NoBarangDagang
      WHERE b.NoBarangDagang = @NoBarangDagang
    `);
  return result.recordset?.[0] || null;
};
