// Master Barang — satu modul untuk 11 master item yang di aplikasi VB punya
// form sendiri-sendiri (FrmMstBahanBaku, FrmMstBarangJadi, FrmMstBarangDagang,
// FrmMstBonggolan, FrmMstBroker, FrmMstCabinetWIP, FrmMstCabinetMaterial,
// FrmMstCrusher, FrmMstGilingan, FrmMstMixer, FrmMstWashing).
//
// Konfigurasi per jenis ada di MASTER_TYPES: nama tabel, kolom ID/nama/enable
// dan daftar field tambahan. Nama tabel/kolom TIDAK pernah diambil dari input
// user — hanya dari whitelist ini.
//
// Beda dengan VB: "hapus" = menonaktifkan (Enable = 0) karena item masih
// direferensikan transaksi lama; saldo awal per gudang & foto bahan baku tidak
// dikelola di sini.
const sql = require("mssql");
const { poolPromise } = require("../../core/config/db");
const { badReq, notFound, conflict } = require("../../core/utils/http-error");

// Sumber pilihan untuk field bertipe select.
const OPTION_SOURCES = {
  uom: { table: "MstUOM", id: "IdUOM", label: "NamaUOM", where: "ISNULL([Enable], 1) = 1" },
  form: { table: "MstForm", id: "IdForm", label: "JenisForm" },
  bjtype: { table: "MstBJType", id: "IdBJType", label: "NamaBJType" },
  subbarang: {
    table: "MstTypeSubBarang",
    id: "IdTypeSubBarang",
    label: "NamaTypeSubBarang",
    parent: "IdTypeBarang",
  },
  warna: { table: "MstWarna", id: "IdWarna", label: "Warna" },
};

const f = {
  uom: (extra = {}) => ({ key: "idUOM", column: "IdUOM", label: "UOM", kind: "select", source: "uom", required: true, list: true, ...extra }),
  form: () => ({ key: "idForm", column: "IdForm", label: "Form", kind: "select", source: "form", list: true }),
  itemCode: (extra = {}) => ({ key: "itemCode", column: "ItemCode", label: "Item Code", kind: "text", maxLength: 50, list: true, ...extra }),
  bool: (key, column, label, extra = {}) => ({ key, column, label, kind: "bool", list: true, ...extra }),
  decimal: (key, column, label, extra = {}) => ({ key, column, label, kind: "decimal", scale: 2, ...extra }),
  int: (key, column, label, extra = {}) => ({ key, column, label, kind: "int", ...extra }),
};

// Item Code unik lintas master (VW_AllItemCode) untuk jenis yang punya `sumber`;
// wajib diisi bila datanya aktif (data nonaktif lama banyak yang kosong).
const code = (sumber) => ({ sumber, field: f.itemCode() });

const MASTER_TYPES = {
  "bahan-baku": {
    label: "Bahan Baku",
    table: "MstBahanBaku",
    idCol: "IdBB",
    nameCol: "Nama",
    enableCol: "IsEnable",
    fields: [
      f.uom({ required: false }),
      f.form(),
      f.itemCode(),
      f.bool("isReject", "IsReject", "Reject"),
      f.bool("isProses", "IsProses", "Proses"),
      f.bool("isDisableMinMax", "IsDisableMinMax", "Nonaktifkan Min/Max", { default: true }),
    ],
  },
  "barang-jadi": {
    label: "Barang Jadi",
    table: "MstBarangJadi",
    idCol: "IdBJ",
    nameCol: "NamaBJ",
    enableCol: "Enable",
    insertExtra: { TglSaldoAwal: "CAST(GETDATE() AS date)" },
    fields: [
      code("BarangJadi").field,
      { key: "idBJType", column: "IdBJType", label: "Tipe BJ", kind: "select", source: "bjtype", required: true, list: true },
      { key: "idTypeSubBarang", column: "IdTypeSubBarang", label: "Sub Tipe", kind: "select", source: "subbarang", dependsOn: "idBJType", list: true },
      f.uom(),
      f.decimal("beratSTD", "BeratSTD", "Berat STD", { list: true }),
      f.int("pcsPerLabel", "PcsPerLabel", "Pcs / Label", { list: true }),
      f.decimal("minStock", "MinStock", "Min Stock"),
      f.decimal("maxStock", "MaxStock", "Max Stock"),
      f.decimal("mpq", "MPQ", "MPQ"),
    ],
    sumber: "BarangJadi",
  },
  "barang-dagang": {
    label: "Barang Dagang",
    table: "MstBarangDagang",
    idCol: "IdBarangDagang",
    nameCol: "NamaBarangDagang",
    enableCol: "Enable",
    sumber: "BarangDagang",
    fields: [
      code("BarangDagang").field,
      f.uom({ required: false }),
      f.decimal("beratSTD", "BeratSTD", "Berat STD", { list: true }),
      f.int("pcsPerLabel", "PcsPerLabel", "Pcs / Label", { list: true }),
    ],
  },
  bonggolan: {
    label: "Bonggolan",
    table: "MstBonggolan",
    idCol: "IdBonggolan",
    nameCol: "NamaBonggolan",
    enableCol: "Enable",
    sumber: "Bonggolan",
    fields: [code("Bonggolan").field],
  },
  broker: {
    label: "Broker",
    table: "MstBroker",
    idCol: "IdBroker",
    nameCol: "Nama",
    enableCol: "IsEnable",
    fields: [
      f.uom({ required: false }),
      f.form(),
      f.itemCode(),
      f.bool("isReject", "IsReject", "Reject"),
      f.bool("isDisableMinMax", "IsDisableMinMax", "Nonaktifkan Min/Max", { default: true }),
    ],
  },
  "cabinet-wip": {
    label: "Cabinet WIP",
    table: "MstCabinetWIP",
    idCol: "IdCabinetWIP",
    nameCol: "Nama",
    enableCol: "Enable",
    sumber: "CabinetWIP",
    insertExtra: { TglSaldoAwal: "CAST(GETDATE() AS date)" },
    fields: [
      code("CabinetWIP").field,
      f.uom(),
      { key: "idWarna", column: "IdWarna", label: "Warna", kind: "select", source: "warna", required: true, list: true },
      f.int("pcsPerLabel", "PcsPerLabel", "Pcs / Label", { list: true }),
      f.decimal("berat", "Berat", "Berat", { scale: 4, list: true }),
    ],
  },
  "cabinet-material": {
    label: "Cabinet Material",
    table: "MstCabinetMaterial",
    idCol: "IdCabinetMaterial",
    nameCol: "Nama",
    enableCol: "Enable",
    sumber: "CabinetMaterial",
    insertExtra: { TglSaldoAwal: "CAST(GETDATE() AS date)" },
    fields: [
      code("CabinetMaterial").field,
      f.uom(),
      f.int("pcsPerLabel", "PcsPerLabel", "Pcs / Label", { list: true }),
    ],
  },
  crusher: {
    label: "Crusher",
    table: "MstCrusher",
    idCol: "IdCrusher",
    nameCol: "NamaCrusher",
    enableCol: "Enable",
    sumber: "Crusher",
    fields: [code("Crusher").field],
  },
  gilingan: {
    label: "Gilingan",
    table: "MstGilingan",
    idCol: "IdGilingan",
    nameCol: "NamaGilingan",
    enableCol: "Enable",
    sumber: "Gilingan",
    fields: [code("Gilingan").field, f.decimal("saldoAwal", "SaldoAwal", "Saldo Awal", { list: true })],
  },
  mixer: {
    label: "Mixer",
    table: "MstMixer",
    idCol: "IdMixer",
    nameCol: "Jenis",
    nameLabel: "Jenis Mixer",
    enableCol: "Enable",
    sumber: "Mixer",
    fields: [code("Mixer").field],
  },
  washing: {
    label: "Washing",
    table: "MstWashing",
    idCol: "IdWashing",
    nameCol: "Nama",
    enableCol: "IsEnable",
    fields: [
      f.uom({ required: false }),
      f.form(),
      f.itemCode(),
      f.bool("isReject", "IsReject", "Reject"),
      f.bool("isDisableMinMax", "IsDisableMinMax", "Nonaktifkan Min/Max", { default: true }),
    ],
  },
};

const NAME_MAX = 200;

function resolveType(slug) {
  const cfg = Object.prototype.hasOwnProperty.call(MASTER_TYPES, slug) ? MASTER_TYPES[slug] : null;
  if (!cfg) throw badReq(`Jenis master tidak dikenali: ${slug}`);
  return cfg;
}

function parseDecimal(value, label, scale) {
  const raw = value == null ? "" : String(value).trim();
  if (raw === "") return 0;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) throw badReq(`Format angka tidak valid: ${label}`);
  if (n < 0) throw badReq(`${label} tidak boleh negatif`);
  if (n > 999999999999) throw badReq(`${label} terlalu besar`);
  const p = 10 ** scale;
  return Math.round(n * p) / p;
}

function parseField(field, body) {
  const raw = body?.[field.key];
  switch (field.kind) {
    case "bool":
      return raw === undefined ? !!field.default : !!raw;
    case "decimal":
      return parseDecimal(raw, field.label, field.scale ?? 2);
    case "int": {
      const s = raw == null ? "" : String(raw).trim();
      if (s === "") return 0;
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
        throw badReq(`${field.label} harus bilangan bulat tidak negatif`);
      }
      return n;
    }
    case "select": {
      if (raw == null || raw === "") {
        if (field.required) throw badReq(`${field.label} wajib dipilih`);
        return null;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw badReq(`${field.label} tidak valid`);
      return n;
    }
    default: {
      const s = raw == null ? "" : String(raw).trim();
      if (!s) {
        if (field.required) throw badReq(`${field.label} wajib diisi`);
        return null;
      }
      if (field.maxLength && s.length > field.maxLength) {
        throw badReq(`${field.label} maksimal ${field.maxLength} karakter`);
      }
      return s;
    }
  }
}

function validateInput(cfg, body) {
  const nama = String(body?.nama ?? "").trim();
  if (!nama) throw badReq(`${cfg.nameLabel || "Nama"} wajib diisi`);
  if (nama.length > NAME_MAX) throw badReq(`${cfg.nameLabel || "Nama"} maksimal ${NAME_MAX} karakter`);

  const values = {};
  for (const field of cfg.fields) values[field.key] = parseField(field, body);

  const enable = body?.enable === undefined ? true : !!body.enable;
  if (cfg.sumber && enable && !values.itemCode) throw badReq("Item Code wajib diisi untuk data aktif");

  return { nama, values, enable };
}

function sqlType(field) {
  switch (field.kind) {
    case "bool":
      return sql.Bit;
    case "decimal":
      return sql.Decimal(18, field.scale ?? 2);
    case "int":
    case "select":
      return sql.Int;
    default:
      return sql.VarChar(field.maxLength || 50);
  }
}

function selectSql(cfg) {
  const joins = [];
  const cols = [];
  for (const field of cfg.fields) {
    if (field.kind === "bool") {
      cols.push(`CAST(ISNULL(A.${field.column}, 0) AS bit) AS ${field.key}`);
    } else if (field.kind === "select") {
      const src = OPTION_SOURCES[field.source];
      const alias = `J_${field.key}`;
      joins.push(`LEFT JOIN dbo.${src.table} AS ${alias} ON ${alias}.${src.id} = A.${field.column}`);
      cols.push(`A.${field.column} AS ${field.key}`, `ISNULL(${alias}.${src.label}, '') AS ${field.key}Label`);
    } else if (field.kind === "text") {
      cols.push(`ISNULL(A.${field.column}, '') AS ${field.key}`);
    } else {
      cols.push(`ISNULL(A.${field.column}, 0) AS ${field.key}`);
    }
  }
  return `
    SELECT
      A.${cfg.idCol} AS id,
      A.${cfg.nameCol} AS nama,
      CAST(ISNULL(A.${cfg.enableCol}, 0) AS bit) AS enable,
      ${cols.join(",\n      ")}
    FROM dbo.${cfg.table} AS A
    ${joins.join("\n    ")}`;
}

function listTypes() {
  return Object.entries(MASTER_TYPES).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    nameLabel: cfg.nameLabel || "Nama",
    fields: cfg.fields.map((fld) => ({
      key: fld.key,
      label: fld.label,
      kind: fld.kind,
      source: fld.source,
      dependsOn: fld.dependsOn,
      required: !!fld.required,
      maxLength: fld.maxLength,
      list: !!fld.list,
      default: fld.default,
    })),
  }));
}

async function getSummary() {
  const pool = await poolPromise;
  const unions = Object.entries(MASTER_TYPES)
    .map(
      ([key, cfg]) =>
        `SELECT '${key}' AS tipe, COUNT(*) AS total, ISNULL(SUM(CASE WHEN ISNULL(${cfg.enableCol}, 0) = 1 THEN 1 ELSE 0 END), 0) AS aktif FROM dbo.${cfg.table}`,
    )
    .join("\nUNION ALL\n");
  const res = await pool.request().query(unions);
  return res.recordset.map((r) => ({ key: r.tipe, total: r.total, aktif: r.aktif }));
}

async function getOptions() {
  const pool = await poolPromise;
  const out = {};
  for (const [name, src] of Object.entries(OPTION_SOURCES)) {
    const res = await pool.request().query(`
      SELECT ${src.id} AS id, ${src.label} AS label${src.parent ? `, ${src.parent} AS parentId` : ""}
      FROM dbo.${src.table}
      ${src.where ? `WHERE ${src.where}` : ""}
      ORDER BY ${src.label}`);
    out[name] = res.recordset;
  }
  return out;
}

async function list(slug, { search } = {}) {
  const cfg = resolveType(slug);
  const pool = await poolPromise;
  const keyword = String(search ?? "").trim().slice(0, 100);
  const codeField = cfg.fields.find((x) => x.key === "itemCode");
  const res = await pool
    .request()
    .input("keyword", sql.VarChar(100), keyword)
    .query(`${selectSql(cfg)}
      WHERE (@keyword = ''
        OR A.${cfg.nameCol} LIKE '%' + @keyword + '%'
        ${codeField ? `OR ISNULL(A.${codeField.column}, '') LIKE '%' + @keyword + '%'` : ""})
      ORDER BY A.${cfg.nameCol}`);
  return res.recordset;
}

async function assertOptionsValid(rq, cfg, values) {
  for (const field of cfg.fields) {
    const v = values[field.key];
    if (field.kind !== "select" || v == null) continue;
    const src = OPTION_SOURCES[field.source];
    const r = await rq()
      .input("v", sql.Int, v)
      .query(`SELECT COUNT(1) AS n FROM dbo.${src.table} WHERE ${src.id} = @v${src.where ? ` AND ${src.where}` : ""}`);
    if (!r.recordset[0].n) throw badReq(`${field.label} tidak ditemukan`);
  }
}

async function assertNameFree(rq, cfg, nama, idAbaikan) {
  const r = await rq()
    .input("nama", sql.VarChar(NAME_MAX), nama)
    .input("id", sql.Int, idAbaikan)
    .query(`SELECT COUNT(1) AS n FROM dbo.${cfg.table} WHERE ${cfg.nameCol} = @nama AND ${cfg.idCol} <> @id`);
  if (r.recordset[0].n) throw conflict(`${cfg.nameLabel || "Nama"} sudah digunakan data lain`);
}

// Sama seperti cek VW_AllItemCode di VB: kode tidak boleh dipakai master lain.
async function assertItemCodeFree(rq, cfg, values, idSendiri) {
  const codeValue = values.itemCode;
  if (!cfg.sumber || !codeValue) return;
  const r = await rq()
    .input("code", sql.VarChar(50), codeValue)
    .input("sumber", sql.VarChar(50), cfg.sumber)
    .input("id", sql.Int, idSendiri)
    .query(`SELECT TOP 1 ItemCode, Sumber FROM dbo.VW_AllItemCode
            WHERE ItemCode = @code AND NOT (Sumber = @sumber AND IdRef = @id)`);
  if (r.recordset.length) {
    throw conflict(`Item Code '${codeValue}' sudah digunakan di master ${r.recordset[0].Sumber}`);
  }
}

function bindFields(req, cfg, data) {
  for (const field of cfg.fields) req.input(field.key, sqlType(field), data.values[field.key]);
  return req;
}

async function create(slug, body) {
  const cfg = resolveType(slug);
  const data = validateInput(cfg, body);
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const rq = () => new sql.Request(tx);
    await assertOptionsValid(rq, cfg, data.values);
    await assertNameFree(rq, cfg, data.nama, 0);

    // ID bukan IDENTITY (sama seperti VB: MAX + 1); kunci supaya dua simpan
    // bersamaan tidak mendapat ID yang sama.
    const next = await rq().query(
      `SELECT ISNULL(MAX(${cfg.idCol}), 0) + 1 AS id FROM dbo.${cfg.table} WITH (UPDLOCK, HOLDLOCK)`,
    );
    const id = next.recordset[0].id;
    await assertItemCodeFree(rq, cfg, data.values, id);

    const extra = Object.entries(cfg.insertExtra || {});
    const cols = [cfg.idCol, cfg.nameCol, cfg.enableCol, ...cfg.fields.map((x) => x.column), ...extra.map(([c]) => c)];
    const vals = ["@id", "@nama", "@enable", ...cfg.fields.map((x) => `@${x.key}`), ...extra.map(([, v]) => v)];
    const ins = bindFields(
      rq().input("id", sql.Int, id).input("nama", sql.VarChar(NAME_MAX), data.nama).input("enable", sql.Bit, data.enable),
      cfg,
      data,
    );
    await ins.query(`INSERT INTO dbo.${cfg.table} (${cols.join(", ")}) VALUES (${vals.join(", ")})`);

    await tx.commit();
    return { id };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

async function update(slug, idRaw, body) {
  const cfg = resolveType(slug);
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) throw badReq("ID tidak valid");
  const data = validateInput(cfg, body);
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const rq = () => new sql.Request(tx);
    await assertOptionsValid(rq, cfg, data.values);
    await assertNameFree(rq, cfg, data.nama, id);
    await assertItemCodeFree(rq, cfg, data.values, id);

    const sets = [`${cfg.nameCol} = @nama`, `${cfg.enableCol} = @enable`, ...cfg.fields.map((x) => `${x.column} = @${x.key}`)];
    const upd = bindFields(
      rq().input("id", sql.Int, id).input("nama", sql.VarChar(NAME_MAX), data.nama).input("enable", sql.Bit, data.enable),
      cfg,
      data,
    );
    const r = await upd.query(`UPDATE dbo.${cfg.table} SET ${sets.join(", ")} WHERE ${cfg.idCol} = @id`);
    if (!r.rowsAffected[0]) throw notFound("Data tidak ditemukan");

    await tx.commit();
    return { id };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

async function disable(slug, idRaw) {
  const cfg = resolveType(slug);
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) throw badReq("ID tidak valid");
  const pool = await poolPromise;
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE dbo.${cfg.table} SET ${cfg.enableCol} = 0 WHERE ${cfg.idCol} = @id`);
  if (!r.rowsAffected[0]) throw notFound("Data tidak ditemukan");
  return { id };
}

module.exports = {
  MASTER_TYPES,
  listTypes,
  getSummary,
  getOptions,
  list,
  create,
  update,
  disable,
  // untuk test
  _validateInput: validateInput,
  _resolveType: resolveType,
};
