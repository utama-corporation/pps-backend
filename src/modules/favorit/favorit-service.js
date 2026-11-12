const { sql, poolPromise } = require("../../core/config/db");

const list = async (idUsername) => {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("id", sql.Int, idUsername)
    .query(`
      SELECT Tipe AS tipe, Kode AS kode, Urutan AS urutan, Komentar AS komentar
      FROM dbo.MstUserFavorit
      WHERE IdUsername = @id
      ORDER BY Urutan, Kode
    `);
  return result.recordset;
};

// Idempoten: bila sudah ada, tidak berubah. Entri baru masuk di urutan paling bawah.
const add = async (idUsername, tipe, kode, komentar = null) => {
  const pool = await poolPromise;
  await pool
    .request()
    .input("id", sql.Int, idUsername)
    .input("tipe", sql.VarChar(20), tipe)
    .input("kode", sql.VarChar(200), kode)
    .input("komentar", sql.NVarChar(500), komentar)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.MstUserFavorit WITH (UPDLOCK, HOLDLOCK)
        WHERE IdUsername = @id AND Tipe = @tipe AND Kode = @kode
      )
      INSERT INTO dbo.MstUserFavorit (IdUsername, Tipe, Kode, Urutan, Komentar)
      SELECT @id, @tipe, @kode,
             ISNULL((SELECT MAX(Urutan) FROM dbo.MstUserFavorit WHERE IdUsername = @id), 0) + 1,
             @komentar
    `);
};

const remove = async (idUsername, tipe, kode) => {
  const pool = await poolPromise;
  await pool
    .request()
    .input("id", sql.Int, idUsername)
    .input("tipe", sql.VarChar(20), tipe)
    .input("kode", sql.VarChar(200), kode)
    .query(`
      DELETE FROM dbo.MstUserFavorit
      WHERE IdUsername = @id AND Tipe = @tipe AND Kode = @kode
    `);
};

// Hanya entri milik user yang diubah urutannya; entri yang tidak ada di `items` dibiarkan.
const reorder = async (idUsername, items) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (let i = 0; i < items.length; i++) {
      await new sql.Request(tx)
        .input("id", sql.Int, idUsername)
        .input("tipe", sql.VarChar(20), items[i].tipe)
        .input("kode", sql.VarChar(200), items[i].kode)
        .input("urutan", sql.Int, i + 1)
        .query(`
          UPDATE dbo.MstUserFavorit SET Urutan = @urutan
          WHERE IdUsername = @id AND Tipe = @tipe AND Kode = @kode
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
};

module.exports = { list, add, remove, reorder };
