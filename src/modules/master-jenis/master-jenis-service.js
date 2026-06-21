const { sql, poolPromise } = require("../../core/config/db");

function isSafe(v) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(v || "").trim());
}

async function getJenisByKategori(idKategori) {
  const pool = await poolPromise;

  const kategoriResult = await pool
    .request()
    .input("idKategori", sql.Int, idKategori)
    .query(`
      SELECT KodeKategori, NamaKategori, NamaTableJenis, NamaKolomIdJenis, NamaKolomNamaJenis
      FROM [dbo].[MstKategori]
      WHERE IdKategori = @idKategori AND ISNULL(Enable, 1) = 1;
    `);

  const kategori = kategoriResult.recordset?.[0];
  if (!kategori) return null;

  const tableName = String(kategori.NamaTableJenis || "").trim();
  const idColumn = String(kategori.NamaKolomIdJenis || "").trim();
  const nameColumn = String(kategori.NamaKolomNamaJenis || "").trim();

  if (!isSafe(tableName) || !isSafe(idColumn) || !isSafe(nameColumn)) return null;

  const jenisResult = await pool.request().query(`
    SELECT
      CAST(${idColumn} AS int) AS IdJenis,
      CAST(${nameColumn} AS nvarchar(4000)) AS NamaJenis
    FROM [dbo].[${tableName}] WITH (NOLOCK)
    ORDER BY ${nameColumn} ASC;
  `);

  return {
    kategori: {
      idKategori,
      kodeKategori: kategori.KodeKategori,
      namaKategori: kategori.NamaKategori,
    },
    jenis: jenisResult.recordset || [],
  };
}

module.exports = { getJenisByKategori };
