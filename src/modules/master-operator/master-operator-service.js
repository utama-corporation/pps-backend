const { poolPromise, sql } = require('../../core/config/db');
const { badReq, notFound, conflict } = require('../../core/utils/http-error');

/**
 * Return ALL operators (no pagination).
 * - Active only by default (ISNULL(Enable,1)=1); pass includeDisabled=1 to include all.
 * - q: search by NamaOperator (LIKE %q%)
 * - orderBy: NamaOperator | IdOperator | Enable (whitelist)
 * - orderDir: ASC | DESC
 */
async function listAll({
  includeDisabled = false,
  q = '',
  orderBy = 'NamaOperator',
  orderDir = 'ASC',
}) {
  const pool = await poolPromise;
  const request = pool.request();

  const allowedOrderBy = new Set(['NamaOperator', 'IdOperator', 'Enable']);
  const orderCol = allowedOrderBy.has(orderBy) ? orderBy : 'NamaOperator';
  const dir = orderDir === 'DESC' ? 'DESC' : 'ASC';

  const whereEnable = includeDisabled ? '1=1' : 'ISNULL(Enable, 1) = 1';
  const hasSearch = q && q.trim().length > 0;

  let where = whereEnable;
  if (hasSearch) {
    where += ' AND (NamaOperator LIKE @q)';
    request.input('q', `%${q}%`);
  }

  const sqlText = `
    SELECT
      IdOperator,
      NamaOperator,
      Enable
    FROM [dbo].[MstOperator]
    WHERE ${where}
    ORDER BY ${orderCol} ${dir};
  `;

  const result = await request.query(sqlText);
  return result.recordset || [];
}

async function listByIdRegu(idregu) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input('idregu', idregu);

  const sqlText = `
    SELECT
      rd.IdRegu,
      rd.IdOperator,
      mo.NamaOperator,
      mo.Enable
    FROM [dbo].[MstRegu_d] rd
    LEFT JOIN [dbo].[MstOperator] mo ON mo.IdOperator = rd.IdOperator
    WHERE rd.IdRegu = @idregu
    ORDER BY mo.NamaOperator ASC;
  `;

  const result = await request.query(sqlText);
  return result.recordset || [];
}

async function listForMaster({ q = '' } = {}) {
  const pool = await poolPromise;
  const request = pool.request();

  let where = '1 = 1';
  if (q && q.trim().length > 0) {
    where += " AND (a.NamaOperator LIKE @q OR ISNULL(b.NamaBagianMesin, '') LIKE @q)";
    request.input('q', sql.VarChar(100), `%${q.trim()}%`);
  }

  const result = await request.query(`
    SELECT
      a.IdOperator,
      a.NamaOperator,
      ISNULL(a.[Enable], 0) AS Enable,
      ISNULL(a.IdBagian, 0) AS IdBagian,
      ISNULL(b.NamaBagianMesin, '') AS NamaBagianMesin,
      CASE WHEN ISNULL(a.[Enable], 0) = 1 THEN 'AKTIF' ELSE 'TIDAK AKTIF' END AS Status
    FROM [dbo].[MstOperator] a
    LEFT JOIN [dbo].[MstBagianMesin] b ON b.IdBagianMesin = a.IdBagian
    WHERE ${where}
    ORDER BY a.IdOperator ASC;
  `);
  return result.recordset || [];
}

async function listBagian() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT IdBagianMesin, NamaBagianMesin
    FROM [dbo].[MstBagianMesin]
    WHERE [Enable] = 1
    ORDER BY NamaBagianMesin ASC;
  `);
  return result.recordset || [];
}

async function getById(idOperator) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Id', sql.Int, idOperator)
    .query(`
      SELECT
        a.IdOperator,
        a.NamaOperator,
        ISNULL(a.[Enable], 0) AS Enable,
        ISNULL(a.IdBagian, 0) AS IdBagian,
        ISNULL(b.NamaBagianMesin, '') AS NamaBagianMesin
      FROM [dbo].[MstOperator] a
      LEFT JOIN [dbo].[MstBagianMesin] b ON b.IdBagianMesin = a.IdBagian
      WHERE a.IdOperator = @Id;
    `);
  return result.recordset[0] || null;
}

function normalizeOperatorPayload({ namaOperator, idBagian, enable }) {
  const nama = String(namaOperator ?? '')
    .trim()
    .toUpperCase();
  if (!nama) throw badReq('Nama operator wajib diisi');
  if (nama.length > 40) throw badReq('Nama operator maksimal 40 karakter');

  const bagian = Number(idBagian);
  if (!Number.isFinite(bagian) || bagian <= 0) {
    throw badReq('Pilih bagian operator');
  }

  const enableFlag =
    enable === undefined || enable === null ? 1 : enable ? 1 : 0;

  return { nama, idBagian: bagian, enable: enableFlag };
}

async function assertBagianExists(idBagian) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Id', sql.Int, idBagian)
    .query(
      'SELECT COUNT(1) AS c FROM [dbo].[MstBagianMesin] WHERE IdBagianMesin = @Id',
    );
  if (!result.recordset[0].c) throw badReq('Bagian tidak ditemukan');
}

async function isNamaTaken(nama, exceptId) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Nama', sql.VarChar(40), nama)
    .input('Id', sql.Int, exceptId)
    .query(
      'SELECT COUNT(1) AS c FROM [dbo].[MstOperator] WHERE NamaOperator = @Nama AND IdOperator <> @Id',
    );
  return result.recordset[0].c > 0;
}

async function nextIdOperator() {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .query(
      'SELECT ISNULL(MAX(IdOperator), 0) + 1 AS nextId FROM [dbo].[MstOperator]',
    );
  return result.recordset[0].nextId;
}

async function create({ namaOperator, idBagian, enable }) {
  const payload = normalizeOperatorPayload({ namaOperator, idBagian, enable });
  await assertBagianExists(payload.idBagian);

  if (await isNamaTaken(payload.nama, 0)) {
    throw conflict(
      'Nama operator sudah ada. Gunakan nama lain atau ubah data yang lama.',
    );
  }

  const idOperator = await nextIdOperator();
  const pool = await poolPromise;
  await pool
    .request()
    .input('Id', sql.Int, idOperator)
    .input('Nama', sql.VarChar(40), payload.nama)
    .input('Enable', sql.Bit, payload.enable)
    .input('IdBagian', sql.Int, payload.idBagian)
    .query(
      'INSERT INTO [dbo].[MstOperator] (IdOperator, NamaOperator, [Enable], IdBagian) VALUES (@Id, @Nama, @Enable, @IdBagian)',
    );

  return getById(idOperator);
}

async function update(idOperator, { namaOperator, idBagian, enable }) {
  const existing = await getById(idOperator);
  if (!existing) throw notFound('Operator tidak ditemukan');

  const payload = normalizeOperatorPayload({ namaOperator, idBagian, enable });
  await assertBagianExists(payload.idBagian);

  if (await isNamaTaken(payload.nama, idOperator)) {
    throw conflict('Nama operator sudah digunakan oleh data lain.');
  }

  const pool = await poolPromise;
  await pool
    .request()
    .input('Id', sql.Int, idOperator)
    .input('Nama', sql.VarChar(40), payload.nama)
    .input('Enable', sql.Bit, payload.enable)
    .input('IdBagian', sql.Int, payload.idBagian)
    .query(
      'UPDATE [dbo].[MstOperator] SET NamaOperator = @Nama, [Enable] = @Enable, IdBagian = @IdBagian WHERE IdOperator = @Id',
    );

  return getById(idOperator);
}

async function remove(idOperator) {
  const existing = await getById(idOperator);
  if (!existing) throw notFound('Operator tidak ditemukan');

  const pool = await poolPromise;
  const used = await pool
    .request()
    .input('Id', sql.Int, idOperator)
    .query(
      'SELECT COUNT(1) AS c FROM [dbo].[MstRegu_d] WHERE IdOperator = @Id',
    );
  if (used.recordset[0].c > 0) {
    throw conflict(
      'Operator ini sudah masuk ke regu, jadi tidak aman untuk dihapus. Solusi aman: ubah status menjadi TIDAK AKTIF.',
    );
  }

  await pool
    .request()
    .input('Id', sql.Int, idOperator)
    .query('DELETE FROM [dbo].[MstOperator] WHERE IdOperator = @Id');

  return true;
}

module.exports = {
  listAll,
  listByIdRegu,
  listForMaster,
  listBagian,
  getById,
  create,
  update,
  remove,
};
