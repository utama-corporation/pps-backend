/* ============================================================
 * KPI & Ratio (Workspace & Analytics).
 *
 * Periode = bulan berjalan s.d. `tanggal` (MTD), sama dengan laporan
 * "Dashboard Produktifitas" resmi, supaya angkanya konsisten.
 *
 *  - washing : rendemen & waste dari SP_LapProduktivitasWashing (resmi)
 *  - broker  : rendemen & waste dari SP_LapProduktivitasBroker (resmi)
 *  - mixer   : rendemen dari sp_LapDashboardProduktifitas (INPUT/OUTPUT Mixer)
 *  - inject  : kg reject per 1.000 pcs hasil, per mesin. Berat label hasil
 *              inject tidak dicatat, jadi % reject berbasis kg tidak bisa
 *              dihitung (join sama dengan SP dashboard: output BJ + FWIP +
 *              RejectV2, mesin dari MstMesinInject).
 *
 * Tidak disertakan: downtime (tabel *_dDowntime kosong) dan gilingan
 * (input & output tidak seimbang di sumber datanya).
 * ==========================================================*/

const { sql, poolPromise } = require("../../core/config/db");

const CACHE_MS = 5 * 60 * 1000;

const KPI_PERMS = {
  washing: "produksi_washing:read",
  broker: "produksi_broker:read",
  mixer: "produksi_mixer:read",
  inject: "injectproduksi:read",
};
const REPORT_PERM = "laporan:read";

const can = (perms, kpi) =>
  perms.has("*") || perms.has(REPORT_PERM) || perms.has(KPI_PERMS[kpi]);

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
/** Persentase a/b; null bila pembagi nol (ditampilkan "-" di layar). */
const ratio = (a, b) => (b > 0 ? round((a / b) * 100) : null);

/** Batas MTD untuk `tanggal` (string YYYY-MM-DD atau Date). */
function period(tanggal) {
  const d = tanggal instanceof Date ? tanggal : new Date(`${tanggal}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  return { from: ymd(from), to: ymd(d) };
}

async function pool() {
  return poolPromise;
}

/* ---------------- loader per KPI ---------------- */

/** Kelompokkan baris per mesin lalu urutkan dari input terbesar. */
function perMesin(rows, pick) {
  const map = new Map();
  for (const r of rows) {
    const key = String(r.NamaMesin || "-").trim() || "-";
    const acc = map.get(key) || { mesin: key, input: 0, output: 0, waste: 0, docs: new Set() };
    const v = pick(r);
    acc.input += v.input;
    acc.output += v.output;
    acc.waste += v.waste;
    if (v.doc) acc.docs.add(v.doc);
    map.set(key, acc);
  }
  return [...map.values()]
    .filter((m) => m.input > 0 || m.output > 0)
    .map((m) => ({
      mesin: m.mesin,
      input: round(m.input),
      output: round(m.output),
      rendemen: ratio(m.output, m.input),
      waste: ratio(m.waste, m.input),
      // SP washing tidak mengembalikan NoProduksi -> null, bukan 0.
      dokumen: m.docs.size || null,
    }))
    .sort((a, b) => b.input - a.input);
}

function totals(rows) {
  const input = rows.reduce((s, r) => s + r.input, 0);
  const output = rows.reduce((s, r) => s + r.output, 0);
  return { input: round(input), output: round(output) };
}

async function loadWashing(p) {
  const res = await (await pool())
    .request()
    .input("StartDate", sql.Date, p.from)
    .input("EndDate", sql.Date, p.to)
    .execute("SP_LapProduktivitasWashing");
  const rows = perMesin(res.recordset || [], (r) => ({
    input: num(r.Inp),
    output: num(r.Outp),
    waste: num(r.Tenggelam),
  }));
  const t = totals(rows);
  const waste = (res.recordset || []).reduce((s, r) => s + num(r.Tenggelam), 0);
  return {
    key: "washing",
    label: "Washing",
    unit: "kg",
    metrics: [
      { key: "rendemen", label: "Rendemen", value: ratio(t.output, t.input), unit: "%", good: "high" },
      { key: "waste", label: "Waste", value: ratio(waste, t.input), unit: "%", good: "low" },
    ],
    input: t.input,
    output: t.output,
    rows,
  };
}

async function loadBroker(p) {
  const res = await (await pool())
    .request()
    .input("StartDate", sql.Date, p.from)
    .input("EndDate", sql.Date, p.to)
    .execute("SP_LapProduktivitasBroker");
  // Satu produksi bisa beberapa baris bahan; TotalBerat/OutP/Waste hanya
  // terisi di baris utama, sisanya 0, jadi aman dijumlah.
  const raw = res.recordset || [];
  const rows = perMesin(raw, (r) => ({
    input: num(r.TotalBerat),
    output: num(r.OutP),
    waste: num(r.Waste),
    doc: r.NoProduksi,
  }));
  const t = totals(rows);
  const waste = raw.reduce((s, r) => s + num(r.Waste), 0);
  return {
    key: "broker",
    label: "Broker",
    unit: "kg",
    metrics: [
      { key: "rendemen", label: "Rendemen", value: ratio(t.output, t.input), unit: "%", good: "high" },
      { key: "waste", label: "Waste", value: ratio(waste, t.input), unit: "%", good: "low" },
    ],
    input: t.input,
    output: t.output,
    rows,
  };
}

async function loadMixer(p) {
  const res = await (await pool())
    .request()
    .input("Tanggal", sql.Date, p.to)
    .execute("sp_LapDashboardProduktifitas");
  const raw = res.recordset || [];
  const sumOf = (tipe, grup) =>
    raw
      .filter((r) => String(r.tipe).toUpperCase() === tipe && r.Grup === grup)
      .reduce((s, r) => s + num(r.Total), 0);
  const input = sumOf("INPUT", "Mixer");
  const output = sumOf("OUTPUT", "Mixer");
  const rows = raw
    .filter((r) => r.Grup === "Hasil Mixer")
    .reduce((m, r) => m.set(r.tipe, (m.get(r.tipe) || 0) + num(r.Total)), new Map());
  return {
    key: "mixer",
    label: "Mixer",
    unit: "kg",
    metrics: [
      { key: "rendemen", label: "Rendemen", value: ratio(output, input), unit: "%", good: "high" },
    ],
    input: round(input),
    output: round(output),
    rows: [...rows.entries()]
      .filter(([, v]) => v > 0)
      .map(([mesin, v]) => ({ mesin, input: null, output: round(v), rendemen: null, waste: null, dokumen: null }))
      .sort((a, b) => b.output - a.output),
  };
}

async function loadInject(p) {
  const res = await (await pool())
    .request()
    .input("from", sql.Date, p.from)
    .input("to", sql.Date, p.to)
    .query(`
      SELECT D.NamaMesin,
        SUM(CASE WHEN X.k = 'hasil' THEN X.Berat ELSE 0 END) AS Hasil,
        SUM(CASE WHEN X.k = 'hasil' THEN X.Pcs ELSE 0 END) AS Pcs,
        SUM(CASE WHEN X.k = 'reject' THEN X.Berat ELSE 0 END) AS Reject,
        COUNT(DISTINCT X.NoProduksi) AS Docs
      FROM (
        SELECT A.NoProduksi, 'hasil' AS k, C.Berat, C.Pcs
        FROM dbo.InjectProduksiOutputBarangJadi A
        JOIN dbo.BarangJadi C ON C.NoBJ = A.NoBJ
        UNION ALL
        SELECT A.NoProduksi, 'hasil', C.Berat, C.Pcs
        FROM dbo.InjectProduksiOutputFurnitureWIP A
        JOIN dbo.FurnitureWIP C ON C.NoFurnitureWIP = A.NoFurnitureWIP
        UNION ALL
        SELECT A.NoProduksi, 'reject', C.Berat, 0
        FROM dbo.InjectProduksiOutputRejectV2 A
        JOIN dbo.RejectV2 C ON C.NoReject = A.NoReject
      ) X
      JOIN dbo.InjectProduksi_h B ON B.NoProduksi = X.NoProduksi
      JOIN dbo.MstMesinInject D ON D.IdMesin = B.IdMesin
      WHERE B.TglProduksi >= @from AND B.TglProduksi <= @to
      GROUP BY D.NamaMesin`);
  // Berat label hasil inject (BJ/FWIP) tidak dicatat (selalu 0), jadi %
  // reject berbasis kg tidak bisa dihitung. Rasio yang dipakai: kg reject
  // per 1.000 pcs hasil — satuan campuran seperti SP dashboard resmi.
  const per1000 = (kg, pcs) => (pcs > 0 ? round((kg / pcs) * 1000) : null);
  const raw = res.recordset || [];
  const rows = raw
    .map((r) => {
      const pcs = Math.round(num(r.Pcs));
      const reject = num(r.Reject);
      return {
        mesin: String(r.NamaMesin || "-").trim(),
        pcs,
        reject: round(reject),
        rejectPer1000: per1000(reject, pcs),
        dokumen: num(r.Docs),
      };
    })
    .filter((r) => r.pcs > 0 || r.reject > 0)
    // Terburuk di atas; mesin tanpa hasil (rasio null) paling bawah.
    .sort((a, b) => (b.rejectPer1000 ?? -1) - (a.rejectPer1000 ?? -1));
  const pcs = rows.reduce((s, r) => s + r.pcs, 0);
  const reject = rows.reduce((s, r) => s + r.reject, 0);
  return {
    key: "inject",
    label: "Inject",
    unit: "pcs",
    metrics: [
      { key: "reject_per_1000", label: "Reject per 1.000 pcs", value: per1000(reject, pcs), unit: "kg", good: "low" },
      { key: "pcs", label: "Hasil", value: pcs, unit: "pcs", good: "high" },
      { key: "reject", label: "Total reject", value: round(reject), unit: "kg", good: "low" },
    ],
    input: null,
    output: pcs,
    rows,
  };
}

const LOADERS = { washing: loadWashing, broker: loadBroker, mixer: loadMixer, inject: loadInject };

/* ---------------- cache ---------------- */

const cache = new Map();
function cached(key, p, now = Date.now()) {
  const id = `${key}:${p.from}:${p.to}`;
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return hit.promise;
  const promise = LOADERS[key](p);
  cache.set(id, { at: now, promise });
  promise.catch(() => cache.delete(id));
  return promise;
}
function clearCache() {
  cache.clear();
}

/**
 * KPI bulan berjalan s.d. `tanggal` untuk KPI yang boleh dilihat. Galat per
 * KPI tidak menggagalkan yang lain. Mengembalikan null bila tanggal tidak valid.
 */
async function getKpi({ tanggal, permissions }) {
  const p = period(tanggal);
  if (!p) return null;
  const perms = new Set(permissions || []);
  const keys = Object.keys(LOADERS).filter((k) => can(perms, k));
  const kpis = await Promise.all(
    keys.map(async (k) => {
      try {
        return await cached(k, p);
      } catch (err) {
        console.error(`Error kpi ${k}:`, err);
        return { key: k, label: k, error: "Data belum dapat dimuat.", metrics: [], rows: [] };
      }
    }),
  );
  return { from: p.from, to: p.to, generated_at: new Date().toISOString(), kpis };
}

module.exports = { getKpi, period, ratio, clearCache, KPI_PERMS };
