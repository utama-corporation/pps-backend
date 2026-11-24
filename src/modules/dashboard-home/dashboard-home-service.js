/* ============================================================
 * Dashboard utama tablet PPS (analytics), pola sama dengan WPS:
 * kartu domain dengan angka utama + delta terhadap periode sebelumnya,
 * tren harian, dan aktivitas hari ini. Semua dihitung di server dan
 * di-cache singkat.
 *
 * Periode = `range` hari terakhir s.d. KEMARIN (hari lengkap), periode
 * pembanding = `range` hari sebelum itu. Angka "hari ini" hanya pelengkap.
 * Angka keadaan (mesin) tidak diberi delta.
 *
 * Cache per (domain, range) karena isinya sama untuk semua pengguna; izin
 * disaring saat menyusun respons, jadi data tanpa izin tidak pernah dikirim.
 * ==========================================================*/

const { sql, poolPromise } = require("../../core/config/db");
const masterMesin = require("../master-mesin/master-mesin-service");

const RANGES = [7, 14, 30, 90];
const CACHE_MS = 3 * 60 * 1000;

const DEPTS = [
  { key: "washing", label: "Washing", table: "WashingProduksi_h", date: "TglProduksi", perm: "produksi_washing:read", mesin: "getWashingByNoProduksi" },
  { key: "broker", label: "Broker", table: "BrokerProduksi_h", date: "TglProduksi", perm: "produksi_broker:read", mesin: "getBrokerByNoProduksi" },
  { key: "crusher", label: "Crusher", table: "CrusherProduksi_h", date: "Tanggal", perm: "produksi_crusher:read", mesin: "getCrusherByNoProduksi" },
  { key: "mixer", label: "Mixer", table: "MixerProduksi_h", date: "TglProduksi", perm: "produksi_mixer:read", mesin: "getMixerByNoProduksi" },
  { key: "inject", label: "Inject", table: "InjectProduksi_h", date: "TglProduksi", perm: "injectproduksi:read", mesin: "getInjectByNoProduksi" },
  { key: "gilingan", label: "Gilingan", table: "GilinganProduksi_h", date: "Tanggal", perm: "produksi_gilingan:read", mesin: "getGilinganByNoProduksi" },
  { key: "hotstamping", label: "Stamping", table: "HotStamping_h", date: "Tanggal", perm: "hotstamping:read", mesin: "getStampingByNoProduksi" },
  { key: "pasangkunci", label: "Pasang Kunci", table: "PasangKunci_h", date: "Tanggal", perm: "pasangkunci:read", mesin: "getPasangKunciByNoProduksi" },
  { key: "spanner", label: "Spanner", table: "Spanner_h", date: "Tanggal", perm: "spanner:read", mesin: "getSpannerByNoProduksi" },
  { key: "packing", label: "Packing", table: "PackingProduksi_h", date: "Tanggal", perm: "packing:read", mesin: "getPackingByNoProduksi" },
];

const can = (perms, ...any) =>
  perms.has("*") || any.some((p) => perms.has(p));
const statusActive = (s) =>
  ["active", "current", "aktif"].includes(String(s || "").toLowerCase());
const statusPending = (s) => String(s || "").toLowerCase() === "pending";

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Batas periode berjalan dan pembanding untuk `range` hari s.d. kemarin. */
function periods(range, today = new Date()) {
  const to = addDays(today, -1);
  const from = addDays(to, -(range - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(range - 1));
  return {
    today: ymd(today),
    from: ymd(from),
    to: ymd(to),
    prevFrom: ymd(prevFrom),
    prevTo: ymd(prevTo),
  };
}

/** Persen perubahan; null bila pembanding nol/kosong. */
function pct(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!p) return null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

const delta = (value, unit) =>
  value === null || value === undefined
    ? null
    : { value, unit, direction: value > 0 ? "up" : value < 0 ? "down" : "flat" };

const round = (v, n = 2) => {
  const f = 10 ** n;
  return Math.round((Number(v) || 0) * f) / f;
};

/* ---------------- sumber data mentah (di-cache) ---------------- */

const request1 = (params) => {
  const p = poolPromise.then((pool) => {
    const r = pool.request();
    for (const [k, v] of Object.entries(params)) {
      r.input(k, sql.VarChar(10), v);
    }
    return r;
  });
  return p;
};

/** Jumlah dokumen produksi per departemen: periode, pembanding, dan hari ini. */
async function produksiCounts(p) {
  const r = await request1({ f: p.from, t: p.to, pf: p.prevFrom, pt: p.prevTo, d: p.today });
  const parts = DEPTS.map(
    (x) => `
      SELECT '${x.key}' AS k,
        SUM(CASE WHEN CONVERT(date, ${x.date}) BETWEEN CAST(@f AS DATE) AND CAST(@t AS DATE) THEN 1 ELSE 0 END) AS cur,
        SUM(CASE WHEN CONVERT(date, ${x.date}) BETWEEN CAST(@pf AS DATE) AND CAST(@pt AS DATE) THEN 1 ELSE 0 END) AS prev,
        SUM(CASE WHEN CONVERT(date, ${x.date}) = CAST(@d AS DATE) THEN 1 ELSE 0 END) AS today
      FROM dbo.${x.table}
      WHERE CONVERT(date, ${x.date}) BETWEEN CAST(@pf AS DATE) AND CAST(@d AS DATE)`,
  );
  const res = await r.query(parts.join(" UNION ALL "));
  const out = {};
  for (const row of res.recordset) {
    out[row.k] = {
      cur: Number(row.cur) || 0,
      prev: Number(row.prev) || 0,
      today: Number(row.today) || 0,
    };
  }
  return out;
}

/** Jumlah dokumen penjualan (BJ) selesai: periode, pembanding, dan hari ini. */
async function penjualanCounts(p) {
  const r = await request1({ f: p.from, t: p.to, pf: p.prevFrom, pt: p.prevTo, d: p.today });
  const res = await r.query(`
    SELECT
      SUM(CASE WHEN CONVERT(date, Tanggal) BETWEEN CAST(@f AS DATE) AND CAST(@t AS DATE) THEN 1 ELSE 0 END) AS cur,
      SUM(CASE WHEN CONVERT(date, Tanggal) BETWEEN CAST(@pf AS DATE) AND CAST(@pt AS DATE) THEN 1 ELSE 0 END) AS prev,
      SUM(CASE WHEN CONVERT(date, Tanggal) = CAST(@d AS DATE) THEN 1 ELSE 0 END) AS today
    FROM dbo.BJJual_h
    WHERE IsComplete = 1
      AND CONVERT(date, Tanggal) BETWEEN CAST(@pf AS DATE) AND CAST(@d AS DATE)`);
  const row = res.recordset[0] || {};
  return {
    cur: Number(row.cur) || 0,
    prev: Number(row.prev) || 0,
    today: Number(row.today) || 0,
  };
}

/** Tren harian: dokumen produksi (departemen berizin) dan penjualan selesai. */
async function trend(p, allowed) {
  const depts = allowed && allowed.length ? allowed : [];
  const prodParts = depts.map(
    (x) => `SELECT '${x.key}' AS kode, CONVERT(date, ${x.date}) AS Tgl FROM dbo.${x.table}`,
  );
  const prodUnion = prodParts.length
    ? `SELECT CONVERT(date, Tgl) AS Tgl, COUNT(1) AS docs FROM (${prodParts.join(" UNION ALL ")}) X
       WHERE Tgl BETWEEN CAST(@f AS DATE) AND CAST(@t AS DATE) GROUP BY CONVERT(date, Tgl)`
    : `SELECT CAST(NULL AS DATE) AS Tgl, 0 AS docs WHERE 1 = 0`;
  const r = await request1({ f: p.from, t: p.to });
  const res = await r.query(`
    DECLARE @from DATE = CAST(@f AS DATE);
    DECLARE @to DATE = CAST(@t AS DATE);
    WITH Hari AS (
      SELECT @from AS Tgl UNION ALL SELECT DATEADD(DAY, 1, Tgl) FROM Hari WHERE Tgl < @to
    ),
    BJ AS (
      SELECT CONVERT(date, Tanggal) AS Tgl, COUNT(1) AS docs
      FROM dbo.BJJual_h
      WHERE IsComplete = 1 AND CONVERT(date, Tanggal) BETWEEN @from AND @to
      GROUP BY CONVERT(date, Tanggal)
    ),
    PRD AS (${prodUnion})
    SELECT CONVERT(varchar(10), Hari.Tgl, 23) AS date,
           ISNULL(PRD.docs, 0) AS produksi, ISNULL(BJ.docs, 0) AS penjualan
    FROM Hari
    LEFT JOIN PRD ON PRD.Tgl = Hari.Tgl
    LEFT JOIN BJ ON BJ.Tgl = Hari.Tgl
    ORDER BY Hari.Tgl
    OPTION (MAXRECURSION 400)
  `);
  return res.recordset.map((x) => ({
    date: x.date,
    produksi: Number(x.produksi) || 0,
    penjualan: Number(x.penjualan) || 0,
  }));
}

/** Jumlah transaksi Bongkar Susun hari ini. */
async function bongkarSusunToday(p) {
  const r = await request1({ d: p.today });
  const res = await r.query(`
    SELECT COUNT(1) AS cnt FROM dbo.BongkarSusun_h
    WHERE CONVERT(date, Tanggal) = CAST(@d AS DATE)`);
  return Number(res.recordset[0]?.cnt) || 0;
}

/** Jumlah transaksi Sortir Reject hari ini. */
async function sortirRejectToday(p) {
  const r = await request1({ d: p.today });
  const res = await r.query(`
    SELECT COUNT(1) AS cnt FROM dbo.BJSortirReject_h
    WHERE CONVERT(date, TglBJSortir) = CAST(@d AS DATE)`);
  return Number(res.recordset[0]?.cnt) || 0;
}

/** Jumlah mesin aktif & pending per departemen. */
async function mesinCounts() {
  let any = false;
  let total = 0, active = 0, pending = 0;
  await Promise.all(
    DEPTS.map(async (d) => {
      const fn = masterMesin[d.mesin];
      if (typeof fn !== "function") return;
      try {
        const rows = await fn({});
        any = true;
        for (const row of rows || []) {
          const s = row.MachineStatus ?? row.machineStatus;
          total += 1;
          if (statusActive(s)) active += 1;
          else if (statusPending(s)) pending += 1;
        }
      } catch (err) {
        console.error(`Error dashboard home mesin ${d.key}:`, err);
      }
    }),
  );
  return any ? { active, pending, idle: Math.max(0, total - active - pending) } : null;
}

const SOURCES = {
  produksi: produksiCounts,
  penjualan: penjualanCounts,
  trend,
  bongkarSusun: bongkarSusunToday,
  sortirReject: sortirRejectToday,
  mesin: mesinCounts,
};

/* ---------------- cache ---------------- */

const cache = new Map();

function cached(name, range, p, extra, now = Date.now()) {
  const key = `${name}:${range}:${p.today}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.promise;
  const promise = SOURCES[name](p, extra);
  cache.set(key, { at: now, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

function clearCache() {
  cache.clear();
}

/** Jalankan satu sumber; galat menjadi null + dicatat. */
async function safe(name, range, p, extra) {
  try {
    return { data: await cached(name, range, p, extra) };
  } catch (err) {
    console.error(`Error dashboard home ${name}:`, err);
    return { data: null, error: "Data belum dapat dimuat." };
  }
}

/* ---------------- penyusun respons ---------------- */

function produksiDomain(perms, raw) {
  const allowed = DEPTS.filter((d) => can(perms, d.perm));
  if (!allowed.length) return null;
  if (!raw.data) return { key: "produksi", label: "Produksi", error: raw.error, detail: "produksi" };
  const sum = (f) => allowed.reduce((s, x) => s + (raw.data[x.key]?.[f] || 0), 0);
  const cur = sum("cur");
  const prev = sum("prev");
  return {
    key: "produksi",
    label: "Produksi",
    primary: { label: "Dokumen produksi", value: cur, unit: "dokumen" },
    delta: delta(pct(cur, prev), "pct"),
    secondary: [
      { label: "Hari ini", value: sum("today"), unit: "dokumen" },
      {
        label: allowed.map((x) => x.label).join(" · "),
        value: allowed.map((x) => raw.data[x.key]?.cur || 0).join(" · "),
        unit: "",
      },
    ],
    detail: "produksi",
    depts: allowed.map((x) => ({
      key: x.key,
      label: x.label,
      value: raw.data[x.key]?.cur || 0,
      today: raw.data[x.key]?.today || 0,
    })),
  };
}

function penjualanDomain(perms, raw) {
  if (!can(perms, "penjualan:read")) return null;
  if (!raw.data) return { key: "penjualan", label: "Penjualan", error: raw.error, detail: "penjualan" };
  return {
    key: "penjualan",
    label: "Penjualan",
    primary: { label: "Dokumen BJ dikirim", value: raw.data.cur, unit: "dokumen" },
    delta: delta(pct(raw.data.cur, raw.data.prev), "pct"),
    secondary: [{ label: "Hari ini", value: raw.data.today, unit: "dokumen" }],
    detail: "penjualan",
  };
}

function mesinDomain(raw) {
  if (raw.data === null && raw.error) {
    return { key: "mesin", label: "Status Mesin", error: raw.error, detail: "mesin" };
  }
  if (!raw.data) return { key: "mesin", label: "Status Mesin", error: "Data belum dapat dimuat.", detail: "mesin" };
  return {
    key: "mesin",
    label: "Status Mesin",
    primary: { label: "Mesin aktif", value: raw.data.active, unit: "mesin" },
    delta: null,
    secondary: [
      { label: "Pending", value: raw.data.pending, unit: "mesin" },
      { label: "Idle", value: raw.data.idle ?? 0, unit: "mesin" },
    ],
    detail: "mesin",
  };
}

async function getHome({ permissions, range, today = new Date() }) {
  const perms = new Set(permissions || []);
  const p = periods(range, today);

  const canProduksi = DEPTS.some((d) => can(perms, d.perm));
  const canPenjualan = can(perms, "penjualan:read");
  const need = {
    produksi: canProduksi,
    penjualan: canPenjualan,
    trend: canProduksi || canPenjualan,
    bongkarSusun: true,
    sortirReject: true,
    mesin: true,
  };
  const allowed = DEPTS.filter((d) => can(perms, d.perm));

  const names = Object.keys(need).filter((n) => need[n]);
  const results = Object.fromEntries(
    await Promise.all(names.map(async (n) => [n, await safe(n, range, p, allowed)])),
  );

  const domains = [];
  if (need.produksi) {
    const d = produksiDomain(perms, results.produksi);
    if (d) domains.push(d);
  }
  if (need.penjualan) {
    const d = penjualanDomain(perms, results.penjualan);
    if (d) domains.push(d);
  }
  if (need.mesin) {
    domains.push(mesinDomain(results.mesin));
  }

  const activity = [];
  if (results.bongkarSusun) {
    activity.push({
      key: "bongkar_susun",
      label: "Bongkar Susun",
      value: results.bongkarSusun.data,
      error: results.bongkarSusun.error || null,
    });
  }
  if (results.sortirReject) {
    activity.push({
      key: "sortir_reject",
      label: "Sortir Reject",
      value: results.sortirReject.data,
      error: results.sortirReject.error || null,
    });
  }

  return {
    range_days: range,
    from: p.from,
    to: p.to,
    prev_from: p.prevFrom,
    prev_to: p.prevTo,
    generated_at: new Date().toISOString(),
    domains,
    trend: need.trend ? results.trend.data : null,
    trend_error: need.trend ? results.trend.error || null : null,
    activity,
  };
}

module.exports = { getHome, periods, pct, RANGES, clearCache };
