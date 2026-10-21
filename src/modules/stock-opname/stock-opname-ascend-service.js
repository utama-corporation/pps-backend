// Stock Opname Ascend — pembuatan header SO (FrmStockOpname.vb: BtnBaru + ChkAscend,
// SaveStockOpnameMulti) dan data laporan (LinkLabel1_LinkClicked → CrStockOpnameAscend).
// Hanya mode Ascend: nomor SO berawalan "AA", gudang dari AS_GSU.IC_Warehouses,
// item & stok awal dihitung dari data AS_GSU.
const { sql, poolPromise } = require("../../core/config/db");
const { badReq, notFound } = require("../../core/utils/http-error");
const { applyAuditContext } = require("../../core/utils/db-audit-context");
const { assertNotLocked } = require("../../core/shared/tutup-transaksi-guard");
const ASCEND_INSERT_SQL = require("./stock-opname-ascend-insert.sql");

const NO_PREFIX = "AA";

// Query hitung stok bisa lama (UDF + banyak join per famili) → pool terpisah
// dengan requestTimeout panjang; pool utama default 15 detik.
async function openLongRunningPool() {
  const pool = new sql.ConnectionPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_DATABASE,
    requestTimeout: 600000,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 1, min: 0 },
  });
  await pool.connect();
  return pool;
}

async function getAscendOptions() {
  const pool = await poolPromise;
  const [wh, tree] = await Promise.all([
    pool.request().query(`
      SELECT WarehouseID AS id, Name AS name
      FROM AS_GSU.dbo.IC_Warehouses
      WHERE Disabled = 0
      ORDER BY Name`),
    pool.request().query(`
      SELECT c.StockCategoryID AS categoryId, c.StockCategoryName AS categoryName,
             f.FamilyID AS familyId, f.FamilyName AS familyName
      FROM AS_GSU.dbo.IC_StockCategories c
      LEFT JOIN AS_GSU.dbo.IC_StockFamily f ON f.StockCategoryID = c.StockCategoryID
      ORDER BY c.StockCategoryName, f.FamilyName`),
  ]);

  const byCat = new Map();
  for (const r of tree.recordset) {
    if (!byCat.has(r.categoryId)) {
      byCat.set(r.categoryId, { id: r.categoryId, name: r.categoryName, families: [] });
    }
    if (r.familyId != null) {
      byCat.get(r.categoryId).families.push({ id: r.familyId, name: r.familyName });
    }
  }
  return { warehouses: wh.recordset, categories: [...byCat.values()] };
}

function toIntList(v, label) {
  if (!Array.isArray(v)) throw badReq(`${label} tidak valid`);
  const out = [...new Set(v.map(Number))];
  if (out.some((n) => !Number.isInteger(n) || n <= 0)) throw badReq(`${label} tidak valid`);
  return out;
}

function validateCreate(body) {
  const tanggal = String(body?.tanggal ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw badReq("Tanggal SO tidak valid");

  const allWarehouses = !!body?.allWarehouses;
  const warehouseIds = allWarehouses ? [] : toIntList(body?.warehouseIds ?? [], "Warehouse");
  if (!allWarehouses && warehouseIds.length === 0) {
    throw badReq("Silakan pilih minimal satu warehouse");
  }

  const raw = Array.isArray(body?.selections) ? body.selections : [];
  const selections = raw
    .map((s) => ({
      categoryId: Number(s?.categoryId),
      familyIds: toIntList(s?.familyIds ?? [], "Famili"),
    }))
    .filter((s) => s.familyIds.length > 0);
  if (selections.some((s) => !Number.isInteger(s.categoryId) || s.categoryId <= 0)) {
    throw badReq("Kategori tidak valid");
  }
  if (selections.length === 0) throw badReq("Silakan pilih minimal satu Family");

  return { tanggal, allWarehouses, warehouseIds, selections };
}

/**
 * Buat SO Ascend baru: header + warehouse + famili + item (Pcs = stok Ascend
 * s/d tanggal SO, item dengan stok 0 tidak dimasukkan — sama seperti VB).
 * @returns {Promise<{noSO: string, totalItem: number}>}
 */
async function createAscendHeader(body, actor = {}) {
  const input = validateCreate(body);
  await assertNotLocked({ date: input.tanggal, action: "membuat Stock Opname" });

  const pool = await openLongRunningPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const rq = () => new sql.Request(tx);
    await applyAuditContext(rq(), actor);

    // Warehouse
    let wids = input.warehouseIds;
    if (input.allWarehouses) {
      const all = await rq().query(
        "SELECT WarehouseID AS id FROM AS_GSU.dbo.IC_Warehouses WHERE Disabled = 0",
      );
      wids = all.recordset.map((r) => r.id);
    } else {
      const ok = await rq().query(
        `SELECT WarehouseID AS id FROM AS_GSU.dbo.IC_Warehouses
         WHERE Disabled = 0 AND WarehouseID IN (${wids.join(",")})`,
      );
      if (ok.recordset.length !== wids.length) throw badReq("Ada warehouse yang tidak valid");
    }
    if (wids.length === 0) throw badReq("Tidak ada Warehouse yang dipilih");

    // Nomor SO: AA + 10 digit, kunci tabel supaya dua simpan tidak kembar.
    const next = await rq().query(`
      SELECT '${NO_PREFIX}' + FORMAT(ISNULL(MAX(CAST(RIGHT(NoSO, 10) AS INT)), 0) + 1, '0000000000') AS no
      FROM dbo.StockOpname_h WITH (UPDLOCK, HOLDLOCK)
      WHERE LEFT(NoSO, 2) = '${NO_PREFIX}'`);
    const noSO = next.recordset[0].no;

    await rq()
      .input("noSO", sql.VarChar(50), noSO)
      .input("tgl", sql.Date, input.tanggal)
      .query(`
        INSERT INTO dbo.StockOpname_h
          (NoSO, Tanggal, IsBahanBaku, IsWashing, IsBonggolan, IsCrusher, IsBroker,
           IsGilingan, IsMixer, IsFurnitureWip, IsBarangJadi, IsReject, IsAscend)
        VALUES (@noSO, @tgl, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)`);

    await rq()
      .input("noSO", sql.VarChar(50), noSO)
      .query(`
        INSERT INTO dbo.StockOpname_h_WarehouseID (NoSO, IdWarehouse)
        SELECT @noSO, CAST([value] AS INT) FROM STRING_SPLIT('${wids.join(",")}', ',')`);

    const wCsv = wids.join(",");
    for (const { categoryId, familyIds } of input.selections) {
      for (const familyId of familyIds) {
        await rq()
          .input("noSO", sql.VarChar(13), noSO)
          .input("cat", sql.Int, categoryId)
          .input("fam", sql.Int, familyId)
          .query(
            "INSERT INTO dbo.StockOpnameAscend_dFamily (NoSO, CategoryID, FamilyID) VALUES (@noSO, @cat, @fam)",
          );

        await rq()
          .input("NoSO", sql.VarChar(13), noSO)
          .input("CategoryID", sql.Int, categoryId)
          .input("FamilyID", sql.Int, familyId)
          .input("EndDate", sql.Date, input.tanggal)
          .input("WIDsCsv", sql.VarChar(sql.MAX), wCsv)
          .query(ASCEND_INSERT_SQL);
      }
    }

    const cnt = await rq()
      .input("noSO", sql.VarChar(50), noSO)
      .query("SELECT COUNT(*) AS n FROM dbo.StockOpnameAscend WHERE NoSO = @noSO");

    await tx.commit();
    return { noSO, totalItem: cnt.recordset[0].n };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    await pool.close().catch(() => {});
  }
}

/** Data laporan SO Ascend — padanan query LinkLabel1_LinkClicked + header (tanggal, gudang). */
async function getAscendReportData(noSO) {
  const pool = await poolPromise;
  const head = await pool
    .request()
    .input("noSO", sql.VarChar(50), noSO)
    .query(`
      SELECT h.NoSO, h.Tanggal,
        ISNULL((
          SELECT STRING_AGG(w.Name, ', ') WITHIN GROUP (ORDER BY w.Name)
          FROM dbo.StockOpname_h_WarehouseID x
          JOIN AS_GSU.dbo.IC_Warehouses w ON w.WarehouseID = x.IdWarehouse
          WHERE x.NoSO = h.NoSO
        ), '-') AS Gudang
      FROM dbo.StockOpname_h h
      WHERE h.NoSO = @noSO AND h.IsAscend = 1`);
  if (!head.recordset.length) throw notFound("Stock Opname Ascend tidak ditemukan");

  const rows = await pool
    .request()
    .input("noSO", sql.VarChar(50), noSO)
    .query(`
      SELECT ISNULL(B.FamilyName, '') AS FamilyName, ISNULL(D.ItemName, '') AS ItemName,
             A.Pcs, E.QtyFisik, E.UsageRemark
      FROM dbo.StockOpnameAscend A
      LEFT JOIN AS_GSU.dbo.IC_StockFamily B ON B.FamilyID = A.FamilyID
      LEFT JOIN AS_GSU.dbo.IC_Items D ON D.ItemID = A.ItemID
      LEFT JOIN dbo.StockOpnameAscendHasil E ON E.NoSO = A.NoSO AND E.ItemID = A.ItemID
      WHERE A.NoSO = @noSO
      ORDER BY B.FamilyName, D.ItemName`);

  return {
    noSO: head.recordset[0].NoSO,
    tanggal: head.recordset[0].Tanggal,
    gudang: head.recordset[0].Gudang,
    rows: rows.recordset,
  };
}

module.exports = {
  NO_PREFIX,
  getAscendOptions,
  createAscendHeader,
  getAscendReportData,
  _validateCreate: validateCreate,
};
