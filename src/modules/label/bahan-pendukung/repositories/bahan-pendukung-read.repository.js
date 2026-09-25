// bahan-pendukung-read.repository.js
// Mirror pola furniture-wip-read.repository.js. Traceability ke dokumen
// penerimaan sekarang langsung lewat PenerimaanBahanPendukung_d.NoBahanPendukung
// (tidak ada tabel junction terpisah lagi).
const { sql, poolPromise } = require("../../../../core/config/db");

exports.getAll = async ({ page, limit, search, includeUsed = false }) => {
  const pool = await poolPromise;
  const request = pool.request();
  const offset = (page - 1) * limit;
  const dateUsageFilter = includeUsed ? "" : "AND b.DateUsage IS NULL";

  const baseQuery = `
    SELECT
      b.NoBahanPendukung,
      b.IdSupplier,
      sup.NmSupplier AS NamaSupplier,
      b.IdCabinetMaterial,
      cm.Nama AS NamaCabinetMaterial,
      b.Qty,
      b.Keterangan,
      b.IsPartial,
      CASE WHEN b.DateUsage IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS Used,
      ISNULL(CAST(b.HasBeenPrinted AS int), 0) AS HasBeenPrinted,
      b.Blok,
      b.IdLokasi,
      d.NoPenerimaan
    FROM [dbo].[BahanPendukung] b
    LEFT JOIN [dbo].[MstSupplier] sup ON sup.IdSupplier = b.IdSupplier
    LEFT JOIN [dbo].[MstCabinetMaterial] cm ON cm.IdCabinetMaterial = b.IdCabinetMaterial
    LEFT JOIN [dbo].[PenerimaanBahanPendukung_d] d ON d.NoBahanPendukung = b.NoBahanPendukung
    WHERE 1=1
      ${dateUsageFilter}
      ${
        search
          ? `AND (
               b.NoBahanPendukung LIKE @search
               OR b.Blok LIKE @search
               OR ISNULL(cm.Nama,'') LIKE @search
               OR ISNULL(sup.NmSupplier,'') LIKE @search
               OR ISNULL(d.NoPenerimaan,'') LIKE @search
             )`
          : ""
      }
    ORDER BY b.NoBahanPendukung DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;

  const countQuery = `
    SELECT COUNT(1) AS total
    FROM [dbo].[BahanPendukung] b
    LEFT JOIN [dbo].[MstSupplier] sup ON sup.IdSupplier = b.IdSupplier
    LEFT JOIN [dbo].[MstCabinetMaterial] cm ON cm.IdCabinetMaterial = b.IdCabinetMaterial
    LEFT JOIN [dbo].[PenerimaanBahanPendukung_d] d ON d.NoBahanPendukung = b.NoBahanPendukung
    WHERE 1=1
      ${dateUsageFilter}
      ${
        search
          ? `AND (
               b.NoBahanPendukung LIKE @search
               OR b.Blok LIKE @search
               OR ISNULL(cm.Nama,'') LIKE @search
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

exports.getExistingForUpdate = async (tx, noBahanPendukung) => {
  const res = await new sql.Request(tx).input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung).query(`
    SELECT TOP 1
      NoBahanPendukung, IdSupplier, IdCabinetMaterial,
      Qty, Keterangan, IsPartial, DateUsage,
      CreateBy, CreatedAt, Blok, IdLokasi
    FROM dbo.BahanPendukung WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBahanPendukung = @NoBahanPendukung;
  `);
  return res.recordset?.[0] || null;
};

exports.getHeaderForDelete = async (tx, noBahanPendukung) => {
  const res = await new sql.Request(tx).input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung).query(`
    SELECT TOP 1 NoBahanPendukung, CreatedAt, DateUsage
    FROM dbo.BahanPendukung WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBahanPendukung = @NoBahanPendukung;
  `);
  return res.recordset?.[0] || null;
};

exports.isNoBahanPendukungExists = async (tx, noBahanPendukung) => {
  const res = await new sql.Request(tx).input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung).query(`
    SELECT 1
    FROM dbo.BahanPendukung WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBahanPendukung = @NoBahanPendukung
  `);
  return res.recordset.length > 0;
};

exports.getByNoBahanPendukung = async (noBahanPendukung) => {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung).query(`
      SELECT
        b.NoBahanPendukung, b.IdSupplier, sup.NmSupplier AS NamaSupplier,
        b.IdCabinetMaterial, cm.Nama AS NamaCabinetMaterial,
        b.Qty, b.QtyAwal, b.Keterangan,
        b.IsPartial,
        ISNULL(CAST(b.HasBeenPrinted AS int), 0) AS HasBeenPrinted,
        b.CreateBy,
        b.CreatedAt,
        d.NoPenerimaan
      FROM dbo.BahanPendukung b
      LEFT JOIN dbo.MstSupplier sup ON sup.IdSupplier = b.IdSupplier
      LEFT JOIN dbo.MstCabinetMaterial cm ON cm.IdCabinetMaterial = b.IdCabinetMaterial
      LEFT JOIN dbo.PenerimaanBahanPendukung_d d ON d.NoBahanPendukung = b.NoBahanPendukung
      WHERE b.NoBahanPendukung = @NoBahanPendukung
    `);
  return result.recordset?.[0] || null;
};
