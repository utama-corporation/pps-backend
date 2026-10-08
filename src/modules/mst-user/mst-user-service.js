const sql = require('mssql');
const { poolPromise } = require('../../core/config/db');
const { badReq, notFound, conflict } = require('../../core/utils/http-error');
const { hashPassword } = require('../../core/utils/crypto-helper');

const DEFAULT_PASSWORD = 'Utama1234';
const EMPLOYEE_DBS = {
  as_gsu: 'AS_GSU',
  as_ru: 'AS_RU',
  as_uc_2017: 'AS_UC_2017',
};

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeGroupIds(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  return [...new Set(list.map((v) => toInt(v)).filter((v) => v > 0))];
}

async function listUsers(q) {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT u.IdUsername, u.Username, u.FName, u.LName, u.EmployeeID, u.CompanyID, u.Nik,
      u.[Status], u.IsEnable,
      ISNULL(g.UGroupName, '') AS GroupName
    FROM [dbo].[MstUsername] u
    LEFT JOIN [dbo].[MstUserGroupMember] m ON m.IdUsername = u.IdUsername
    LEFT JOIN [dbo].[MstUserGroup] g ON g.IdUGroup = m.IdUGroup
    ORDER BY u.IdUsername ASC;
  `);

  const search = clean(q).toLowerCase();
  let data = (result.recordset || []).map((row) => ({
    IdUsername: toInt(row.IdUsername),
    Username: clean(row.Username),
    FName: clean(row.FName),
    LName: clean(row.LName),
    EmployeeID: row.EmployeeID === null || row.EmployeeID === undefined ? '' : toInt(row.EmployeeID),
    CompanyID: clean(row.CompanyID),
    Nik: clean(row.Nik),
    Status: clean(row.Status),
    IsEnable: row.IsEnable === true || row.IsEnable === 1,
    GroupName: clean(row.GroupName),
  }));

  if (search) {
    data = data.filter((row) =>
      `${row.Username} ${row.FName} ${row.LName} ${row.Nik} ${row.EmployeeID}`.toLowerCase().includes(search),
    );
  }
  return data;
}

async function listGroups() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT IdUGroup, UGroupName FROM [dbo].[MstUserGroup] ORDER BY UGroupName ASC;
  `);
  return (result.recordset || []).map((row) => ({
    IdUGroup: toInt(row.IdUGroup),
    UGroupName: clean(row.UGroupName),
  }));
}

async function getUserGroups(idUsername) {
  const id = toInt(idUsername);
  if (!id) throw notFound('User tidak ditemukan');
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('IdUsername', sql.Int, id)
    .query(`
      SELECT g.IdUGroup, g.UGroupName
      FROM [dbo].[MstUserGroupMember] m
      INNER JOIN [dbo].[MstUserGroup] g ON g.IdUGroup = m.IdUGroup
      WHERE m.IdUsername = @IdUsername
      ORDER BY g.UGroupName ASC;
    `);
  return (result.recordset || []).map((row) => ({
    IdUGroup: toInt(row.IdUGroup),
    UGroupName: clean(row.UGroupName),
  }));
}

async function searchEmployees(db, q) {
  const dbName = clean(db).toLowerCase();
  if (!EMPLOYEE_DBS[dbName]) throw badReq('Database karyawan tidak dikenal (pilihan: AS_GSU, AS_RU, AS_UC_2017)');

  const pool = await poolPromise;
  const keyword = `%${clean(q)}%`;
  const request = pool.request().input('kw', sql.VarChar, keyword);
  const result = await request.query(`
    SELECT EmployeeID, EmployeeCode, FullName
    FROM [${dbName}].[dbo].[HRM_Employees]
    WHERE FullName LIKE @kw
       OR CAST(EmployeeID AS VARCHAR) LIKE @kw
       OR EmployeeCode LIKE @kw
    ORDER BY FullName ASC;
  `);
  return (result.recordset || []).map((row) => ({
    EmployeeID: toInt(row.EmployeeID),
    EmployeeCode: clean(row.EmployeeCode),
    FullName: clean(row.FullName),
    CompanyID: EMPLOYEE_DBS[dbName],
  }));
}

function normalizeCreate(body) {
  const fName = clean(body?.fName);
  const lName = clean(body?.lName);
  const username = clean(body?.username);
  const password = clean(body?.password);
  const employeeId = toInt(body?.employeeId);
  const company = clean(body?.companyId).toUpperCase();
  const nik = clean(body?.nik);
  const groupIds = normalizeGroupIds(body?.idUGroup ?? body?.groupIds);

  if (!fName) throw badReq('Silahkan isi Nama Depan.');
  if (!username) throw badReq('Silahkan isi Username.');
  if (!password) throw badReq('Silahkan isi Password.');
  if (!employeeId) throw badReq('Employee ID wajib diisi.');
  if (!nik) throw badReq('NIK / Employee Code belum terbaca. Silahkan pilih karyawan dari tombol Cari.');
  if (!company) throw badReq('Silahkan gunakan tombol Cari Karyawan untuk memilih Employee ID dan database perusahaan.');
  if (groupIds.length > 1) throw badReq('Group Permission tidak boleh lebih dari 1. Pilih hanya 1 group.');
  if (username.length > 25) throw badReq('Username maksimal 25 karakter.');
  if (fName.length > 25) throw badReq('Nama Depan maksimal 25 karakter.');
  if (lName.length > 25) throw badReq('Nama Belakang maksimal 25 karakter.');
  if (nik.length > 10) throw badReq('NIK maksimal 10 karakter.');
  if (company.length > 10) throw badReq('Company ID maksimal 10 karakter.');

  return { fName, lName, username, password, employeeId, company, nik, groupIds };
}

async function create(body) {
  const payload = normalizeCreate(body);
  const pool = await poolPromise;
  const hashed = hashPassword(payload.password);
  if (!hashed) throw badReq('Gagal meng-hash password');

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const dupUser = await tx
      .request()
      .input('Username', sql.VarChar, payload.username)
      .query('SELECT TOP 1 1 FROM [dbo].[MstUsername] WITH (NOLOCK) WHERE Username = @Username');
    if ((dupUser.recordset || []).length) {
      throw conflict('Username sudah digunakan. Silahkan pilih username lain.');
    }

    const dupNik = await tx
      .request()
      .input('Nik', sql.VarChar, payload.nik)
      .query('SELECT TOP 1 1 FROM [dbo].[MstUsername] WITH (NOLOCK) WHERE Nik = @Nik');
    if ((dupNik.recordset || []).length) {
      throw conflict('NIK / Employee Code ini sudah terdaftar sebagai user.');
    }

    const idResult = await tx.request().query('SELECT ISNULL(MAX(IdUsername), 0) + 1 AS NextId FROM [dbo].[MstUsername];');
    const nextId = toInt((idResult.recordset || [])[0]?.NextId, 1);

    await tx
      .request()
      .input('IdUsername', sql.Int, nextId)
      .input('Username', sql.VarChar, payload.username)
      .input('FName', sql.VarChar, payload.fName)
      .input('LName', sql.VarChar, payload.lName)
      .input('Password', sql.VarChar, hashed)
      .input('EmployeeID', sql.Int, payload.employeeId)
      .input('CompanyID', sql.VarChar, payload.company)
      .input('Nik', sql.VarChar, payload.nik)
      .query(`
        INSERT INTO [dbo].[MstUsername]
          (IdUsername, Username, FName, LName, DefaultPage, [Password], [Status], IsEnable, EmployeeID, CompanyID, Nik)
        VALUES
          (@IdUsername, @Username, @FName, @LName, 1, @Password, 'OFFLINE', 1, @EmployeeID, @CompanyID, @Nik);
      `);

    for (const idUGroup of payload.groupIds) {
      await tx
        .request()
        .input('IdUGroup', sql.Int, idUGroup)
        .input('IdUsername', sql.Int, nextId)
        .query('INSERT INTO [dbo].[MstUserGroupMember] (IdUGroup, IdUsername) VALUES (@IdUGroup, @IdUsername);');
    }

    await tx.commit();
    return {
      IdUsername: nextId,
      Username: payload.username,
      FName: payload.fName,
      LName: payload.lName,
      EmployeeID: payload.employeeId,
      CompanyID: payload.company,
      Nik: payload.nik,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }
}

function normalizeUpdate(body) {
  const idUsername = toInt(body?.idUsername);
  const fName = clean(body?.fName);
  const lName = clean(body?.lName);
  const employeeId = toInt(body?.employeeId);
  const resetPassword = body?.resetPassword === true || body?.resetPassword === 1;
  const groupIds = normalizeGroupIds(body?.idUGroup ?? body?.groupIds);

  if (!idUsername) throw notFound('User tidak ditemukan');
  if (!fName) throw badReq('Silahkan isi Nama Depan.');
  if (!employeeId) throw badReq('Employee ID harus berupa angka.');
  if (!groupIds.length) throw badReq('Pilih Group Permission (1 group) untuk user ini.');
  if (groupIds.length > 1) throw badReq('Group Permission tidak boleh lebih dari 1. Pilih hanya 1 group.');

  return { idUsername, fName, lName, employeeId, resetPassword, groupIds };
}

async function update(body) {
  const payload = normalizeUpdate(body);
  const pool = await poolPromise;

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const exists = await tx
      .request()
      .input('IdUsername', sql.Int, payload.idUsername)
      .query('SELECT TOP 1 1 FROM [dbo].[MstUsername] WHERE IdUsername = @IdUsername');
    if (!(exists.recordset || []).length) throw notFound('User tidak ditemukan');

    const updateRequest = tx
      .request()
      .input('FName', sql.VarChar, payload.fName)
      .input('LName', sql.VarChar, payload.lName)
      .input('EmployeeID', sql.Int, payload.employeeId)
      .input('IdUsername', sql.Int, payload.idUsername);

    let updateSql = 'UPDATE [dbo].[MstUsername] SET FName = @FName, LName = @LName, EmployeeID = @EmployeeID';
    if (payload.resetPassword) {
      const hashed = hashPassword(DEFAULT_PASSWORD);
      if (!hashed) throw badReq('Gagal meng-hash password');
      updateRequest.input('Password', sql.VarChar, hashed);
      updateSql += ', [Password] = @Password';
    }
    updateSql += ' WHERE IdUsername = @IdUsername;';
    await updateRequest.query(updateSql);

    await tx
      .request()
      .input('IdUsername', sql.Int, payload.idUsername)
      .query('DELETE FROM [dbo].[MstUserGroupMember] WHERE IdUsername = @IdUsername;');

    for (const idUGroup of payload.groupIds) {
      await tx
        .request()
        .input('IdUGroup', sql.Int, idUGroup)
        .input('IdUsername', sql.Int, payload.idUsername)
        .query('INSERT INTO [dbo].[MstUserGroupMember] (IdUGroup, IdUsername) VALUES (@IdUGroup, @IdUsername);');
    }

    await tx.commit();
    return { IdUsername: payload.idUsername, FName: payload.fName, LName: payload.lName, EmployeeID: payload.employeeId };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }
}

async function remove(idUsername) {
  const id = toInt(idUsername);
  if (!id) throw notFound('User tidak ditemukan');

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const exists = await tx
      .request()
      .input('IdUsername', sql.Int, id)
      .query('SELECT TOP 1 1 FROM [dbo].[MstUsername] WHERE IdUsername = @IdUsername');
    if (!(exists.recordset || []).length) throw notFound('User tidak ditemukan');

    await tx
      .request()
      .input('IdUsername', sql.Int, id)
      .query('DELETE FROM [dbo].[MstUserGroupMember] WHERE IdUsername = @IdUsername;');
    await tx
      .request()
      .input('IdUsername', sql.Int, id)
      .query('DELETE FROM [dbo].[MstUsername] WHERE IdUsername = @IdUsername;');

    await tx.commit();
    return { IdUsername: id };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }
}

module.exports = {
  listUsers,
  listGroups,
  getUserGroups,
  searchEmployees,
  create,
  update,
  remove,
};
