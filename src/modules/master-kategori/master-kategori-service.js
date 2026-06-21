const { poolPromise } = require("../../core/config/db");

async function getAllKategori() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT
      IdKategori, KodeKategori, NamaKategori, Enable,
      CreatedAt, UpdatedAt, IsWaste, PrefixLabel,
      NamaTableJenis, NamaKolomIdJenis, NamaKolomNamaJenis,
      NamaTableLabel, NamaKolomNoLabel, NamaKolomIdJenisDiLabel
    FROM [dbo].[MstKategori]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaKategori ASC;
  `);
  return result.recordset || [];
}

module.exports = { getAllKategori };
