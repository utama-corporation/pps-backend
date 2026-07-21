const { sql, poolPromise } = require("../../core/config/db");
const { notFound } = require("../../core/utils/http-error");

async function listAllUsers() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT TOP (1000)
      IdUsername,
      Username,
      FName,
      LName,
      DefaultPage,
      Status,
      IsEnable,
      EmployeeID,
      CompanyID,
      Nik
    FROM [dbo].[MstUsername]
    ORDER BY Username ASC;
  `);
  return result.recordset || [];
}

async function listUsersByLokasi(blok, idLokasi) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi).query(`
      SELECT a.Blok, a.IdLokasi, a.IdUsername, u.Username, u.FName, u.LName, a.CreatedAt
      FROM [dbo].[MstUserLokasiAccess] a
      LEFT JOIN [dbo].[MstUsername] u ON u.IdUsername = a.IdUsername
      WHERE a.Blok = @blok AND a.IdLokasi = @idLokasi
      ORDER BY u.Username ASC;
    `);
  return result.recordset || [];
}

async function listLokasiByUser(idUsername) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("idUsername", sql.Int, idUsername).query(`
      SELECT a.Blok, a.IdLokasi, a.IdUsername, a.CreatedAt
      FROM [dbo].[MstUserLokasiAccess] a
      WHERE a.IdUsername = @idUsername
      ORDER BY a.Blok ASC, a.IdLokasi ASC;
    `);
  return result.recordset || [];
}

async function assignAccess({ blok, idLokasi, idUsername }) {
  const pool = await poolPromise;
  await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername).query(`
      IF NOT EXISTS (
        SELECT 1 FROM [dbo].[MstUserLokasiAccess]
        WHERE Blok = @blok AND IdLokasi = @idLokasi AND IdUsername = @idUsername
      )
      INSERT INTO [dbo].[MstUserLokasiAccess] (Blok, IdLokasi, IdUsername)
      VALUES (@blok, @idLokasi, @idUsername);
    `);
  return { blok, idLokasi, idUsername };
}

async function revokeAccess({ blok, idLokasi, idUsername }) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername).query(`
      DELETE FROM [dbo].[MstUserLokasiAccess]
      WHERE Blok = @blok AND IdLokasi = @idLokasi AND IdUsername = @idUsername;
    `);

  if (result.rowsAffected[0] === 0) {
    throw notFound(
      `Assignment untuk user ${idUsername} pada lokasi ${blok}/${idLokasi} tidak ditemukan`,
    );
  }

  return { blok, idLokasi, idUsername };
}

async function listAllowedUsersGroupedByLokasi(blok) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("blok", sql.VarChar(100), blok).query(`
      SELECT a.IdLokasi, a.IdUsername, u.Username, u.FName, u.LName
      FROM [dbo].[MstUserLokasiAccess] a
      LEFT JOIN [dbo].[MstUsername] u ON u.IdUsername = a.IdUsername
      WHERE a.Blok = @blok
      ORDER BY a.IdLokasi ASC, u.Username ASC;
    `);

  const map = new Map();
  for (const row of result.recordset || []) {
    if (!map.has(row.IdLokasi)) map.set(row.IdLokasi, []);
    map.get(row.IdLokasi).push({
      idUsername: row.IdUsername,
      username: row.Username,
      fullName: [row.FName, row.LName].filter(Boolean).join(" ") || null,
    });
  }
  return map;
}

async function isUserAllowedForLokasi({ blok, idLokasi, idUsername }) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername).query(`
      SELECT TOP 1 1 AS found
      FROM [dbo].[MstUserLokasiAccess]
      WHERE Blok = @blok AND IdLokasi = @idLokasi AND IdUsername = @idUsername;
    `);
  return (result.recordset || []).length > 0;
}

module.exports = {
  listAllUsers,
  listUsersByLokasi,
  listLokasiByUser,
  assignAccess,
  revokeAccess,
  isUserAllowedForLokasi,
  listAllowedUsersGroupedByLokasi,
};
