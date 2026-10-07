// master-regu-service.js
const { poolPromise, sql } = require("../../../core/config/db");
const { badReq, notFound, conflict } = require("../../../core/utils/http-error");

async function listAll({
  q = "",
  orderBy = "NamaRegu",
  orderDir = "ASC",
  idBagian = [],
}) {
  const pool = await poolPromise;
  const request = pool.request();

  const allowedOrderBy = new Set([
    "IdRegu",
    "IdBagian",
    "NamaRegu",
    "KepalaRegu",
    "NamaBagianMesin",
  ]);
  const orderCol = allowedOrderBy.has(orderBy) ? orderBy : "NamaRegu";
  const dir = orderDir === "DESC" ? "DESC" : "ASC";

  const conditions = [];

  if (q && q.trim().length > 0) {
    conditions.push(
      "(a.NamaRegu LIKE @q OR b.NamaOperator LIKE @q OR ISNULL(c.NamaBagianMesin, '') LIKE @q)",
    );
    request.input("q", `%${q}%`);
  }

  if (Array.isArray(idBagian) && idBagian.length > 0) {
    const params = idBagian.map((id, i) => {
      request.input(`idBagian${i}`, sql.Int, id);
      return `@idBagian${i}`;
    });
    conditions.push(`a.IdBagian IN (${params.join(", ")})`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      a.IdRegu,
      a.IdBagian,
      a.NamaRegu,
      a.KepalaRegu,
      b.NamaOperator AS NamaKepalaRegu,
      ISNULL(c.NamaBagianMesin, '') AS NamaBagianMesin,
      COUNT(d.IdOperator) AS JumlahOperator
    FROM [dbo].[MstRegu] a
    LEFT JOIN [dbo].[MstOperator] b ON a.KepalaRegu = b.IdOperator
    LEFT JOIN [dbo].[MstBagianMesin] c ON c.IdBagianMesin = a.IdBagian
    LEFT JOIN [dbo].[MstRegu_d] d ON d.IdRegu = a.IdRegu
    ${where}
    GROUP BY a.IdRegu, a.IdBagian, a.NamaRegu, a.KepalaRegu,
             b.NamaOperator, c.NamaBagianMesin
    ORDER BY ${orderCol} ${dir};
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getById(idRegu) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("Id", sql.Int, idRegu)
    .query(`
      SELECT
        a.IdRegu,
        a.IdBagian,
        a.NamaRegu,
        a.KepalaRegu,
        b.NamaOperator AS NamaKepalaRegu,
        ISNULL(c.NamaBagianMesin, '') AS NamaBagianMesin,
        (SELECT COUNT(1) FROM [dbo].[MstRegu_d] d WHERE d.IdRegu = a.IdRegu)
          AS JumlahOperator
      FROM [dbo].[MstRegu] a
      LEFT JOIN [dbo].[MstOperator] b ON a.KepalaRegu = b.IdOperator
      LEFT JOIN [dbo].[MstBagianMesin] c ON c.IdBagianMesin = a.IdBagian
      WHERE a.IdRegu = @Id;
    `);
  return result.recordset[0] || null;
}

async function getMembers(idRegu) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("Id", sql.Int, idRegu)
    .query(`
      SELECT
        d.IdOperator,
        o.NamaOperator,
        ISNULL(o.[Enable], 0) AS Enable
      FROM [dbo].[MstRegu_d] d
      INNER JOIN [dbo].[MstOperator] o ON o.IdOperator = d.IdOperator
      WHERE d.IdRegu = @Id
      ORDER BY o.NamaOperator ASC;
    `);
  return result.recordset || [];
}

function normalizeReguPayload({ namaRegu, idBagian, operatorIds }) {
  const nama = String(namaRegu ?? "")
    .trim()
    .toUpperCase();
  if (!nama) throw badReq("Nama regu wajib diisi");
  if (nama.length > 15) {
    throw badReq("Nama regu maksimal 15 karakter sesuai struktur lama");
  }

  const bagian = Number(idBagian);
  if (!Number.isFinite(bagian) || bagian <= 0) {
    throw badReq("Pilih bagian regu");
  }

  if (!Array.isArray(operatorIds)) {
    throw badReq("Minimal masukkan 1 operator ke dalam regu");
  }
  const ids = [
    ...new Set(
      operatorIds
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  if (ids.length === 0) {
    throw badReq("Minimal masukkan 1 operator ke dalam regu");
  }

  return { nama, idBagian: bagian, operatorIds: ids };
}

async function assertBagianExists(idBagian) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("Id", sql.Int, idBagian)
    .query(
      "SELECT COUNT(1) AS c FROM [dbo].[MstBagianMesin] WHERE IdBagianMesin = @Id",
    );
  if (!result.recordset[0].c) throw badReq("Bagian tidak ditemukan");
}

async function assertOperatorsExist(operatorIds) {
  const pool = await poolPromise;
  const request = pool.request();
  const params = operatorIds.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(
    `SELECT COUNT(1) AS c FROM [dbo].[MstOperator] WHERE IdOperator IN (${params.join(", ")})`,
  );
  if (result.recordset[0].c !== operatorIds.length) {
    throw badReq("Operator tidak ditemukan");
  }
}

async function assertOperatorsAvailable(operatorIds, idRegu) {
  const pool = await poolPromise;
  const request = pool.request();
  const params = operatorIds.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  request.input("ExceptId", sql.Int, idRegu);
  const result = await request.query(`
    SELECT
      d.IdOperator,
      o.NamaOperator,
      d.IdRegu,
      r.NamaRegu
    FROM [dbo].[MstRegu_d] d
    INNER JOIN [dbo].[MstOperator] o ON o.IdOperator = d.IdOperator
    LEFT JOIN [dbo].[MstRegu] r ON r.IdRegu = d.IdRegu
    WHERE d.IdOperator IN (${params.join(", ")}) AND d.IdRegu <> @ExceptId;
  `);
  const clash = result.recordset || [];
  if (clash.length > 0) {
    const detail = clash
      .map((row) => `${row.NamaOperator} (regu ${row.NamaRegu || row.IdRegu})`)
      .join(", ");
    throw conflict(
      `Operator sudah terdaftar di regu lain: ${detail}. ` +
        `Keluarkan dari regu tersebut terlebih dahulu.`,
    );
  }
}

async function nextIdRegu() {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .query("SELECT ISNULL(MAX(IdRegu), 0) + 1 AS nextId FROM [dbo].[MstRegu]");
  return result.recordset[0].nextId;
}

async function insertDetails(tx, idRegu, operatorIds) {
  for (const idOperator of operatorIds) {
    await new sql.Request(tx)
      .input("IdRegu", sql.Int, idRegu)
      .input("IdOperator", sql.Int, idOperator)
      .query(
        "INSERT INTO [dbo].[MstRegu_d] (IdRegu, IdOperator) VALUES (@IdRegu, @IdOperator)",
      );
  }
}

async function create({ namaRegu, idBagian, operatorIds }) {
  const payload = normalizeReguPayload({ namaRegu, idBagian, operatorIds });
  await assertBagianExists(payload.idBagian);
  await assertOperatorsExist(payload.operatorIds);
  await assertOperatorsAvailable(payload.operatorIds, 0);

  const pool = await poolPromise;
  const idRegu = await nextIdRegu();

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input("IdRegu", sql.Int, idRegu)
      .input("IdBagian", sql.Int, payload.idBagian)
      .input("NamaRegu", sql.VarChar(20), payload.nama)
      .query(
        "INSERT INTO [dbo].[MstRegu] (IdRegu, IdBagian, NamaRegu) VALUES (@IdRegu, @IdBagian, @NamaRegu)",
      );

    await insertDetails(tx, idRegu, payload.operatorIds);
    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }

  return getById(idRegu);
}

async function update(idRegu, { namaRegu, idBagian, operatorIds }) {
  const existing = await getById(idRegu);
  if (!existing) throw notFound("Regu tidak ditemukan");

  const payload = normalizeReguPayload({ namaRegu, idBagian, operatorIds });
  await assertBagianExists(payload.idBagian);
  await assertOperatorsExist(payload.operatorIds);
  await assertOperatorsAvailable(payload.operatorIds, idRegu);

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input("Id", sql.Int, idRegu)
      .input("IdBagian", sql.Int, payload.idBagian)
      .input("NamaRegu", sql.VarChar(20), payload.nama)
      .query(
        "UPDATE [dbo].[MstRegu] SET IdBagian = @IdBagian, NamaRegu = @NamaRegu WHERE IdRegu = @Id",
      );

    await new sql.Request(tx)
      .input("Id", sql.Int, idRegu)
      .query("DELETE FROM [dbo].[MstRegu_d] WHERE IdRegu = @Id");

    await insertDetails(tx, idRegu, payload.operatorIds);
    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }

  return getById(idRegu);
}

async function remove(idRegu) {
  const existing = await getById(idRegu);
  if (!existing) throw notFound("Regu tidak ditemukan");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input("Id", sql.Int, idRegu)
      .query("DELETE FROM [dbo].[MstRegu_d] WHERE IdRegu = @Id");

    await new sql.Request(tx)
      .input("Id", sql.Int, idRegu)
      .query("DELETE FROM [dbo].[MstRegu] WHERE IdRegu = @Id");

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }

  return true;
}

module.exports = {
  listAll,
  getById,
  getMembers,
  create,
  update,
  remove,
};
