// Master Mesin Produksi — satu modul untuk 10 tabel MstMesin<Jenis> yang di
// aplikasi VB punya form sendiri-sendiri (FrmMstMesinBroker, FrmMstMesinCrusher, ...).
// Skema semuanya sama: IdMesin, NamaMesin, Kapasitas, IdUOM, Enable; Inject
// menambah ShortWeightPS, KlemLebar, KlemTinggi.
const sql = require("mssql");
const { poolPromise } = require("../../core/config/db");
const { badReq, notFound, conflict } = require("../../core/utils/http-error");

const INJECT_EXTRA = [
  { field: "shortWeightPS", column: "ShortWeightPS" },
  { field: "klemLebar", column: "KlemLebar" },
  { field: "klemTinggi", column: "KlemTinggi" },
];

// Whitelist slug → tabel. Nama tabel TIDAK pernah diambil dari input user.
const MESIN_TYPES = {
  broker: { table: "MstMesinBroker", label: "Broker" },
  crusher: { table: "MstMesinCrusher", label: "Crusher" },
  gilingan: { table: "MstMesinGilingan", label: "Gilingan" },
  "hot-stamping": { table: "MstMesinHotStamping", label: "Hot Stamping" },
  inject: { table: "MstMesinInject", label: "Inject", extra: INJECT_EXTRA },
  mixer: { table: "MstMesinMixer", label: "Mixer" },
  packing: { table: "MstMesinPacking", label: "Packing" },
  "pasang-kunci": { table: "MstMesinPasangKunci", label: "Pasang Kunci" },
  spanner: { table: "MstMesinSpanner", label: "Spanner" },
  washing: { table: "MstMesinWashing", label: "Washing" },
};

function resolveType(slug) {
  const cfg = Object.prototype.hasOwnProperty.call(MESIN_TYPES, slug)
    ? MESIN_TYPES[slug]
    : null;
  if (!cfg) throw badReq(`Jenis mesin tidak dikenali: ${slug}`);
  return cfg;
}

// Sama seperti ParseDecimalInput di VB: kosong → 0, koma dianggap desimal.
function parseDecimal(value, label, { required = false } = {}) {
  const raw = value == null ? "" : String(value).trim();
  if (raw === "") {
    if (required) throw badReq(`${label} wajib diisi`);
    return 0;
  }
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) throw badReq(`Format angka tidak valid: ${label}`);
  if (n < 0) throw badReq(`${label} tidak boleh negatif`);
  if (n > 9999999999999) throw badReq(`${label} terlalu besar`);
  return Math.round(n * 100) / 100;
}

function validateInput(cfg, body) {
  const namaMesin = String(body?.namaMesin ?? "").trim();
  if (!namaMesin) throw badReq("Nama mesin wajib diisi");
  if (namaMesin.length > 50) throw badReq("Nama mesin maksimal 50 karakter");

  const kapasitas = parseDecimal(body?.kapasitas, "Kapasitas", { required: true });

  const idUOM = Number(body?.idUOM);
  if (!Number.isInteger(idUOM) || idUOM <= 0) throw badReq("UOM wajib dipilih");

  const extra = {};
  for (const e of cfg.extra || []) {
    extra[e.column] = parseDecimal(body?.[e.field], e.column);
  }

  return {
    namaMesin,
    kapasitas,
    idUOM,
    extra,
    enable: body?.enable === undefined ? true : !!body.enable,
  };
}

function selectSql(cfg) {
  const extraCols = (cfg.extra || []).map((e) => `A.${e.column} AS ${e.field},`).join("\n      ");
  return `
    SELECT
      A.IdMesin AS idMesin,
      A.NamaMesin AS namaMesin,
      A.Kapasitas AS kapasitas,
      A.IdUOM AS idUOM,
      ISNULL(B.NamaUOM, '') AS namaUOM,
      ${extraCols}
      CAST(ISNULL(A.Enable, 0) AS bit) AS enable
    FROM dbo.${cfg.table} AS A
    LEFT JOIN dbo.MstUOM AS B ON B.IdUOM = A.IdUOM`;
}

function listTypes() {
  return Object.entries(MESIN_TYPES).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    extraFields: (cfg.extra || []).map((e) => e.field),
  }));
}

async function getSummary() {
  const pool = await poolPromise;
  const unions = Object.entries(MESIN_TYPES)
    .map(
      ([key, cfg]) =>
        `SELECT '${key}' AS tipe, COUNT(*) AS total, ISNULL(SUM(CASE WHEN ISNULL(Enable, 0) = 1 THEN 1 ELSE 0 END), 0) AS aktif FROM dbo.${cfg.table}`,
    )
    .join("\nUNION ALL\n");
  const res = await pool.request().query(unions);
  return res.recordset.map((r) => ({ key: r.tipe, total: r.total, aktif: r.aktif }));
}

async function getUomOptions() {
  const pool = await poolPromise;
  const res = await pool.request().query(`
    SELECT IdUOM AS idUOM, NamaUOM AS namaUOM
    FROM dbo.MstUOM
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaUOM`);
  return res.recordset;
}

async function list(slug, { search } = {}) {
  const cfg = resolveType(slug);
  const pool = await poolPromise;
  const keyword = String(search ?? "").trim().slice(0, 50);
  const res = await pool
    .request()
    .input("keyword", sql.VarChar(50), keyword)
    .query(`${selectSql(cfg)}
      WHERE (@keyword = '' OR A.NamaMesin LIKE '%' + @keyword + '%')
      ORDER BY A.IdMesin`);
  return res.recordset;
}

async function assertUomActive(reqFactory, idUOM) {
  const r = await reqFactory()
    .input("idUOM", sql.Int, idUOM)
    .query("SELECT COUNT(1) AS n FROM dbo.MstUOM WHERE IdUOM = @idUOM AND ISNULL(Enable, 1) = 1");
  if (!r.recordset[0].n) throw badReq("UOM tidak ditemukan atau tidak aktif");
}

async function assertNameFree(reqFactory, cfg, namaMesin, idMesinAbaikan) {
  const r = await reqFactory()
    .input("nama", sql.VarChar(50), namaMesin)
    .input("id", sql.Int, idMesinAbaikan)
    .query(`SELECT COUNT(1) AS n FROM dbo.${cfg.table} WHERE NamaMesin = @nama AND IdMesin <> @id`);
  if (r.recordset[0].n) throw conflict("Nama mesin sudah digunakan data lain");
}

async function create(slug, body) {
  const cfg = resolveType(slug);
  const data = validateInput(cfg, body);
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const rq = () => new sql.Request(tx);
    await assertUomActive(rq, data.idUOM);
    await assertNameFree(rq, cfg, data.namaMesin, 0);

    // IdMesin bukan IDENTITY (sama seperti VB: MAX + 1); kunci supaya dua
    // simpan bersamaan tidak mendapat ID yang sama.
    const next = await rq().query(
      `SELECT ISNULL(MAX(IdMesin), 0) + 1 AS id FROM dbo.${cfg.table} WITH (UPDLOCK, HOLDLOCK)`,
    );
    const idMesin = next.recordset[0].id;

    const extraCols = (cfg.extra || []).map((e) => e.column);
    const ins = rq()
      .input("id", sql.Int, idMesin)
      .input("nama", sql.VarChar(50), data.namaMesin)
      .input("kapasitas", sql.Decimal(18, 2), data.kapasitas)
      .input("idUOM", sql.Int, data.idUOM)
      .input("enable", sql.Bit, data.enable);
    for (const c of extraCols) ins.input(c, sql.Decimal(18, 2), data.extra[c]);
    await ins.query(`
      INSERT INTO dbo.${cfg.table} (IdMesin, NamaMesin, Kapasitas, IdUOM${extraCols.map((c) => `, ${c}`).join("")}, Enable)
      VALUES (@id, @nama, @kapasitas, @idUOM${extraCols.map((c) => `, @${c}`).join("")}, @enable)`);

    await tx.commit();
    return { idMesin };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

async function update(slug, idMesin, body) {
  const cfg = resolveType(slug);
  const id = Number(idMesin);
  if (!Number.isInteger(id) || id <= 0) throw badReq("ID mesin tidak valid");
  const data = validateInput(cfg, body);
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const rq = () => new sql.Request(tx);
    await assertUomActive(rq, data.idUOM);
    await assertNameFree(rq, cfg, data.namaMesin, id);

    const extraCols = (cfg.extra || []).map((e) => e.column);
    const upd = rq()
      .input("id", sql.Int, id)
      .input("nama", sql.VarChar(50), data.namaMesin)
      .input("kapasitas", sql.Decimal(18, 2), data.kapasitas)
      .input("idUOM", sql.Int, data.idUOM)
      .input("enable", sql.Bit, data.enable);
    for (const c of extraCols) upd.input(c, sql.Decimal(18, 2), data.extra[c]);
    const r = await upd.query(`
      UPDATE dbo.${cfg.table}
      SET NamaMesin = @nama, Kapasitas = @kapasitas, IdUOM = @idUOM,
          ${extraCols.map((c) => `${c} = @${c},`).join(" ")}
          Enable = @enable
      WHERE IdMesin = @id`);
    if (!r.rowsAffected[0]) throw notFound("Mesin tidak ditemukan");

    await tx.commit();
    return { idMesin: id };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

// "Hapus" di VB = menonaktifkan (Enable = 0), bukan DELETE — mesin masih
// direferensikan transaksi produksi lama.
async function disable(slug, idMesin) {
  const cfg = resolveType(slug);
  const id = Number(idMesin);
  if (!Number.isInteger(id) || id <= 0) throw badReq("ID mesin tidak valid");
  const pool = await poolPromise;
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE dbo.${cfg.table} SET Enable = 0 WHERE IdMesin = @id`);
  if (!r.rowsAffected[0]) throw notFound("Mesin tidak ditemukan");
  return { idMesin: id };
}

module.exports = {
  MESIN_TYPES,
  listTypes,
  getSummary,
  getUomOptions,
  list,
  create,
  update,
  disable,
  // untuk test
  _validateInput: validateInput,
  _parseDecimal: parseDecimal,
  _resolveType: resolveType,
};
