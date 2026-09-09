const { sql } = require("../config/db");
const { generateNextCode } = require("../utils/sequence-code-helper");

// Konfigurasi per-kategori untuk memecah label fisik jadi partial. Dipakai
// bareng oleh modul yang scan label & butuh "partial consumption" (penjualan,
// retur-v3). Key = kodeKategori ('barangjadi' | 'furniturewip') — string yang
// sama persis dipakai kedua modul.
const PARTIAL_CONFIG = {
  furniturewip: {
    parentTable: "FurnitureWIP",
    parentColumn: "NoFurnitureWIP",
    jenisColumn: "IDFurnitureWIP",
    partialTable: "FurnitureWIPPartial",
    partialColumn: "NoFurnitureWIPPartial",
    partialParentColumn: "NoFurnitureWIP",
    partialPrefix: "BC.",
  },
  barangjadi: {
    parentTable: "BarangJadi",
    parentColumn: "NoBJ",
    jenisColumn: "IdBJ",
    partialTable: "BarangJadiPartial",
    partialColumn: "NoBJPartial",
    partialParentColumn: "NoBJ",
    partialPrefix: "BL.",
  },
};

// Lock parent label row (belum pernah fully-consumed) + hitung sisa pcs
// yang masih tersedia (Pcs parent dikurangi total yang sudah dipecah jadi
// partial sebelumnya — baik oleh modul lain maupun oleh modul pemanggil).
async function lockParentAndAvailablePcs(tx, category, noLabel) {
  const cfg = PARTIAL_CONFIG[category];

  const parentRes = await new sql.Request(tx).input(
    "NoLabel",
    sql.VarChar(50),
    noLabel,
  ).query(`
      SELECT ${cfg.parentColumn} AS NoLabel, ${cfg.jenisColumn} AS IdJenis, Pcs AS ParentPcs, IsPartial
      FROM dbo.${cfg.parentTable} WITH (UPDLOCK, HOLDLOCK)
      WHERE ${cfg.parentColumn} = @NoLabel AND DateUsage IS NULL
    `);
  const parent = parentRes.recordset?.[0];
  if (!parent) return null;

  const partialRes = await new sql.Request(tx).input(
    "NoLabel",
    sql.VarChar(50),
    noLabel,
  ).query(`
      SELECT ISNULL(SUM(Pcs), 0) AS PartialPcs
      FROM dbo.${cfg.partialTable} WITH (UPDLOCK, HOLDLOCK)
      WHERE ${cfg.partialParentColumn} = @NoLabel
    `);
  const partialPcs = Number(partialRes.recordset?.[0]?.PartialPcs || 0);
  const parentPcs = Number(parent.ParentPcs || 0);
  // Pcs kolom partial bertipe float di DB meski nilainya selalu bulat —
  // bulatkan supaya tidak ada sisa desimal mengambang saat dikonversi ke
  // sql.Int di query lain.
  const availablePcs = Math.max(Math.round(parentPcs - partialPcs), 0);

  return { ...parent, parentPcs, availablePcs };
}

// Tandai parent fully-consumed (dipakai saat availablePcs habis dalam 1x scan).
async function markParentFullyUsed(tx, category, noLabel) {
  const cfg = PARTIAL_CONFIG[category];
  const res = await new sql.Request(tx).input(
    "NoLabel",
    sql.VarChar(50),
    noLabel,
  ).query(`
      UPDATE dbo.${cfg.parentTable}
      SET DateUsage = GETDATE()
      WHERE ${cfg.parentColumn} = @NoLabel AND DateUsage IS NULL
    `);
  return res.rowsAffected?.[0] || 0;
}

// Pecah [pcs] dari parent jadi baris partial baru — parent.Pcs TIDAK
// dikurangi (konvensi yang sama dipakai modul lain: sisa pcs parent
// dihitung on-the-fly dari Pcs - SUM(partial)), parent hanya ditandai
// IsPartial=1 dan DateUsage TETAP NULL (sisanya masih bisa dipakai lagi).
async function createPartial(tx, category, noLabel, pcs) {
  const cfg = PARTIAL_CONFIG[category];

  const gen = () =>
    generateNextCode(tx, {
      tableName: `dbo.${cfg.partialTable}`,
      columnName: cfg.partialColumn,
      prefix: cfg.partialPrefix,
      width: 10,
    });

  let partialCode = await gen();
  const exist = await new sql.Request(tx)
    .input("Code", sql.VarChar(50), partialCode)
    .query(
      `SELECT 1 FROM dbo.${cfg.partialTable} WITH (UPDLOCK, HOLDLOCK) WHERE ${cfg.partialColumn} = @Code`,
    );
  if (exist.recordset.length > 0) {
    partialCode = await gen();
  }

  await new sql.Request(tx)
    .input("Code", sql.VarChar(50), partialCode)
    .input("Parent", sql.VarChar(50), noLabel)
    .input("Pcs", sql.Float, pcs).query(`
      INSERT INTO dbo.${cfg.partialTable} (${cfg.partialColumn}, ${cfg.partialParentColumn}, Pcs)
      VALUES (@Code, @Parent, @Pcs)
    `);

  await new sql.Request(tx).input("NoLabel", sql.VarChar(50), noLabel).query(`
      UPDATE dbo.${cfg.parentTable}
      SET IsPartial = 1
      WHERE ${cfg.parentColumn} = @NoLabel AND ISNULL(IsPartial, 0) = 0
    `);

  return partialCode;
}

module.exports = {
  PARTIAL_CONFIG,
  lockParentAndAvailablePcs,
  markParentFullyUsed,
  createPartial,
};
