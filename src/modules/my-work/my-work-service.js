/* ============================================================
 * My Work (Workspace & Analytics): antrian pekerjaan tertunda milik
 * pengguna yang login. Pola sama dengan My Work MCS: beberapa antrian
 * berisi jumlah, lalu daftar item per antrian.
 *
 * Semua antrian diambil dari kondisi data yang sudah ada di PPS (belum ada
 * alur approval). "Milik saya" = kolom CreateBy berisi username token.
 * Antrian & sumber disaring per izin: sumber tanpa izin tidak di-query.
 *
 *  - produksi_pending : shift sudah lewat tapi IsComplete = 0 (status
 *                       'pending', logika sama dengan riwayat produksi)
 *  - label_unprinted  : label buatan saya yang belum pernah dicetak dan
 *                       belum terpakai, dibuat <= LABEL_DAYS hari terakhir
 *  - stock_opname     : sesi Stock Opname belum selesai, <= SO_DAYS hari
 *                       (SO lama yang tak pernah ditutup tidak dihitung)
 *  - spk_open         : SPK Produksi Barang Jadi berstatus OPEN
 * ==========================================================*/

const { sql, poolPromise } = require("../../core/config/db");
const { deriveProduksiStatus } = require("../../core/utils/produksi-status");

const LABEL_DAYS = 30;
const SO_DAYS = 14;
const MAX_ITEMS = 500;

// `module` = kunci yang dipetakan frontend ke layar tujuan.
const DEPTS = [
  { module: "washing", label: "Washing", table: "WashingProduksi_h", no: "NoProduksi", date: "TglProduksi", perm: "produksi_washing:read" },
  { module: "broker", label: "Broker", table: "BrokerProduksi_h", no: "NoProduksi", date: "TglProduksi", perm: "produksi_broker:read" },
  { module: "crusher", label: "Crusher", table: "CrusherProduksi_h", no: "NoCrusherProduksi", date: "Tanggal", perm: "produksi_crusher:read" },
  { module: "mixer", label: "Mixer", table: "MixerProduksi_h", no: "NoProduksi", date: "TglProduksi", perm: "produksi_mixer:read" },
  { module: "inject", label: "Inject", table: "InjectProduksi_h", no: "NoProduksi", date: "TglProduksi", perm: "injectproduksi:read" },
  { module: "gilingan", label: "Gilingan", table: "GilinganProduksi_h", no: "NoProduksi", date: "Tanggal", perm: "produksi_gilingan:read" },
  { module: "hot-stamp", label: "Stamping", table: "HotStamping_h", no: "NoProduksi", date: "Tanggal", perm: "hotstamping:read" },
  { module: "key-fitting", label: "Pasang Kunci", table: "PasangKunci_h", no: "NoProduksi", date: "Tanggal", perm: "pasangkunci:read" },
  { module: "spanner", label: "Spanner", table: "Spanner_h", no: "NoProduksi", date: "Tanggal", perm: "spanner:read" },
  { module: "packing", label: "Packing", table: "PackingProduksi_h", no: "NoPacking", date: "Tanggal", perm: "packing:read" },
];

// `usage` = tabel punya DateUsage di header (label sekali pakai). Washing,
// Broker, Mixer menyimpan pemakaian per sak, jadi cukup cek HasBeenPrinted.
const LABELS = [
  { module: "label-washing", label: "Washing", table: "Washing_h", no: "NoWashing", date: "DateCreate", usage: false, perm: "label_washing:read" },
  { module: "label-broker", label: "Broker", table: "Broker_h", no: "NoBroker", date: "DateCreate", usage: false, perm: "label_broker:read" },
  { module: "label-mixer", label: "Mixer", table: "Mixer_h", no: "NoMixer", date: "DateCreate", usage: false, perm: "label_mixer:read" },
  { module: "label-crusher", label: "Crusher", table: "Crusher", no: "NoCrusher", date: "DateCreate", usage: true, perm: "label_crusher:read" },
  { module: "label-gilingan", label: "Gilingan", table: "Gilingan", no: "NoGilingan", date: "DateCreate", usage: true, perm: "label_gilingan:read" },
  { module: "label-bonggolan", label: "Bonggolan", table: "Bonggolan", no: "NoBonggolan", date: "DateCreate", usage: true, perm: "label_bonggolan:read" },
  { module: "label-furniture-wip", label: "Furniture WIP", table: "FurnitureWIP", no: "NoFurnitureWIP", date: "DateCreate", usage: true, perm: "label_furniturewip:read" },
  { module: "label-packing", label: "Barang Jadi", table: "BarangJadi", no: "NoBJ", date: "DateCreate", usage: true, perm: "label_barangjadi:read" },
  { module: "label-reject", label: "Reject", table: "RejectV2", no: "NoReject", date: "DateCreate", usage: true, perm: "label_reject:read" },
  { module: "label-barang-dagang", label: "Barang Dagang", table: "BarangDagang", no: "NoBarangDagang", date: "CreatedAt", usage: true, perm: "label_barangdagang:read" },
  { module: "label-bahan-pendukung", label: "Bahan Pendukung", table: "BahanPendukung", no: "NoBahanPendukung", date: "CreatedAt", usage: true, perm: "label_bahanpendukung:read" },
];

const SO_PERM = "stockopname:read";
const SPK_PERM = "datamasterplanning:read";

const can = (perms, p) => perms.has("*") || perms.has(p);

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

async function query(text, inputs) {
  const pool = await poolPromise;
  const r = pool.request();
  for (const [k, v] of Object.entries(inputs)) {
    r.input(k, sql.VarChar(100), v);
  }
  const res = await r.query(text);
  return res.recordset || [];
}

const byDateDesc = (a, b) =>
  String(b.date || "").localeCompare(String(a.date || "")) ||
  String(b.no).localeCompare(String(a.no));

/* ---------------- loader per antrian ---------------- */

async function loadProduksiPending({ username, perms, now }) {
  const depts = DEPTS.filter((d) => can(perms, d.perm));
  if (!depts.length) return [];
  const parts = depts.map(
    (d) => `
      SELECT '${d.module}' AS module, ${d.no} AS no,
        CONVERT(varchar(10), ${d.date}, 23) AS tgl, Shift,
        CONVERT(varchar(8), HourStart, 108) AS HourStart,
        CONVERT(varchar(8), HourEnd, 108) AS HourEnd, IsComplete
      FROM dbo.${d.table}
      WHERE CreateBy = @u AND ISNULL(IsComplete, 0) = 0`,
  );
  const rows = await query(parts.join(" UNION ALL "), { u: username });
  const label = Object.fromEntries(DEPTS.map((d) => [d.module, d.label]));
  return rows
    .filter(
      (r) =>
        deriveProduksiStatus(
          { TglProduksi: r.tgl, HourStart: r.HourStart, HourEnd: r.HourEnd, IsComplete: r.IsComplete },
          now,
        ) === "pending",
    )
    .map((r) => ({
      id: `${r.module}:${r.no}`,
      no: r.no,
      title: `Produksi ${label[r.module]}`,
      subtitle: `Shift ${r.Shift ?? "-"} · ${r.HourStart?.slice(0, 5) || "-"}–${r.HourEnd?.slice(0, 5) || "-"}`,
      date: r.tgl,
      module: r.module,
      meta: [
        { label: "Departemen", value: label[r.module] },
        { label: "Tanggal", value: r.tgl || "-" },
        { label: "Shift", value: r.Shift == null ? "-" : String(r.Shift) },
        { label: "Jam", value: `${r.HourStart || "-"} – ${r.HourEnd || "-"}` },
        { label: "Status", value: "Shift sudah lewat, belum diselesaikan" },
      ],
    }))
    .sort(byDateDesc);
}

async function loadLabelUnprinted({ username, perms, now }) {
  const sources = LABELS.filter((l) => can(perms, l.perm));
  if (!sources.length) return [];
  const parts = sources.map(
    (l) => `
      SELECT '${l.module}' AS module, ${l.no} AS no,
        CONVERT(varchar(10), ${l.date}, 23) AS tgl
      FROM dbo.${l.table}
      WHERE CreateBy = @u
        AND ISNULL(HasBeenPrinted, 0) = 0
        ${l.usage ? "AND DateUsage IS NULL" : ""}
        AND ${l.date} >= CAST(@since AS DATE)`,
  );
  const rows = await query(parts.join(" UNION ALL "), {
    u: username,
    since: ymd(addDays(now, -(LABEL_DAYS - 1))),
  });
  const label = Object.fromEntries(LABELS.map((l) => [l.module, l.label]));
  return rows
    .map((r) => ({
      id: `${r.module}:${r.no}`,
      no: r.no,
      title: `Label ${label[r.module]}`,
      subtitle: "Belum pernah dicetak",
      date: r.tgl,
      module: r.module,
      meta: [
        { label: "Jenis label", value: label[r.module] },
        { label: "Tanggal buat", value: r.tgl || "-" },
        { label: "Status", value: "Belum dicetak & belum terpakai" },
      ],
    }))
    .sort(byDateDesc);
}

async function loadStockOpname({ now }) {
  const rows = await query(
    `SELECT NoSO AS no, CONVERT(varchar(10), Tanggal, 23) AS tgl
     FROM dbo.StockOpname_h
     WHERE ISNULL(IsComplete, 0) = 0 AND Tanggal >= CAST(@since AS DATE)`,
    { since: ymd(addDays(now, -(SO_DAYS - 1))) },
  );
  return rows
    .map((r) => ({
      id: `stock-opname:${r.no}`,
      no: r.no,
      title: "Stock Opname",
      subtitle: "Belum selesai",
      date: r.tgl,
      module: "stock-opname",
      meta: [
        { label: "Tanggal", value: r.tgl || "-" },
        { label: "Status", value: "Sesi belum ditutup" },
      ],
    }))
    .sort(byDateDesc);
}

async function loadSpkOpen() {
  const rows = await query(
    `SELECT NoSPK AS no, CONVERT(varchar(10), Tanggal, 23) AS tgl, Keterangan
     FROM dbo.SPKBarangJadi_H
     WHERE Status = 'OPEN'`,
    {},
  );
  return rows
    .map((r) => ({
      id: `spk:${r.no}`,
      no: r.no,
      title: "SPK Produksi Barang Jadi",
      subtitle: r.Keterangan || "Status OPEN",
      date: r.tgl,
      module: "spk",
      meta: [
        { label: "Tanggal", value: r.tgl || "-" },
        { label: "Keterangan", value: r.Keterangan || "-" },
        { label: "Status", value: "OPEN" },
      ],
    }))
    .sort(byDateDesc);
}

const QUEUES = [
  {
    key: "produksi_pending",
    label: "Produksi Belum Diselesaikan",
    visible: (perms) => DEPTS.some((d) => can(perms, d.perm)),
    load: loadProduksiPending,
  },
  {
    key: "label_unprinted",
    label: "Label Belum Dicetak",
    visible: (perms) => LABELS.some((l) => can(perms, l.perm)),
    load: loadLabelUnprinted,
  },
  {
    key: "stock_opname",
    label: "Stock Opname Berjalan",
    visible: (perms) => can(perms, SO_PERM),
    load: loadStockOpname,
  },
  {
    key: "spk_open",
    label: "SPK Masih OPEN",
    visible: (perms) => can(perms, SPK_PERM),
    load: loadSpkOpen,
  },
];

function context({ username, permissions, now = new Date() }) {
  return { username: String(username || ""), perms: new Set(permissions || []), now };
}

/** Ringkasan semua antrian yang boleh dilihat; galat per antrian tidak menggagalkan yang lain. */
async function getSummary(args) {
  const ctx = context(args);
  const queues = await Promise.all(
    QUEUES.filter((q) => q.visible(ctx.perms)).map(async (q) => {
      try {
        const items = await q.load(ctx);
        return { key: q.key, label: q.label, count: items.length, error: null };
      } catch (err) {
        console.error(`Error my-work ${q.key}:`, err);
        return { key: q.key, label: q.label, count: null, error: "Data belum dapat dimuat." };
      }
    }),
  );
  return {
    generated_at: new Date().toISOString(),
    total: queues.reduce((s, q) => s + (q.count || 0), 0),
    queues,
  };
}

/**
 * Daftar item satu antrian. Mengembalikan null bila antrian tidak dikenal
 * atau tidak boleh dilihat (controller menjawab 404, tanpa membocorkan izin).
 */
async function getItems({ key, search, ...args }) {
  const ctx = context(args);
  const q = QUEUES.find((x) => x.key === key);
  if (!q || !q.visible(ctx.perms)) return null;
  const all = await q.load(ctx);
  const s = String(search || "").trim().toLowerCase();
  const filtered = s
    ? all.filter((i) =>
        [i.no, i.title, i.subtitle].some((v) => String(v || "").toLowerCase().includes(s)),
      )
    : all;
  return {
    key: q.key,
    label: q.label,
    total: filtered.length,
    items: filtered.slice(0, MAX_ITEMS),
  };
}

module.exports = { getSummary, getItems, QUEUES, DEPTS, LABELS, LABEL_DAYS, SO_DAYS };
