const sql = require('mssql');
const { poolPromise } = require('../../core/config/db');
const { badReq, notFound, conflict } = require('../../core/utils/http-error');

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      IdCetakan,
      IdBJ,
      ISNULL(Enable, 1) AS Enable,
      NamaCetakan,
      Lebar,
      Panjang,
      Tebal,
      BeratCetakan,
      BeratCavity,
      JumlahCavity,
      HotRunner,
      HydrolicCore,
      ElectricalSwitch,
      InputAngin,
      InputAir,
      CycleTime,
      PcsPerJam
    FROM [dbo].[MstCetakan]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaCetakan ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getOptions() {
  const pool = await poolPromise;

  const cetakan = await pool.request().query(`
    SELECT IdCetakan, NamaCetakan
    FROM [dbo].[MstCetakan]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaCetakan ASC;
  `);

  const warna = await pool.request().query(`
    SELECT IdWarna, Warna
    FROM [dbo].[MstWarna]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY Warna ASC;
  `);

  const barangJadi = await pool.request().query(`
    SELECT IdBJ, NamaBJ
    FROM [dbo].[MstBarangJadi]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaBJ ASC;
  `);

  const furnitureWip = await pool.request().query(`
    SELECT IdCabinetWIP, Nama
    FROM [dbo].[MstCabinetWIP]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY Nama ASC;
  `);

  const materials = await pool.request().query(`
    SELECT IdCabinetMaterial, Nama
    FROM [dbo].[MstCabinetMaterial]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY Nama ASC;
  `);

  return {
    cetakan: cetakan.recordset || [],
    warna: warna.recordset || [],
    barangJadi: barangJadi.recordset || [],
    furnitureWip: furnitureWip.recordset || [],
    materials: materials.recordset || [],
  };
}

async function listWarnaMaterial({ top, q } = {}) {
  const limit = Math.min(Math.max(parseInt(top, 10) || 100, 1), 1000);
  const search = String(q ?? '').trim();

  const pool = await poolPromise;
  const request = pool.request();
  request.input('Top', sql.Int, limit);

  const where = search
    ? `WHERE B.NamaCetakan LIKE @Q
        OR C.Warna LIKE @Q
        OR ISNULL(D.Nama, '') LIKE @Q`
    : '';
  if (search) request.input('Q', sql.VarChar(200), `%${search}%`);

  const result = await request.query(`
    SELECT TOP (@Top)
      A.IdCetakan,
      A.IdWarna,
      ISNULL(A.IdFurnitureMaterial, 0) AS IdMaterial,
      B.NamaCetakan,
      C.Warna,
      ISNULL(D.Nama, '') AS NamaMaterial
    FROM [dbo].[CetakanWarna_h] A
    INNER JOIN [dbo].[MstCetakan] B ON B.IdCetakan = A.IdCetakan
    INNER JOIN [dbo].[MstWarna] C ON C.IdWarna = A.IdWarna
    LEFT JOIN [dbo].[MstCabinetMaterial] D ON D.IdCabinetMaterial = A.IdFurnitureMaterial
    ${where}
    ORDER BY B.NamaCetakan ASC, C.Warna ASC, D.Nama ASC;
  `);

  return result.recordset || [];
}

function keyedRequest(target, { idCetakan, idWarna, idMaterial }) {
  return target
    .request()
    .input('IdCetakan', sql.Int, idCetakan)
    .input('IdWarna', sql.Int, idWarna)
    .input('IdMaterial', sql.Int, idMaterial);
}

async function getDetail(key) {
  const pool = await poolPromise;

  const bj = await keyedRequest(pool, key).query(`
    SELECT B.IdBJ, B.NamaBJ
    FROM [dbo].[CetakanWarnaToProduk_d] A
    INNER JOIN [dbo].[MstBarangJadi] B ON B.IdBJ = A.IdBarangJadi
    WHERE A.IdCetakan = @IdCetakan
      AND A.IdWarna = @IdWarna
      AND ISNULL(A.IdFurnitureMaterial, 0) = @IdMaterial
    ORDER BY B.NamaBJ ASC;
  `);

  const wip = await keyedRequest(pool, key).query(`
    SELECT B.IdCabinetWIP, B.Nama
    FROM [dbo].[CetakanWarnaToFurnitureWIP_d] A
    INNER JOIN [dbo].[MstCabinetWIP] B ON B.IdCabinetWIP = A.IdFurnitureWIP
    WHERE A.IdCetakan = @IdCetakan
      AND A.IdWarna = @IdWarna
      AND ISNULL(A.IdFurnitureMaterial, 0) = @IdMaterial
    ORDER BY B.Nama ASC;
  `);

  return {
    barangJadi: bj.recordset || [],
    furnitureWip: wip.recordset || [],
  };
}

function toKey(value, label) {
  const idCetakan = Number(value?.idCetakan);
  const idWarna = Number(value?.idWarna);
  const idMaterial = Number(value?.idMaterial ?? 0) || 0;

  if (!Number.isFinite(idCetakan) || idCetakan <= 0) {
    throw badReq(`${label} Cetakan tidak valid`);
  }
  if (!Number.isFinite(idWarna) || idWarna <= 0) {
    throw badReq(`${label} Warna tidak valid`);
  }

  return { idCetakan, idWarna, idMaterial };
}

function toIdArray(value, label) {
  if (!Array.isArray(value)) return [];

  const ids = [];
  for (const raw of value) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      throw badReq(`${label} tidak valid`);
    }
    if (ids.includes(id)) {
      throw badReq(
        label === 'Furniture WIP'
          ? 'Furniture WIP ini sudah ada di input, tidak boleh ditambahkan lagi.'
          : `${label} tidak boleh duplikat`,
      );
    }
    ids.push(id);
  }

  return ids;
}

function normalizePayload(body) {
  const key = toKey(body, 'Data');
  const barangJadi = toIdArray(body?.barangJadi, 'Barang Jadi');
  const furnitureWip = toIdArray(body?.furnitureWip, 'Furniture WIP');

  if (barangJadi.length === 0 && furnitureWip.length === 0) {
    throw badReq('Silahkan isi Barang Jadi atau Furniture WIP lebih dulu');
  }
  if (barangJadi.length > 0 && furnitureWip.length > 0) {
    throw badReq(
      'Tidak boleh campur Barang Jadi dan Furniture WIP dalam 1 data cetakan',
    );
  }
  if (barangJadi.length > 1) {
    throw badReq('Barang Jadi hanya boleh 1 item saja');
  }
  if (furnitureWip.length > 4) {
    throw badReq('Furniture WIP maksimal 4 item saja');
  }

  return { ...key, barangJadi, furnitureWip };
}

async function assertIdsExist(pool, table, column, ids, label) {
  if (ids.length === 0) return;

  const request = pool.request();
  const params = ids.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });

  const result = await request.query(
    `SELECT COUNT(1) AS Total FROM [dbo].[${table}] WHERE [${column}] IN (${params.join(', ')})`,
  );

  if (result.recordset[0].Total !== ids.length) {
    throw badReq(`${label} tidak ditemukan`);
  }
}

async function assertRefs(pool, payload) {
  const cetakan = await pool
    .request()
    .input('Id', sql.Int, payload.idCetakan)
    .query('SELECT COUNT(1) AS Total FROM [dbo].[MstCetakan] WHERE IdCetakan = @Id');
  if (cetakan.recordset[0].Total === 0) throw badReq('Cetakan tidak ditemukan');

  const warna = await pool
    .request()
    .input('Id', sql.Int, payload.idWarna)
    .query('SELECT COUNT(1) AS Total FROM [dbo].[MstWarna] WHERE IdWarna = @Id');
  if (warna.recordset[0].Total === 0) throw badReq('Warna tidak ditemukan');

  if (payload.idMaterial > 0) {
    const material = await pool
      .request()
      .input('Id', sql.Int, payload.idMaterial)
      .query(
        'SELECT COUNT(1) AS Total FROM [dbo].[MstCabinetMaterial] WHERE IdCabinetMaterial = @Id',
      );
    if (material.recordset[0].Total === 0) {
      throw badReq('Material tidak ditemukan');
    }
  }

  await assertIdsExist(
    pool,
    'MstBarangJadi',
    'IdBJ',
    payload.barangJadi,
    'Barang Jadi',
  );
  await assertIdsExist(
    pool,
    'MstCabinetWIP',
    'IdCabinetWIP',
    payload.furnitureWip,
    'Furniture WIP',
  );
}

async function headerExists(target, key) {
  const result = await keyedRequest(target, key).query(`
    SELECT COUNT(1) AS Total
    FROM [dbo].[CetakanWarna_h]
    WHERE IdCetakan = @IdCetakan
      AND IdWarna = @IdWarna
      AND ISNULL(IdFurnitureMaterial, 0) = @IdMaterial;
  `);

  return result.recordset[0].Total > 0;
}

async function headerExistsWithIgnore(target, key, oldKey) {
  const request = target
    .request()
    .input('IdCetakan', sql.Int, key.idCetakan)
    .input('IdWarna', sql.Int, key.idWarna)
    .input('IdMaterial', sql.Int, key.idMaterial)
    .input('OldIdCetakan', sql.Int, oldKey.idCetakan)
    .input('OldIdWarna', sql.Int, oldKey.idWarna)
    .input('OldIdMaterial', sql.Int, oldKey.idMaterial);

  const result = await request.query(`
    SELECT COUNT(1) AS Total
    FROM [dbo].[CetakanWarna_h]
    WHERE IdCetakan = @IdCetakan
      AND IdWarna = @IdWarna
      AND ISNULL(IdFurnitureMaterial, 0) = @IdMaterial
      AND NOT (
        IdCetakan = @OldIdCetakan
        AND IdWarna = @OldIdWarna
        AND ISNULL(IdFurnitureMaterial, 0) = @OldIdMaterial
      );
  `);

  return result.recordset[0].Total > 0;
}

async function deleteDetails(target, key) {
  await keyedRequest(target, key).query(`
    DELETE FROM [dbo].[CetakanWarnaToProduk_d]
    WHERE IdCetakan = @IdCetakan
      AND IdWarna = @IdWarna
      AND ISNULL(IdFurnitureMaterial, 0) = @IdMaterial;
  `);

  await keyedRequest(target, key).query(`
    DELETE FROM [dbo].[CetakanWarnaToFurnitureWIP_d]
    WHERE IdCetakan = @IdCetakan
      AND IdWarna = @IdWarna
      AND ISNULL(IdFurnitureMaterial, 0) = @IdMaterial;
  `);
}

async function insertDetails(target, payload) {
  const material = payload.idMaterial > 0 ? payload.idMaterial : null;

  for (const idBJ of payload.barangJadi) {
    await target
      .request()
      .input('IdCetakan', sql.Int, payload.idCetakan)
      .input('IdWarna', sql.Int, payload.idWarna)
      .input('IdBJ', sql.Int, idBJ)
      .input('IdMaterial', sql.Int, material)
      .query(
        `INSERT INTO [dbo].[CetakanWarnaToProduk_d]
          (IdCetakan, IdWarna, IdBarangJadi, IdFurnitureMaterial)
         VALUES (@IdCetakan, @IdWarna, @IdBJ, @IdMaterial)`,
      );
  }

  for (const idWIP of payload.furnitureWip) {
    await target
      .request()
      .input('IdCetakan', sql.Int, payload.idCetakan)
      .input('IdWarna', sql.Int, payload.idWarna)
      .input('IdWIP', sql.Int, idWIP)
      .input('IdMaterial', sql.Int, material)
      .query(
        `INSERT INTO [dbo].[CetakanWarnaToFurnitureWIP_d]
          (IdCetakan, IdWarna, IdFurnitureWIP, IdFurnitureMaterial)
         VALUES (@IdCetakan, @IdWarna, @IdWIP, @IdMaterial)`,
      );
  }
}

async function describeKey(target, key) {
  const cetakan = await target
    .request()
    .input('Id', sql.Int, key.idCetakan)
    .query('SELECT NamaCetakan FROM [dbo].[MstCetakan] WHERE IdCetakan = @Id');

  const warna = await target
    .request()
    .input('Id', sql.Int, key.idWarna)
    .query('SELECT Warna FROM [dbo].[MstWarna] WHERE IdWarna = @Id');

  const namaCetakan = cetakan.recordset[0]?.NamaCetakan || String(key.idCetakan);
  const namaWarna = warna.recordset[0]?.Warna || String(key.idWarna);

  return `${namaCetakan} - ${namaWarna}`;
}

async function insertHistory(target, username, aktivitas) {
  await target
    .request()
    .input('User', sql.VarChar(100), String(username || ''))
    .input('Aktivitas', sql.VarChar(500), aktivitas)
    .query(
      `INSERT INTO [dbo].[History] ([User], Tanggal, Jam, Aktivitas)
       VALUES (@User, CONVERT(date, GETDATE()), CONVERT(time, GETDATE()), @Aktivitas)`,
    );
}

async function create(body, username) {
  const payload = normalizePayload(body);
  const pool = await poolPromise;
  await assertRefs(pool, payload);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (await headerExists(tx, payload)) {
      throw conflict('Data Cetakan + Warna + Material ini sudah ada');
    }

    await tx
      .request()
      .input('IdCetakan', sql.Int, payload.idCetakan)
      .input('IdWarna', sql.Int, payload.idWarna)
      .input(
        'IdMaterial',
        sql.Int,
        payload.idMaterial > 0 ? payload.idMaterial : null,
      )
      .query(
        `INSERT INTO [dbo].[CetakanWarna_h] (IdCetakan, IdWarna, IdFurnitureMaterial)
         VALUES (@IdCetakan, @IdWarna, @IdMaterial)`,
      );

    await insertDetails(tx, payload);

    const label = await describeKey(tx, payload);
    await insertHistory(
      tx,
      username,
      `User ${username} menambah data Cetakan ${label}`,
    );

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }

  return payload;
}

async function update(oldKeyRaw, body, username) {
  const oldKey = toKey(oldKeyRaw, 'Data lama');
  const payload = normalizePayload(body);
  const pool = await poolPromise;
  await assertRefs(pool, payload);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (await headerExistsWithIgnore(tx, payload, oldKey)) {
      throw conflict('Data Cetakan + Warna + Material tujuan sudah ada');
    }

    await deleteDetails(tx, oldKey);

    const headerResult = await tx
      .request()
      .input('OldIdCetakan', sql.Int, oldKey.idCetakan)
      .input('OldIdWarna', sql.Int, oldKey.idWarna)
      .input('OldIdMaterial', sql.Int, oldKey.idMaterial)
      .input('IdCetakan', sql.Int, payload.idCetakan)
      .input('IdWarna', sql.Int, payload.idWarna)
      .input(
        'IdMaterial',
        sql.Int,
        payload.idMaterial > 0 ? payload.idMaterial : null,
      )
      .query(
        `UPDATE [dbo].[CetakanWarna_h]
         SET IdCetakan = @IdCetakan,
             IdWarna = @IdWarna,
             IdFurnitureMaterial = @IdMaterial
         WHERE IdCetakan = @OldIdCetakan
           AND IdWarna = @OldIdWarna
           AND ISNULL(IdFurnitureMaterial, 0) = @OldIdMaterial`,
      );

    if (headerResult.rowsAffected[0] <= 0) {
      throw notFound(
        'Data header lama tidak ditemukan. Silahkan refresh dan pilih ulang data.',
      );
    }

    await insertDetails(tx, payload);

    const label = await describeKey(tx, payload);
    await insertHistory(
      tx,
      username,
      `User ${username} mengubah data Cetakan ${label}`,
    );

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // transaksi mungkin sudah gagal ditutup driver
    }
    throw error;
  }

  return payload;
}

async function remove(keyRaw, username) {
  const key = toKey(keyRaw, 'Data');
  const pool = await poolPromise;

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await deleteDetails(tx, key);

    const headerResult = await keyedRequest(tx, key).query(`
      DELETE FROM [dbo].[CetakanWarna_h]
      WHERE IdCetakan = @IdCetakan
        AND IdWarna = @IdWarna
        AND ISNULL(IdFurnitureMaterial, 0) = @IdMaterial;
    `);

    if (headerResult.rowsAffected[0] <= 0) {
      throw notFound(
        'Data header tidak ditemukan. Silahkan refresh dan pilih ulang data.',
      );
    }

    const label = await describeKey(tx, key);
    await insertHistory(
      tx,
      username,
      `User ${username} menghapus data Cetakan ${label}`,
    );

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
  getAllActive,
  getOptions,
  listWarnaMaterial,
  getDetail,
  create,
  update,
  remove,
};
