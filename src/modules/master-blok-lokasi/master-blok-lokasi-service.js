const { poolPromise, sql } = require('../../core/config/db');
const { badReq, notFound, conflict } = require('../../core/utils/http-error');

const SAFE_NAME_RE = /^[A-Za-z0-9_]+$/;

async function withTransaction(fn) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
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

function normalizeBlok(raw) {
  const blok = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!blok) throw badReq('Kode blok wajib diisi.');
  if (blok.length > 3) throw badReq('Kode blok maksimal 3 karakter.');
  if (!/^[A-Z0-9]+$/.test(blok)) {
    throw badReq('Kode blok hanya boleh huruf dan angka.');
  }
  return blok;
}

function normalizeIdWarehouse(raw) {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw badReq('Warehouse wajib dipilih.');
  return id;
}

function normalizeDescription(raw) {
  const description = String(raw ?? '').trim();
  if (!description) throw badReq('Deskripsi lokasi wajib diisi.');
  if (description.length > 150) {
    throw badReq('Deskripsi lokasi maksimal 150 karakter.');
  }
  return description;
}

function parseIdParam(raw, message = 'Parameter tidak valid') {
  const id = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(id) || id <= 0) throw badReq(message);
  return id;
}

function assertSafeSqlName(value, label) {
  if (!value || !SAFE_NAME_RE.test(value)) {
    throw badReq(`${label}${value ?? ''}`);
  }
}

// ── Master combobox ──────────────────────────────────────────────────────────

async function getMaster() {
  const pool = await poolPromise;
  const warehouses = (
    await pool.request().query(`
      SELECT IdWarehouse, NamaWarehouse
      FROM MstWarehouse
      WHERE ISNULL(Enable, 1) = 1
      ORDER BY NamaWarehouse
    `)
  ).recordset;

  const kategoris = (
    await pool.request().query(`
      SELECT
        IdKategori,
        KodeKategori,
        NamaKategori,
        ISNULL(NamaTableJenis, '') AS NamaTableJenis,
        ISNULL(NamaKolomIdJenis, '') AS NamaKolomIdJenis,
        ISNULL(NamaKolomNamaJenis, '') AS NamaKolomNamaJenis
      FROM MstKategori
      WHERE ISNULL(Enable, 1) = 1
      ORDER BY NamaKategori
    `)
  ).recordset;

  return { warehouses, kategoris };
}

// ── BLOK ─────────────────────────────────────────────────────────────────────

async function listBlok(search = '') {
  const pool = await poolPromise;
  const request = pool.request();
  const keyword = String(search ?? '').trim();

  let where = '';
  if (keyword) {
    where = `WHERE (@Keyword = '' OR A.Blok LIKE '%' + @Keyword + '%')`;
    request.input('Keyword', sql.VarChar(50), keyword);
  } else {
    where = `WHERE @Keyword = ''`;
    request.input('Keyword', sql.VarChar(50), '');
  }

  const result = await request.query(`
    SELECT
      A.Blok,
      ISNULL(A.IdWarehouse, 0) AS IdWarehouse,
      ISNULL(B.NamaWarehouse, '') AS NamaWarehouse
    FROM MstBlok A
    LEFT JOIN MstWarehouse B
      ON B.IdWarehouse = A.IdWarehouse
    ${where}
    ORDER BY A.Blok
  `);
  return result.recordset || [];
}

async function assertWarehouseExists(idWarehouse) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Id', sql.Int, idWarehouse)
    .query('SELECT COUNT(1) AS c FROM MstWarehouse WHERE IdWarehouse = @Id');
  if (!result.recordset[0].c) throw badReq('Warehouse tidak valid.');
}

async function getBlok(blok) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Blok', sql.VarChar(3), blok)
    .query(
      'SELECT Blok, ISNULL(IdWarehouse, 0) AS IdWarehouse FROM MstBlok WHERE Blok = @Blok',
    );
  return result.recordset[0] || null;
}

async function createBlok({ blok, idWarehouse }) {
  const code = normalizeBlok(blok);
  const warehouse = normalizeIdWarehouse(idWarehouse);
  await assertWarehouseExists(warehouse);

  if (await getBlok(code)) throw conflict('Kode blok sudah ada.');

  const pool = await poolPromise;
  await pool
    .request()
    .input('Blok', sql.VarChar(3), code)
    .input('IdWarehouse', sql.Int, warehouse)
    .query('INSERT INTO MstBlok (Blok, IdWarehouse) VALUES (@Blok, @IdWarehouse)');

  return getBlok(code);
}

async function updateBlok(blokRaw, { idWarehouse }) {
  const blok = normalizeBlok(blokRaw);
  const warehouse = normalizeIdWarehouse(idWarehouse);
  if (!(await getBlok(blok))) throw notFound('Blok tidak ditemukan');
  await assertWarehouseExists(warehouse);

  const pool = await poolPromise;
  await pool
    .request()
    .input('Blok', sql.VarChar(3), blok)
    .input('IdWarehouse', sql.Int, warehouse)
    .query('UPDATE MstBlok SET IdWarehouse = @IdWarehouse WHERE Blok = @Blok');

  return getBlok(blok);
}

async function removeBlok(blokRaw) {
  const blok = normalizeBlok(blokRaw);
  if (!(await getBlok(blok))) throw notFound('Blok tidak ditemukan');

  await withTransaction(async (tx) => {
    await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), blok)
      .query('DELETE FROM MstLokasiJenis WHERE Blok = @Blok');
    await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), blok)
      .query('DELETE FROM MstLokasi WHERE Blok = @Blok');
    await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), blok)
      .query('DELETE FROM MstBlok WHERE Blok = @Blok');
  });

  return true;
}

// ── LOKASI ───────────────────────────────────────────────────────────────────

async function listLokasi(blok = '') {
  const pool = await poolPromise;
  const request = pool
    .request()
    .input('Blok', sql.VarChar(3), String(blok ?? '').trim());

  const result = await request.query(`
    SELECT
      A.IdLokasi,
      A.Blok,
      ISNULL(A.Description, '') AS Description,
      ISNULL(A.Enable, 0) AS Enable
    FROM MstLokasi A
    WHERE (@Blok = '' OR A.Blok = @Blok)
    ORDER BY A.IdLokasi
  `);
  return result.recordset || [];
}

async function getLokasi(blok, idLokasi) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Blok', sql.VarChar(3), blok)
    .input('IdLokasi', sql.Int, idLokasi)
    .query(
      `SELECT IdLokasi, Blok, ISNULL(Description, '') AS Description, ISNULL(Enable, 0) AS Enable FROM MstLokasi WHERE Blok = @Blok AND IdLokasi = @IdLokasi`,
    );
  return result.recordset[0] || null;
}

async function nextIdLokasi(blok) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Blok', sql.VarChar(3), blok)
    .query(
      'SELECT ISNULL(MAX(IdLokasi), 0) + 1 AS nextId FROM MstLokasi WITH (UPDLOCK, HOLDLOCK) WHERE Blok = @Blok',
    );
  return result.recordset[0].nextId;
}

async function createLokasi({ blok, description, enable }) {
  const code = normalizeBlok(blok);
  const desc = normalizeDescription(description);
  const enableFlag = enable === undefined || enable === null ? 1 : enable ? 1 : 0;

  if (!(await getBlok(code))) throw badReq('Pilih blok terlebih dahulu.');

  return withTransaction(async (tx) => {
    const idResult = await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), code)
      .query(
        'SELECT ISNULL(MAX(IdLokasi), 0) + 1 AS nextId FROM MstLokasi WITH (UPDLOCK, HOLDLOCK) WHERE Blok = @Blok',
      );
    const idLokasi = idResult.recordset[0].nextId;

    const dup = await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), code)
      .input('IdLokasi', sql.Int, idLokasi)
      .query(
        'SELECT COUNT(1) AS c FROM MstLokasi WHERE Blok = @Blok AND IdLokasi = @IdLokasi',
      );
    if (dup.recordset[0].c > 0) {
      throw conflict('ID lokasi sudah ada di blok ini.');
    }

    await new sql.Request(tx)
      .input('IdLokasi', sql.Int, idLokasi)
      .input('Blok', sql.VarChar(3), code)
      .input('Description', sql.VarChar(150), desc)
      .input('Enable', sql.Bit, enableFlag).query(`
        INSERT INTO MstLokasi (IdLokasi, Blok, Description, Enable)
        VALUES (@IdLokasi, @Blok, @Description, @Enable)
      `);

    return getLokasiFromTx(tx, code, idLokasi);
  });
}

async function getLokasiFromTx(tx, blok, idLokasi) {
  const result = await new sql.Request(tx)
    .input('Blok', sql.VarChar(3), blok)
    .input('IdLokasi', sql.Int, idLokasi)
    .query(
      `SELECT IdLokasi, Blok, ISNULL(Description, '') AS Description, ISNULL(Enable, 0) AS Enable FROM MstLokasi WHERE Blok = @Blok AND IdLokasi = @IdLokasi`,
    );
  return result.recordset[0] || null;
}

async function updateLokasi(blokRaw, idLokasiRaw, { description, enable }) {
  const blok = normalizeBlok(blokRaw);
  const idLokasi = parseIdParam(idLokasiRaw, 'ID lokasi tidak valid');
  const desc = normalizeDescription(description);
  const enableFlag = enable === undefined || enable === null ? 1 : enable ? 1 : 0;

  if (!(await getLokasi(blok, idLokasi))) {
    throw notFound('Lokasi tidak ditemukan');
  }

  const pool = await poolPromise;
  await pool
    .request()
    .input('IdLokasi', sql.Int, idLokasi)
    .input('Blok', sql.VarChar(3), blok)
    .input('Description', sql.VarChar(150), desc)
    .input('Enable', sql.Bit, enableFlag).query(`
      UPDATE MstLokasi
      SET Description = @Description, Enable = @Enable
      WHERE Blok = @Blok AND IdLokasi = @IdLokasi
    `);

  return getLokasi(blok, idLokasi);
}

async function removeLokasi(blokRaw, idLokasiRaw) {
  const blok = normalizeBlok(blokRaw);
  const idLokasi = parseIdParam(idLokasiRaw, 'ID lokasi tidak valid');
  if (!(await getLokasi(blok, idLokasi))) {
    throw notFound('Lokasi tidak ditemukan');
  }

  await withTransaction(async (tx) => {
    await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), blok)
      .input('IdLokasi', sql.Int, idLokasi)
      .query(
        'DELETE FROM MstLokasiJenis WHERE Blok = @Blok AND IdLokasi = @IdLokasi',
      );
    await new sql.Request(tx)
      .input('Blok', sql.VarChar(3), blok)
      .input('IdLokasi', sql.Int, idLokasi)
      .query(
        'DELETE FROM MstLokasi WHERE Blok = @Blok AND IdLokasi = @IdLokasi',
      );
  });

  return true;
}

// ── Dynamic JENIS per kategori ───────────────────────────────────────────────

async function getJenisConfig(idKategori) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('Id', sql.Int, idKategori)
    .query(`
      SELECT
        ISNULL(NamaTableJenis, '') AS NamaTableJenis,
        ISNULL(NamaKolomIdJenis, '') AS NamaKolomIdJenis,
        ISNULL(NamaKolomNamaJenis, '') AS NamaKolomNamaJenis
      FROM MstKategori
      WHERE IdKategori = @Id
    `);
  const row = result.recordset[0];
  if (!row) return null;

  const table = row.NamaTableJenis.trim();
  const colId = row.NamaKolomIdJenis.trim();
  const colNama = row.NamaKolomNamaJenis.trim();
  if (!table || !colId || !colNama) return null;
  return { table, colId, colNama };
}

async function getEnableColumnName(tableName) {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('Table', sql.VarChar(100), tableName)
      .query(`
        SELECT TOP 1 COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @Table
          AND COLUMN_NAME IN ('Enable', 'IsEnable')
      `);
    return result.recordset[0]?.COLUMN_NAME || '';
  } catch (_) {
    return '';
  }
}

async function listJenis(idKategoriRaw) {
  const idKategori = parseIdParam(idKategoriRaw, 'Kategori tidak valid');
  const cfg = await getJenisConfig(idKategori);
  if (!cfg) return [];

  assertSafeSqlName(cfg.table, 'Nama tabel jenis tidak valid: ');
  assertSafeSqlName(cfg.colId, 'Nama kolom ID jenis tidak valid: ');
  assertSafeSqlName(cfg.colNama, 'Nama kolom nama jenis tidak valid: ');

  const enableCol = await getEnableColumnName(cfg.table);
  const where = enableCol
    ? ` WHERE ISNULL(${enableCol}, 1) = 1`
    : '';

  const pool = await poolPromise;
  const result = await pool.request().query(
    `SELECT ${cfg.colId} AS Id, ${cfg.colNama} AS Nama FROM ${cfg.table}${where} ORDER BY ${cfg.colNama}`,
  );
  return result.recordset || [];
}

async function resolveNamaJenis(idKategori, idJenis) {
  try {
    const cfg = await getJenisConfig(idKategori);
    if (!cfg) return '';
    assertSafeSqlName(cfg.table, 'Nama tabel jenis tidak valid: ');
    assertSafeSqlName(cfg.colId, 'Nama kolom ID jenis tidak valid: ');
    assertSafeSqlName(cfg.colNama, 'Nama kolom nama jenis tidak valid: ');

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('Id', sql.Int, idJenis)
      .query(
        `SELECT TOP 1 ${cfg.colNama} AS Nama FROM ${cfg.table} WHERE ${cfg.colId} = @Id`,
      );
    return result.recordset[0]?.Nama
      ? String(result.recordset[0].Nama)
      : '';
  } catch (_) {
    return '';
  }
}

// ── LOKASI JENIS ─────────────────────────────────────────────────────────────

async function listLokasiJenis(blokRaw, idLokasiRaw) {
  const blok = normalizeBlok(blokRaw);
  const idLokasi = parseIdParam(idLokasiRaw, 'ID lokasi tidak valid');

  const pool = await poolPromise;
  const rows = (
    await pool
      .request()
      .input('Blok', sql.VarChar(3), blok)
      .input('IdLokasi', sql.Int, idLokasi)
      .query(`
        SELECT Blok, IdLokasi, IdKategori, IdJenis
        FROM MstLokasiJenis
        WHERE Blok = @Blok AND IdLokasi = @IdLokasi
        ORDER BY IdKategori, IdJenis
      `)
  ).recordset;

  const kategoriRows = (
    await pool
      .request()
      .query('SELECT IdKategori, NamaKategori FROM MstKategori')
  ).recordset;
  const kategoriNames = new Map(
    kategoriRows.map((k) => [k.IdKategori, k.NamaKategori]),
  );

  const result = [];
  for (const row of rows) {
    result.push({
      Blok: row.Blok,
      IdLokasi: row.IdLokasi,
      IdKategori: row.IdKategori,
      IdJenis: row.IdJenis,
      NamaKategori: kategoriNames.get(row.IdKategori) || '',
      NamaJenis: await resolveNamaJenis(row.IdKategori, row.IdJenis),
    });
  }
  return result;
}

async function addLokasiJenis({ blok, idLokasi, idKategori, idJenis }) {
  const code = normalizeBlok(blok);
  const lokasiId = parseIdParam(idLokasi, 'Pilih lokasi terlebih dahulu.');
  const kategoriId = parseIdParam(idKategori, 'Pilih kategori terlebih dahulu.');
  const jenisId = parseIdParam(idJenis, 'Pilih jenis terlebih dahulu.');

  if (!(await getLokasi(code, lokasiId))) {
    throw badReq('Pilih lokasi terlebih dahulu.');
  }

  const pool = await poolPromise;
  const dup = await pool
    .request()
    .input('Blok', sql.VarChar(3), code)
    .input('IdLokasi', sql.Int, lokasiId)
    .input('IdKategori', sql.Int, kategoriId)
    .input('IdJenis', sql.Int, jenisId)
    .query(`
      SELECT COUNT(1) AS c
      FROM MstLokasiJenis
      WHERE Blok = @Blok AND IdLokasi = @IdLokasi
        AND IdKategori = @IdKategori AND IdJenis = @IdJenis
    `);
  if (dup.recordset[0].c > 0) {
    throw conflict('Jenis sudah ada di daftar lokasi ini.');
  }

  await pool
    .request()
    .input('Blok', sql.VarChar(3), code)
    .input('IdLokasi', sql.Int, lokasiId)
    .input('IdKategori', sql.Int, kategoriId)
    .input('IdJenis', sql.Int, jenisId).query(`
      INSERT INTO MstLokasiJenis (Blok, IdLokasi, IdKategori, IdJenis)
      VALUES (@Blok, @IdLokasi, @IdKategori, @IdJenis)
    `);

  return true;
}

async function removeLokasiJenis(blokRaw, idLokasiRaw, idKategoriRaw, idJenisRaw) {
  const blok = normalizeBlok(blokRaw);
  const idLokasi = parseIdParam(idLokasiRaw, 'ID lokasi tidak valid');
  const idKategori = parseIdParam(idKategoriRaw, 'Kategori tidak valid');
  const idJenis = parseIdParam(idJenisRaw, 'Jenis tidak valid');

  const pool = await poolPromise;
  const existing = await pool
    .request()
    .input('Blok', sql.VarChar(3), blok)
    .input('IdLokasi', sql.Int, idLokasi)
    .input('IdKategori', sql.Int, idKategori)
    .input('IdJenis', sql.Int, idJenis)
    .query(`
      SELECT COUNT(1) AS c
      FROM MstLokasiJenis
      WHERE Blok = @Blok AND IdLokasi = @IdLokasi
        AND IdKategori = @IdKategori AND IdJenis = @IdJenis
    `);
  if (!existing.recordset[0].c) throw notFound('Data jenis tidak ditemukan');

  await pool
    .request()
    .input('Blok', sql.VarChar(3), blok)
    .input('IdLokasi', sql.Int, idLokasi)
    .input('IdKategori', sql.Int, idKategori)
    .input('IdJenis', sql.Int, idJenis).query(`
      DELETE FROM MstLokasiJenis
      WHERE Blok = @Blok AND IdLokasi = @IdLokasi
        AND IdKategori = @IdKategori AND IdJenis = @IdJenis
    `);

  return true;
}

module.exports = {
  getMaster,
  listBlok,
  createBlok,
  updateBlok,
  removeBlok,
  listLokasi,
  createLokasi,
  updateLokasi,
  removeLokasi,
  listJenis,
  listLokasiJenis,
  addLokasiJenis,
  removeLokasiJenis,
  nextIdLokasi,
};
