const { sql, poolPromise } = require("../../core/config/db");
const { badReq, notFound } = require("../../core/utils/http-error");

// =========================
// VALIDASI + NORMALISASI PERMISSIONS
// =========================
// Ekspektasi body.permissions = [ { noPermission, allow }, ... ]
// - noPermission wajib & harus ada di MstPermissionList
// - allow bisa true / 1 / false / 0
function normalizePermissions(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const noPermission = String(item.noPermission || "").trim();
    if (!noPermission) continue;
    if (seen.has(noPermission)) continue;
    seen.add(noPermission);
    result.push({
      noPermission,
      allow: item.allow === true || item.allow === 1 || item.allow === "1" || item.allow === "true",
    });
  }
  return result;
}

function validateBody(body) {
  const uGroupName = String(body.uGroupName || "").trim();
  if (!uGroupName) {
    throw badReq("Nama Group harus diisi.");
  }
  if (uGroupName.length > 25) {
    throw badReq("Nama Group maksimal 25 karakter.");
  }
  const permissions = normalizePermissions(body.permissions);
  return { uGroupName, permissions };
}

async function ensurePermissionsExist(request, permissions) {
  if (!permissions.length) return;
  const noPerms = permissions.map((p) => p.noPermission);
  const placeholders = noPerms.map((_, i) => `@p${i}`).join(",");
  noPerms.forEach((p, i) => request.input(`p${i}`, sql.VarChar(100), p));
  const result = await request.query(`
    SELECT NoPermission FROM dbo.MstPermissionList
     WHERE NoPermission IN (${placeholders})`);
  const found = new Set(result.recordset.map((r) => r.NoPermission));
  const missing = noPerms.filter((p) => !found.has(p));
  if (missing.length) {
    throw badReq(`Permission tidak dikenal: ${missing.join(", ")}`);
  }
}

// =========================
// GET LIST GROUP
// =========================
async function getList(filter) {
  const pool = await poolPromise;
  const request = pool.request();
  let query = `
    SELECT g.IdUGroup,
           g.UGroupName,
           ISNULL(SUM(CASE WHEN ugp.Allow = 1 THEN 1 ELSE 0 END), 0) AS TotalAllow,
           COUNT(ugp.NoPermission) AS TotalPermission
      FROM dbo.MstUserGroup g
      LEFT JOIN dbo.MstUserGroupPermission ugp
        ON ugp.IdUGroup = g.IdUGroup
     WHERE 1 = 1`;

  if (filter && String(filter).trim() !== "") {
    query += ` AND g.UGroupName LIKE @Filter`;
    request.input("Filter", sql.VarChar(100), `%${String(filter).trim()}%`);
  }

  query += `
     GROUP BY g.IdUGroup, g.UGroupName
     ORDER BY g.UGroupName ASC`;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    IdUGroup: r.IdUGroup,
    UGroupName: r.UGroupName,
    TotalAllow: Number(r.TotalAllow) || 0,
    TotalPermission: Number(r.TotalPermission) || 0,
  }));
}

// =========================
// GET MASTER PERMISSION LIST (MstPermissionList)
// =========================
async function getPermissionList() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT NoPermission, Permission
      FROM dbo.MstPermissionList
     ORDER BY NoPermission ASC`);
  return result.recordset.map((r) => ({
    NoPermission: r.NoPermission,
    Permission: r.Permission || "",
  }));
}

// =========================
// CRUD MstPermissionList (NoPermission + Permission)
// =========================
function normalizePermissionBody(body) {
  const noPermission = String(body.noPermission || "").trim();
  const permission = String(body.permission || "").trim();

  if (!noPermission) throw badReq("NoPermission harus diisi.");
  if (noPermission.length > 50) throw badReq("NoPermission maksimal 50 karakter.");
  if (!permission) throw badReq("Permission harus diisi.");
  if (permission.length > 50) throw badReq("Permission maksimal 50 karakter.");

  return { noPermission, permission };
}

async function createPermission(body) {
  const v = normalizePermissionBody(body);
  const pool = await poolPromise;

  const exists = await pool.request()
    .input("NoPermission", sql.VarChar(100), v.noPermission)
    .query(`
      SELECT NoPermission
        FROM dbo.MstPermissionList
       WHERE NoPermission = @NoPermission`);
  if (exists.recordset.length) {
    throw badReq(`Permission "${v.noPermission}" sudah ada.`);
  }

  await pool.request()
    .input("NoPermission", sql.VarChar(100), v.noPermission)
    .input("Permission", sql.VarChar(200), v.permission)
    .query(`
      INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
      VALUES (@NoPermission, @Permission)`);

  return { noPermission: v.noPermission };
}

async function updatePermission(noPermission, body) {
  const v = normalizePermissionBody(body);
  const pool = await poolPromise;

  const exists = await pool.request()
    .input("NoPermission", sql.VarChar(100), noPermission)
    .query(`
      SELECT NoPermission
        FROM dbo.MstPermissionList
       WHERE NoPermission = @NoPermission`);
  if (!exists.recordset.length) {
    throw notFound("Permission tidak ditemukan.");
  }

  await pool.request()
    .input("NoPermission", sql.VarChar(100), noPermission)
    .input("Permission", sql.VarChar(200), v.permission)
    .query(`
      UPDATE dbo.MstPermissionList
         SET Permission = @Permission
       WHERE NoPermission = @NoPermission`);

  return { noPermission };
}

async function deletePermission(noPermission) {
  const pool = await poolPromise;

  const exists = await pool.request()
    .input("NoPermission", sql.VarChar(100), noPermission)
    .query(`
      SELECT NoPermission
        FROM dbo.MstPermissionList
       WHERE NoPermission = @NoPermission`);
  if (!exists.recordset.length) {
    throw notFound("Permission tidak ditemukan.");
  }

  await pool.request()
    .input("NoPermission", sql.VarChar(100), noPermission)
    .query(`DELETE FROM dbo.MstPermissionList WHERE NoPermission = @NoPermission`);

  return { noPermission };
}

// =========================
// GET DETAIL GROUP (header + permissions)
// =========================
async function getDetail(idUGroup) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdUGroup", sql.Int, Number(idUGroup));

  const headerResult = await request.query(`
    SELECT IdUGroup, UGroupName
      FROM dbo.MstUserGroup
     WHERE IdUGroup = @IdUGroup`);

  if (!headerResult.recordset.length) return null;
  const header = headerResult.recordset[0];

  const permResult = await request.query(`
    SELECT ugp.NoPermission, ugp.Allow, pl.Permission
      FROM dbo.MstUserGroupPermission ugp
      LEFT JOIN dbo.MstPermissionList pl
        ON pl.NoPermission = ugp.NoPermission
     WHERE ugp.IdUGroup = @IdUGroup
     ORDER BY ugp.NoPermission ASC`);

  return {
    IdUGroup: header.IdUGroup,
    UGroupName: header.UGroupName,
    Permissions: permResult.recordset.map((r) => ({
      NoPermission: r.NoPermission,
      Permission: r.Permission || "",
      Allow: r.Allow === true || r.Allow === 1,
    })),
  };
}

// =========================
// INSERT PERMISSIONS (dipakai saveNew & saveUpdate)
// =========================
async function insertPermissions(tx, idUGroup, permissions) {
  for (const p of permissions) {
    const request = new sql.Request(tx);
    await request
      .input("IdUGroup", sql.Int, idUGroup)
      .input("NoPermission", sql.VarChar(100), p.noPermission)
      .input("Allow", sql.Bit, p.allow)
      .query(`
        INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
        VALUES (@IdUGroup, @NoPermission, @Allow)`);
  }
}

// =========================
// SIMPAN BARU - SATU TRANSAKSI
// =========================
async function saveNew(body) {
  const v = validateBody(body);
  const pool = await poolPromise;
  const request = pool.request();

  await ensurePermissionsExist(request, v.permissions);

  const dupResult = await request
    .input("UGroupName", sql.VarChar(100), v.uGroupName)
    .query(`
      SELECT IdUGroup FROM dbo.MstUserGroup
       WHERE UGroupName = @UGroupName`);
  if (dupResult.recordset.length) {
    throw badReq("Nama Group sudah digunakan.");
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const nextIdResult = await new sql.Request(tx)
      .query(`SELECT ISNULL(MAX(IdUGroup), 0) + 1 AS NextId FROM dbo.MstUserGroup`);
    const idUGroup = nextIdResult.recordset[0].NextId;

    await new sql.Request(tx)
      .input("IdUGroup", sql.Int, idUGroup)
      .input("UGroupName", sql.VarChar(100), v.uGroupName)
      .query(`
        INSERT INTO dbo.MstUserGroup (IdUGroup, UGroupName)
        VALUES (@IdUGroup, @UGroupName)`);

    if (v.permissions.length) {
      await insertPermissions(tx, idUGroup, v.permissions);
    }

    await tx.commit();
    return idUGroup;
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

// =========================
// UBAH - SATU TRANSAKSI
// =========================
async function saveUpdate(idUGroup, body) {
  const v = validateBody(body);
  const id = Number(idUGroup);
  const pool = await poolPromise;

  const poolRequest = pool.request();
  poolRequest.input("IdUGroup", sql.Int, id);
  const cekResult = await poolRequest.query(`
    SELECT IdUGroup FROM dbo.MstUserGroup
     WHERE IdUGroup = @IdUGroup`);
  if (!cekResult.recordset.length) {
    throw notFound("Data tidak ditemukan.");
  }

  const dupResult = await pool.request()
    .input("UGroupName", sql.VarChar(100), v.uGroupName)
    .input("IdUGroup", sql.Int, id)
    .query(`
      SELECT IdUGroup FROM dbo.MstUserGroup
       WHERE UGroupName = @UGroupName AND IdUGroup <> @IdUGroup`);
  if (dupResult.recordset.length) {
    throw badReq("Nama Group sudah digunakan.");
  }

  const permsRequester = pool.request();
  await ensurePermissionsExist(permsRequester, v.permissions);

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    await new sql.Request(tx)
      .input("IdUGroup", sql.Int, id)
      .input("UGroupName", sql.VarChar(100), v.uGroupName)
      .query(`
        UPDATE dbo.MstUserGroup
           SET UGroupName = @UGroupName
         WHERE IdUGroup = @IdUGroup`);

    // Hapus semua permission lama, insert ulang
    await new sql.Request(tx)
      .input("IdUGroup", sql.Int, id)
      .query(`DELETE FROM dbo.MstUserGroupPermission WHERE IdUGroup = @IdUGroup`);

    if (v.permissions.length) {
      const txRequest = new sql.Request(tx);
      await insertPermissions(tx, id, v.permissions);
    }

    await tx.commit();
    return id;
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

// =========================
// HAPUS
// =========================
async function remove(idUGroup) {
  const id = Number(idUGroup);
  const pool = await poolPromise;

  // Cek apakah group sedang dipakai di MstUserGroupMember
  const memberCheck = await pool.request()
    .input("IdUGroup", sql.Int, id)
    .query(`
      SELECT DISTINCT TOP 1 IdUGroup
        FROM dbo.MstUserGroupMember
       WHERE IdUGroup = @IdUGroup`);
  if (memberCheck.recordset.length) {
    throw badReq("Group tidak dapat dihapus karena masih dipakai oleh user.");
  }

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const cek = await new sql.Request(tx)
      .input("IdUGroup", sql.Int, id)
      .query(`SELECT IdUGroup FROM dbo.MstUserGroup WHERE IdUGroup = @IdUGroup`);
    if (!cek.recordset.length) {
      throw notFound("Data tidak ditemukan.");
    }

    await new sql.Request(tx)
      .input("IdUGroup", sql.Int, id)
      .query(`DELETE FROM dbo.MstUserGroupPermission WHERE IdUGroup = @IdUGroup`);
    await new sql.Request(tx)
      .input("IdUGroup", sql.Int, id)
      .query(`DELETE FROM dbo.MstUserGroup WHERE IdUGroup = @IdUGroup`);

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
}

module.exports = {
  getList,
  getPermissionList,
  createPermission,
  updatePermission,
  deletePermission,
  getDetail,
  saveNew,
  saveUpdate,
  remove,
};