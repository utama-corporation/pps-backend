// master-supplier-manage-service.js
// CRUD Master Supplier (port dari FrmMstSupplier.vb)
const { poolPromise, sql } = require("../../../core/config/db");
const { badReq, notFound, conflict } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");

const PHONE_RE = /^[0-9\-.,]*$/;

function normalizeNama(raw) {
  const nama = String(raw ?? "").trim();
  if (!nama) throw badReq("Nama supplier wajib diisi.");
  if (nama.length > 100) throw badReq("Nama supplier maksimal 100 karakter.");
  return nama;
}

function normalizeInitial(raw) {
  const initial = String(raw ?? "").trim();
  if (initial.length > 25) throw badReq("Initial maksimal 25 karakter.");
  return initial;
}

function normalizeNoTlp(raw) {
  const noTlp = String(raw ?? "").trim();
  if (noTlp.length > 25) throw badReq("No. Tlp/HP maksimal 25 karakter.");
  if (!PHONE_RE.test(noTlp)) {
    throw badReq("No. Tlp/HP hanya boleh angka dan karakter - . ,");
  }
  return noTlp;
}

function normalizeEnable(raw) {
  return raw === undefined || raw === null ? 1 : raw ? 1 : 0;
}

function parseId(raw) {
  const id = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) throw badReq("ID supplier tidak valid.");
  return id;
}

async function withTransaction(audit, fn) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await applyAuditContext(new sql.Request(tx), audit);
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {
      /* abaikan */
    }
    throw error;
  }
}

const SELECT_COLS = `
  IdSupplier,
  ISNULL(NmSupplier, '') AS NmSupplier,
  ISNULL(Initial, '') AS Initial,
  ISNULL(NoTlp, '') AS NoTlp,
  ISNULL([Enable], 0) AS Enable
`;

async function getById(tx, id) {
  const result = await new sql.Request(tx)
    .input("Id", sql.Int, id)
    .query(`SELECT ${SELECT_COLS} FROM dbo.MstSupplier WHERE IdSupplier = @Id`);
  return result.recordset[0] || null;
}

async function assertNamaUnique(tx, nama, exceptId = 0) {
  const dup = await new sql.Request(tx)
    .input("Nama", sql.VarChar(100), nama)
    .input("Id", sql.Int, exceptId)
    .query(`
      SELECT COUNT(1) AS c FROM dbo.MstSupplier
      WHERE NmSupplier = @Nama AND IdSupplier <> @Id
    `);
  if (dup.recordset[0].c > 0) throw conflict("Nama supplier sudah ada.");
}

async function list({ q = "", status = "all" } = {}) {
  const pool = await poolPromise;
  const request = pool.request();
  const conditions = [];

  const keyword = String(q ?? "").trim();
  if (keyword) {
    conditions.push("(NmSupplier LIKE @q OR Initial LIKE @q)");
    request.input("q", sql.VarChar(120), `%${keyword}%`);
  }
  if (status === "active") conditions.push("ISNULL([Enable], 0) = 1");
  if (status === "inactive") conditions.push("ISNULL([Enable], 0) = 0");

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await request.query(`
    SELECT ${SELECT_COLS}
    FROM dbo.MstSupplier
    ${where}
    ORDER BY IdSupplier ASC
  `);
  return result.recordset || [];
}

async function create({ namaSupplier, initial, noTlp, enable }, audit) {
  const nama = normalizeNama(namaSupplier);
  const init = normalizeInitial(initial);
  const tlp = normalizeNoTlp(noTlp);
  const enableFlag = normalizeEnable(enable);

  return withTransaction(audit, async (tx) => {
    await assertNamaUnique(tx, nama);

    // IdSupplier bukan identity (sama seperti aplikasi VB: MAX + 1)
    const idResult = await new sql.Request(tx).query(
      "SELECT ISNULL(MAX(IdSupplier), 0) + 1 AS nextId FROM dbo.MstSupplier WITH (UPDLOCK, HOLDLOCK)",
    );
    const id = idResult.recordset[0].nextId;

    await new sql.Request(tx)
      .input("Id", sql.Int, id)
      .input("Nama", sql.VarChar(100), nama)
      .input("Initial", sql.VarChar(25), init)
      .input("NoTlp", sql.VarChar(25), tlp)
      .input("Enable", sql.Bit, enableFlag).query(`
        INSERT INTO dbo.MstSupplier (IdSupplier, NmSupplier, Initial, NoTlp, [Enable])
        VALUES (@Id, @Nama, @Initial, @NoTlp, @Enable)
      `);

    return getById(tx, id);
  });
}

async function update(idRaw, { namaSupplier, initial, noTlp, enable }, audit) {
  const id = parseId(idRaw);
  const nama = normalizeNama(namaSupplier);
  const init = normalizeInitial(initial);
  const tlp = normalizeNoTlp(noTlp);
  const enableFlag = normalizeEnable(enable);

  return withTransaction(audit, async (tx) => {
    if (!(await getById(tx, id))) throw notFound("Supplier tidak ditemukan");
    await assertNamaUnique(tx, nama, id);

    await new sql.Request(tx)
      .input("Id", sql.Int, id)
      .input("Nama", sql.VarChar(100), nama)
      .input("Initial", sql.VarChar(25), init)
      .input("NoTlp", sql.VarChar(25), tlp)
      .input("Enable", sql.Bit, enableFlag).query(`
        UPDATE dbo.MstSupplier
        SET NmSupplier = @Nama, Initial = @Initial, NoTlp = @NoTlp, [Enable] = @Enable
        WHERE IdSupplier = @Id
      `);

    return getById(tx, id);
  });
}

async function remove(idRaw, audit) {
  const id = parseId(idRaw);

  return withTransaction(audit, async (tx) => {
    if (!(await getById(tx, id))) throw notFound("Supplier tidak ditemukan");
    try {
      await new sql.Request(tx)
        .input("Id", sql.Int, id)
        .query("DELETE FROM dbo.MstSupplier WHERE IdSupplier = @Id");
    } catch (error) {
      // 547 = pelanggaran FOREIGN KEY (supplier sudah dipakai transaksi)
      if (error.number === 547) {
        throw conflict(
          "Supplier sudah dipakai di transaksi dan tidak bisa dihapus. Nonaktifkan saja.",
        );
      }
      throw error;
    }
    return true;
  });
}

module.exports = { list, create, update, remove };
