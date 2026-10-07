const sql = require('mssql');
const { poolPromise } = require('../../core/config/db');
const { badReq, notFound, conflict } = require('../../core/utils/http-error');

const MASTER_CONFIG = {
  bahanbaku: {
    table: 'MstBahanBaku',
    idCol: 'IdBB',
    nameCol: 'Nama',
    enableCol: 'IsEnable',
    prossesValue: 1,
  },
  bahanbakupakai: {
    table: 'MstBahanBaku',
    idCol: 'IdBB',
    nameCol: 'Nama',
    enableCol: 'IsEnable',
    prossesValue: 0,
  },
  washing: { table: 'MstWashing', idCol: 'IdWashing', nameCol: 'Nama', enableCol: 'IsEnable' },
  broker: { table: 'MstBroker', idCol: 'IdBroker', nameCol: 'Nama', enableCol: 'IsEnable' },
  crusher: { table: 'MstCrusher', idCol: 'IdCrusher', nameCol: 'NamaCrusher', enableCol: 'Enable' },
  bonggolan: {
    table: 'MstBonggolan',
    idCol: 'IdBonggolan',
    nameCol: 'NamaBonggolan',
    enableCol: 'Enable',
  },
  gilingan: {
    table: 'MstGilingan',
    idCol: 'IdGilingan',
    nameCol: 'NamaGilingan',
    enableCol: 'Enable',
  },
  mixer: { table: 'MstMixer', idCol: 'IdMixer', nameCol: 'Jenis', enableCol: 'Enable' },
  furniturewip: {
    table: 'MstCabinetWIP',
    idCol: 'IdCabinetWIP',
    nameCol: 'Nama',
    enableCol: 'Enable',
  },
  barangjadi: { table: 'MstBarangJadi', idCol: 'IdBJ', nameCol: 'NamaBJ', enableCol: 'Enable' },
  reject: { table: 'MstReject', idCol: 'IdReject', nameCol: 'NamaReject', enableCol: 'Enable' },
  bahanpendukung: {
    table: 'MstCabinetMaterial',
    idCol: 'IdCabinetMaterial',
    nameCol: 'Nama',
    enableCol: 'Enable',
  },
};

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function cleanIds(values) {
  return [...new Set((values || []).map((v) => toInt(v)).filter((v) => v > 0))];
}

async function loadKategoriMap(pool, ids) {
  const list = cleanIds(ids);
  if (!list.length) return {};
  const result = await pool.request().query(`
    SELECT IdKategori, KodeKategori, NamaKategori
    FROM [dbo].[MstKategori]
    WHERE IdKategori IN (${list.join(',')});
  `);
  const map = {};
  for (const row of result.recordset || []) map[row.IdKategori] = row;
  return map;
}

async function loadItemNameMap(pool, kategoriMap, itemIdsByKategori) {
  const map = {};
  for (const [kategoriId, ids] of Object.entries(itemIdsByKategori)) {
    const kategori = kategoriMap[kategoriId];
    const cfg = kategori ? MASTER_CONFIG[String(kategori.KodeKategori || '').toLowerCase()] : null;
    const list = cleanIds(ids);
    if (!cfg || !list.length) continue;
    const result = await pool.request().query(`
      SELECT ${cfg.idCol} AS Id, ${cfg.nameCol} AS Nama
      FROM [dbo].[${cfg.table}]
      WHERE ${cfg.idCol} IN (${list.join(',')});
    `);
    for (const row of result.recordset || []) map[row.Id] = row.Nama;
  }
  return map;
}

function groupIdsByKategori(rows, kategoriKey, itemKey) {
  const grouped = {};
  for (const row of rows) {
    const kategoriId = toInt(row[kategoriKey]);
    const itemId = toInt(row[itemKey]);
    if (!kategoriId || !itemId) continue;
    if (!grouped[kategoriId]) grouped[kategoriId] = [];
    grouped[kategoriId].push(itemId);
  }
  return grouped;
}

async function getKategoriList() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT IdKategori, KodeKategori, NamaKategori,
      ISNULL(Enable, 1) AS Enable,
      ISNULL(IsWaste, 0) AS IsWaste
    FROM [dbo].[MstKategori]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY IdKategori ASC;
  `);
  return result.recordset || [];
}

async function getItems(idKategori) {
  const pool = await poolPromise;
  const kategoriMap = await loadKategoriMap(pool, [toInt(idKategori)]);
  const kategori = kategoriMap[toInt(idKategori)];
  if (!kategori) return [];
  const cfg = MASTER_CONFIG[String(kategori.KodeKategori || '').toLowerCase()];
  if (!cfg) return [];

  const request = pool.request();
  let query = `
    SELECT ${cfg.idCol} AS Id, ${cfg.nameCol} AS Nama
    FROM [dbo].[${cfg.table}]
    WHERE ISNULL(${cfg.enableCol}, 1) = 1`;
  if (cfg.prossesValue !== undefined) {
    request.input('Proses', sql.Int, cfg.prossesValue);
    query += ' AND ISNULL(IsProses, 0) = @Proses';
  }
  query += ` ORDER BY ${cfg.nameCol} ASC;`;

  const result = await request.query(query);
  return result.recordset || [];
}

async function listFormula(q) {
  const pool = await poolPromise;
  const search = String(q ?? '').trim().toLowerCase();

  const result = await pool.request().query(`
    SELECT f.IdFormula, f.MainOutputKategoriId, f.MainOutputId,
      (SELECT COUNT(*) FROM [dbo].[MstFormulaInput] i WHERE i.IdFormula = f.IdFormula) AS JumlahInput,
      (SELECT COUNT(*) FROM [dbo].[MstFormulaOutput] o WHERE o.IdFormula = f.IdFormula) AS JumlahSecondary
    FROM (
      SELECT IdFormula, MainOutputKategoriId, MainOutputId
      FROM [dbo].[MstFormulaInput]
      UNION
      SELECT IdFormula, MainOutputKategoriId, MainOutputId
      FROM [dbo].[MstFormulaOutput]
    ) f;
  `);

  const rows = result.recordset || [];
  const kategoriMap = await loadKategoriMap(
    pool,
    rows.map((r) => r.MainOutputKategoriId),
  );
  const itemIds = {};
  for (const row of rows) {
    const kategoriId = toInt(row.MainOutputKategoriId);
    const itemId = toInt(row.MainOutputId);
    if (!itemIds[kategoriId]) itemIds[kategoriId] = [];
    itemIds[kategoriId].push(itemId);
  }
  const itemNameMap = await loadItemNameMap(pool, kategoriMap, itemIds);

  let data = rows.map((row) => {
    const kategori = kategoriMap[row.MainOutputKategoriId];
    const mainKategori = kategori ? kategori.NamaKategori : '';
    const mainOutputNama = itemNameMap[toInt(row.MainOutputId)] || '';
    return {
      IdFormula: toInt(row.IdFormula),
      MainOutputKategoriId: toInt(row.MainOutputKategoriId),
      MainKategori: mainKategori,
      MainOutputId: toInt(row.MainOutputId),
      MainOutputNama: mainOutputNama,
      JumlahInput: toInt(row.JumlahInput),
      JumlahSecondary: toInt(row.JumlahSecondary),
      search: `${mainKategori} ${mainOutputNama}`.toLowerCase(),
    };
  });

  if (search) data = data.filter((row) => row.search.includes(search));

  data.sort(
    (a, b) =>
      a.MainKategori.localeCompare(b.MainKategori) ||
      a.MainOutputId - b.MainOutputId ||
      a.IdFormula - b.IdFormula,
  );

  return data.map(({ search: _search, ...row }) => row);
}

async function getDetail(idFormula) {
  const pool = await poolPromise;
  const id = toInt(idFormula);
  if (!id) throw notFound('Formula tidak ditemukan');

  const headerResult = await pool
    .request()
    .input('IdFormula', sql.Int, id)
    .query(`
      SELECT IdFormula, MainOutputKategoriId, MainOutputId FROM [dbo].[MstFormulaInput]
      WHERE IdFormula = @IdFormula
      UNION
      SELECT IdFormula, MainOutputKategoriId, MainOutputId FROM [dbo].[MstFormulaOutput]
      WHERE IdFormula = @IdFormula;
    `);
  const header = (headerResult.recordset || [])[0];
  if (!header) throw notFound('Formula tidak ditemukan');

  const inputResult = await pool
    .request()
    .input('IdFormula', sql.Int, id)
    .query(`
      SELECT InputKategoriId AS KategoriId, InputId AS ItemId
      FROM [dbo].[MstFormulaInput]
      WHERE IdFormula = @IdFormula
      ORDER BY InputKategoriId ASC, InputId ASC;
    `);
  const secondaryResult = await pool
    .request()
    .input('IdFormula', sql.Int, id)
    .query(`
      SELECT SecondaryOutputKategoriId AS KategoriId, SecondaryOutputId AS ItemId
      FROM [dbo].[MstFormulaOutput]
      WHERE IdFormula = @IdFormula
      ORDER BY SecondaryOutputKategoriId ASC, SecondaryOutputId ASC;
    `);

  const inputs = inputResult.recordset || [];
  const secondarys = secondaryResult.recordset || [];
  const kategoriMap = await loadKategoriMap(pool, [
    header.MainOutputKategoriId,
    ...inputs.map((r) => r.KategoriId),
    ...secondarys.map((r) => r.KategoriId),
  ]);
  const itemIds = groupIdsByKategori(inputs, 'KategoriId', 'ItemId');
  const secondaryItemIds = groupIdsByKategori(secondarys, 'KategoriId', 'ItemId');
  itemIds[toInt(header.MainOutputKategoriId)] = [
    ...(itemIds[toInt(header.MainOutputKategoriId)] || []),
    toInt(header.MainOutputId),
  ];
  const itemNameMap = await loadItemNameMap(pool, kategoriMap, itemIds);
  const secondaryItemMap = await loadItemNameMap(pool, kategoriMap, secondaryItemIds);
  const kategoriNama = (kategoriId) => {
    const kategori = kategoriMap[kategoriId];
    return kategori ? kategori.NamaKategori : '';
  };

  return {
    IdFormula: id,
    MainOutputKategoriId: toInt(header.MainOutputKategoriId),
    MainKategori: kategoriNama(header.MainOutputKategoriId),
    MainOutputId: toInt(header.MainOutputId),
    MainOutputNama: itemNameMap[toInt(header.MainOutputId)] || '',
    Inputs: inputs.map((row) => ({
      KategoriId: toInt(row.KategoriId),
      KategoriNama: kategoriNama(row.KategoriId),
      ItemId: toInt(row.ItemId),
      ItemNama: itemNameMap[toInt(row.ItemId)] || '',
    })),
    Secondarys: secondarys.map((row) => ({
      KategoriId: toInt(row.KategoriId),
      KategoriNama: kategoriNama(row.KategoriId),
      ItemId: toInt(row.ItemId),
      ItemNama: secondaryItemMap[toInt(row.ItemId)] || '',
    })),
  };
}

function normalizePayload(body) {
  const mainKategoriId = toInt(body?.mainKategoriId);
  const mainOutputId = toInt(body?.mainOutputId);
  const inputs = (Array.isArray(body?.inputs) ? body.inputs : []).map((row) => ({
    kategoriId: toInt(row?.kategoriId),
    itemId: toInt(row?.itemId),
  }));
  const secondarys = (Array.isArray(body?.secondarys) ? body.secondarys : []).map((row) => ({
    kategoriId: toInt(row?.kategoriId),
    itemId: toInt(row?.itemId),
  }));

  if (!mainKategoriId || !mainOutputId) {
    throw badReq('Kategori dan Output utama wajib diisi');
  }
  if (!inputs.length && !secondarys.length) {
    throw badReq('Formula minimal memiliki 1 Input atau 1 Secondary Output');
  }

  for (const row of [...inputs, ...secondarys]) {
    if (!row.kategoriId || !row.itemId) {
      throw badReq('Setiap baris wajib memiliki kategori dan item');
    }
  }

  const dupInput = inputs.find(
    (row, index) => inputs.findIndex((x) => x.kategoriId === row.kategoriId && x.itemId === row.itemId) !== index,
  );
  if (dupInput) throw badReq('Terdapat data Input yang sama');

  const dupSecondary = secondarys.find(
    (row, index) =>
      secondarys.findIndex((x) => x.kategoriId === row.kategoriId && x.itemId === row.itemId) !== index,
  );
  if (dupSecondary) throw badReq('Terdapat data Secondary Output yang sama');

  const sameAsMain = secondarys.find(
    (row) => row.kategoriId === mainKategoriId && row.itemId === mainOutputId,
  );
  if (sameAsMain) throw badReq('Secondary Output tidak boleh sama dengan Output utama');

  return { mainKategoriId, mainOutputId, inputs, secondarys };
}

async function assertSecondaryIsWaste(pool, secondarys) {
  const ids = cleanIds(secondarys.map((row) => row.kategoriId));
  if (!ids.length) return;
  const result = await pool.request().query(`
    SELECT IdKategori FROM [dbo].[MstKategori]
    WHERE IdKategori IN (${ids.join(',')}) AND ISNULL(IsWaste, 0) = 1;
  `);
  const wasteIds = new Set((result.recordset || []).map((row) => row.IdKategori));
  const invalid = secondarys.find((row) => !wasteIds.has(row.kategoriId));
  if (invalid) {
    throw badReq('Secondary Output hanya boleh memakai kategori Waste');
  }
}

async function mainExists(pool, mainKategoriId, mainOutputId, excludeIdFormula) {
  const request = pool
    .request()
    .input('Kategori', sql.Int, mainKategoriId)
    .input('Output', sql.Int, mainOutputId);
  if (excludeIdFormula) request.input('Exclude', sql.Int, excludeIdFormula);

  const whereExclude = excludeIdFormula ? 'AND IdFormula <> @Exclude' : '';
  const inputResult = await request.query(`
    SELECT TOP 1 IdFormula FROM [dbo].[MstFormulaInput]
    WHERE MainOutputKategoriId = @Kategori AND MainOutputId = @Output ${whereExclude};
  `);
  if ((inputResult.recordset || []).length) return true;

  const outputResult = await request.query(`
    SELECT TOP 1 IdFormula FROM [dbo].[MstFormulaOutput]
    WHERE MainOutputKategoriId = @Kategori AND MainOutputId = @Output ${whereExclude};
  `);
  return (outputResult.recordset || []).length > 0;
}

async function nextIdFormula(pool) {
  const result = await pool.request().query(`
    SELECT MAX(IdFormula) AS MaxId FROM (
      SELECT IdFormula FROM [dbo].[MstFormulaInput]
      UNION
      SELECT IdFormula FROM [dbo].[MstFormulaOutput]
    ) f;
  `);
  return toInt((result.recordset || [])[0]?.MaxId) + 1;
}

async function insertRows(tx, idFormula, payload) {
  for (const row of payload.inputs) {
    await tx
      .request()
      .input('IdFormula', sql.Int, idFormula)
      .input('MainKategori', sql.Int, payload.mainKategoriId)
      .input('MainOutput', sql.Int, payload.mainOutputId)
      .input('InputKategori', sql.Int, row.kategoriId)
      .input('InputId', sql.Int, row.itemId)
      .query(`
        INSERT INTO [dbo].[MstFormulaInput]
          (IdFormula, MainOutputKategoriId, MainOutputId, InputKategoriId, InputId)
        VALUES (@IdFormula, @MainKategori, @MainOutput, @InputKategori, @InputId);
      `);
  }

  for (const row of payload.secondarys) {
    await tx
      .request()
      .input('IdFormula', sql.Int, idFormula)
      .input('MainKategori', sql.Int, payload.mainKategoriId)
      .input('MainOutput', sql.Int, payload.mainOutputId)
      .input('SecKategori', sql.Int, row.kategoriId)
      .input('SecId', sql.Int, row.itemId)
      .query(`
        INSERT INTO [dbo].[MstFormulaOutput]
          (IdFormula, MainOutputKategoriId, MainOutputId, SecondaryOutputKategoriId, SecondaryOutputId)
        VALUES (@IdFormula, @MainKategori, @MainOutput, @SecKategori, @SecId);
      `);
  }
}

async function create(body) {
  const payload = normalizePayload(body);
  const pool = await poolPromise;
  await assertSecondaryIsWaste(pool, payload.secondarys);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (await mainExists(tx, payload.mainKategoriId, payload.mainOutputId)) {
      throw conflict('Formula untuk kategori dan output ini sudah ada');
    }
    const idFormula = await nextIdFormula(tx);
    await insertRows(tx, idFormula, payload);
    await tx.commit();
    return { IdFormula: idFormula, ...payload };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }
}

async function update(body) {
  const payload = normalizePayload(body);
  const idFormula = toInt(body?.idFormula);
  if (!idFormula) throw notFound('Formula tidak ditemukan');

  const pool = await poolPromise;
  await assertSecondaryIsWaste(pool, payload.secondarys);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await tx
      .request()
      .input('IdFormula', sql.Int, idFormula)
      .query('DELETE FROM [dbo].[MstFormulaInput] WHERE IdFormula = @IdFormula;');
    await tx
      .request()
      .input('IdFormula', sql.Int, idFormula)
      .query('DELETE FROM [dbo].[MstFormulaOutput] WHERE IdFormula = @IdFormula;');

    await insertRows(tx, idFormula, payload);
    await tx.commit();
    return { IdFormula: idFormula, ...payload };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }
}

async function remove(idFormula) {
  const id = toInt(idFormula);
  if (!id) throw notFound('Formula tidak ditemukan');

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const inputResult = await tx
      .request()
      .input('IdFormula', sql.Int, id)
      .query('DELETE FROM [dbo].[MstFormulaInput] WHERE IdFormula = @IdFormula;');
    const outputResult = await tx
      .request()
      .input('IdFormula', sql.Int, id)
      .query('DELETE FROM [dbo].[MstFormulaOutput] WHERE IdFormula = @IdFormula;');

    const deleted = (inputResult.rowsAffected[0] || 0) + (outputResult.rowsAffected[0] || 0);
    if (!deleted) {
      throw notFound('Formula tidak ditemukan');
    }
    await tx.commit();
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
  getKategoriList,
  getItems,
  listFormula,
  getDetail,
  create,
  update,
  remove,
};
