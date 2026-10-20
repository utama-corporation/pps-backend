// src/modules/laporan/barangjadi/barangjadi-service.js
const sql = require("mssql");
const { poolPromise } = require("../../../core/config/db");
const { badReq } = require("../../../core/utils/http-error");
const { getPdfBrowser, escapeHtml } = require("../laporan-service");

const TANPA_WAREHOUSE = "(Tanpa Warehouse)";
const KOLOM_NAMA = "NamaBJ";
const KOLOM_TOTAL = "Total";
// Tinggi baris dibuat tetap (1 baris = 16px) supaya jumlah baris per halaman
// PDF pasti, sehingga total per halaman akurat.
const ROWS_PER_PAGE = 24;

function parseDate(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badReq(`${label} wajib berformat YYYY-MM-DD`);
  }
  return raw;
}

/**
 * Laporan Stock Barang Jadi V2 (crosstab).
 * Sumber : SP_LapStokBarangJadiV2(@TglAkhir, @Warehouse)
 * Baris  : NamaBJ
 * Kolom  : NamaWarehouse
 * Nilai  : SUM(Pcs), ditambah kolom Total dan baris TOTAL.
 */
async function getStokBarangJadiV2Crosstab({ tglAkhir, warehouse }) {
  const tanggal = parseDate(tglAkhir, "Tanggal akhir");
  const wh = String(warehouse ?? "ALL").trim() || "ALL";

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("TglAkhir", sql.Date, tanggal)
    .input("Warehouse", sql.VarChar(100), wh)
    .execute("dbo.SP_LapStokBarangJadiV2");

  const recordset = result.recordset || [];

  const warehouses = new Set();
  const perBarang = new Map(); // NamaBJ -> Map<warehouse, pcs>

  for (const r of recordset) {
    const nama = String(r.NamaBJ ?? "").trim() || "-";
    const gudang = String(r.NamaWarehouse ?? "").trim() || TANPA_WAREHOUSE;
    const pcs = Number(r.Pcs) || 0;

    warehouses.add(gudang);
    if (!perBarang.has(nama)) perBarang.set(nama, new Map());
    const cells = perBarang.get(nama);
    cells.set(gudang, (cells.get(gudang) || 0) + pcs);
  }

  // Warehouse berurutan abjad; "(Tanpa Warehouse)" selalu di paling kanan.
  const gudangList = [...warehouses].sort((a, b) => {
    if (a === TANPA_WAREHOUSE) return 1;
    if (b === TANPA_WAREHOUSE) return -1;
    return a.localeCompare(b, "id");
  });

  const columns = [
    { key: KOLOM_NAMA, label: "Nama Barang Jadi" },
    ...gudangList.map((g) => ({ key: g, label: g })),
    { key: KOLOM_TOTAL, label: "Total Pcs" },
  ];

  const grand = { [KOLOM_NAMA]: "TOTAL", [KOLOM_TOTAL]: 0 };
  for (const g of gudangList) grand[g] = 0;

  const rows = [...perBarang.keys()]
    .sort((a, b) => a.localeCompare(b, "id"))
    .map((nama) => {
      const cells = perBarang.get(nama);
      const row = { [KOLOM_NAMA]: nama };
      let total = 0;
      for (const g of gudangList) {
        const v = cells.get(g) || 0;
        row[g] = v;
        total += v;
        grand[g] += v;
      }
      row[KOLOM_TOTAL] = total;
      grand[KOLOM_TOTAL] += total;
      return row;
    });

  if (rows.length > 0) rows.push(grand);

  return { columns, rows, totalRows: rows.length };
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatDateId(value) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function buildStokBarangJadiV2Html({ tglAkhir, columns, rows }) {
  const gudangCols = columns.slice(1, -1);
  const fmtCell = (v) => (Number(v) ? formatNumber(v) : "-");
  const dataRows = rows.filter((r) => r[KOLOM_NAMA] !== "TOTAL");
  const grand = rows.find((r) => r[KOLOM_NAMA] === "TOTAL");

  const pageHeader = `<div class="report-header">
      <div>
        <div class="report-title">Stock Barang Jadi V2</div>
        <div class="report-subtitle">
          Posisi stok per tanggal: ${escapeHtml(formatDateId(tglAkhir))} &middot; Satuan: Pcs
        </div>
      </div>
      <div class="report-meta">Jumlah barang: ${dataRows.length}</div>
    </div>`;

  const head = columns
    .map((c, i) =>
      i === 0
        ? `<th class="left">${escapeHtml(c.label)}</th>`
        : `<th class="right">${escapeHtml(c.label)}</th>`,
    )
    .join("");

  const colgroup = `<colgroup>
      <col style="width:30px" />
      <col />
      ${gudangCols.map(() => '<col style="width:92px" />').join("")}
      <col style="width:92px" />
    </colgroup>`;

  const totalRow = (label, sumRow, cls) => `<tr class="${cls}">
        <td colspan="2" class="center">${label}</td>
        ${gudangCols.map((g) => `<td class="right">${formatNumber(sumRow[g.key])}</td>`).join("")}
        <td class="right">${formatNumber(sumRow[KOLOM_TOTAL])}</td>
      </tr>`;

  // Baris dibagi per ROWS_PER_PAGE (tinggi baris tetap),
  // tiap halaman punya tabel sendiri beserta baris total halaman.
  const pages = [];
  for (let i = 0; i < dataRows.length; i += ROWS_PER_PAGE) {
    pages.push(dataRows.slice(i, i + ROWS_PER_PAGE));
  }

  const pagesHtml = pages
    .map((chunk, p) => {
      const body = chunk
        .map(
          (r, i) => `
        <tr>
          <td class="no">${p * ROWS_PER_PAGE + i + 1}</td>
          <td class="left name">${escapeHtml(r[KOLOM_NAMA])}</td>
          ${gudangCols.map((g) => `<td class="right">${fmtCell(r[g.key])}</td>`).join("")}
          <td class="right strong">${formatNumber(r[KOLOM_TOTAL])}</td>
        </tr>`,
        )
        .join("");
      const isLast = p === pages.length - 1;
      return `<section class="page${isLast ? "" : " break"}">
    ${pageHeader}
    <table class="data">
      ${colgroup}
      <thead><tr><th class="center">No</th>${head}</tr></thead>
      <tbody>${body}</tbody>
      ${isLast && grand ? `<tfoot>${totalRow("TOTAL KESELURUHAN", grand, "grand")}</tfoot>` : ""}
    </table>
  </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; color: #1e293b; }
  .report-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 2px solid #1e40af; padding-bottom: 8px; margin-bottom: 12px;
  }
  .report-title { font-size: 16px; font-weight: 700; color: #1e40af; }
  .report-subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
  .report-meta { text-align: right; font-size: 9px; color: #475569; }
  .page.break { page-break-after: always; }
  table.data { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.data td, table.data th { height: 16px; line-height: 16px; white-space: nowrap; }
  td.name { overflow: hidden; text-overflow: ellipsis; }
  tr.grand td { background: #1e40af !important; color: #fff; font-weight: 700; }
  table.data th {
    background: #1e40af; color: #fff; font-size: 8px; text-transform: uppercase;
    letter-spacing: 0.3px; padding: 5px 6px; border: 1px solid #1e3a8a;
  }
  table.data td { padding: 3px 6px; border: 1px solid #e2e8f0; }
  table.data tr:nth-child(even) td { background: #f8fafc; }
  table.data tr { page-break-inside: avoid; }
  .no { width: 28px; text-align: center; color: #64748b; }
  .left { text-align: left; }
  .center { text-align: center; }
  .right { text-align: right; }
  .strong { font-weight: 700; background: #eef2ff !important; }
</style>
</head>
<body>${
    pagesHtml ||
    `<section class="page">${pageHeader}<p class="center">Tidak ada data.</p></section>`
  }</body>
</html>`;
}

async function getStokBarangJadiV2Pdf({ tglAkhir, warehouse, username }) {
  const tanggal = parseDate(tglAkhir, "Tanggal akhir");
  const who = String(username ?? "-").trim() || "-";
  const printedAt = new Date().toLocaleString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const data = await getStokBarangJadiV2Crosstab({ tglAkhir: tanggal, warehouse });
  const html = buildStokBarangJadiV2Html({
    tglAkhir: tanggal,
    columns: data.columns,
    rows: data.rows,
  });

  const browser = await getPdfBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1123, height: 794 });

  try {
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
    await page.evaluate((h) => {
      document.open();
      document.write(h);
      document.close();
    }, html);

    return await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width:100%; font-size:8px; color:#94a3b8; font-family:'Segoe UI',Arial,sans-serif; display:flex; justify-content:space-between; padding:0 8mm;">
          <span>Print by ${escapeHtml(who)} on ${escapeHtml(printedAt)}</span>
          <span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
        </div>`,
      margin: { top: "8mm", right: "8mm", bottom: "14mm", left: "8mm" },
    });
  } finally {
    await page.close();
  }
}

/**
 * Laporan Hasil Produksi Barang Jadi (crosstab per mesin).
 * Sumber : SP_LaporanHasilProduksi(@TglAwal, @TglAkhir) -> Tanggal, NamaMesin, NamaBJ, Pcs, Ket
 * Group  : NamaMesin (satu tabel per mesin, halaman baru per mesin)
 * Baris  : NamaBJ
 * Kolom  : Tanggal (format hari: 01..31)
 * Nilai  : SUM(Pcs), ditambah kolom Total dan baris TOTAL per mesin.
 */
const MAX_HARI = 31;

function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function enumerateDates(from, to) {
  const out = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end && out.length <= MAX_HARI) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function getHasilProduksiCrosstab({ tglAwal, tglAkhir }) {
  const start = parseDate(tglAwal, "Tanggal awal");
  const end = parseDate(tglAkhir, "Tanggal akhir");
  if (start > end) throw badReq("Tanggal awal tidak boleh melebihi tanggal akhir");

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("TglAwal", sql.Date, start)
    .input("TglAkhir", sql.Date, end)
    .execute("dbo.SP_LaporanHasilProduksi");

  const perMesin = new Map(); // NamaMesin -> Map<NamaBJ, Map<tanggal, pcs>>
  const tanggalAda = new Set();

  for (const r of result.recordset || []) {
    const tgl = isoDate(r.Tanggal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) continue;
    const mesin = String(r.NamaMesin ?? "").trim() || "(Tanpa Mesin)";
    const nama = String(r.NamaBJ ?? "").trim() || "-";
    const pcs = Number(r.Pcs) || 0;

    tanggalAda.add(tgl);
    if (!perMesin.has(mesin)) perMesin.set(mesin, new Map());
    const perBj = perMesin.get(mesin);
    if (!perBj.has(nama)) perBj.set(nama, new Map());
    const cells = perBj.get(nama);
    cells.set(tgl, (cells.get(tgl) || 0) + pcs);
  }

  const range = enumerateDates(start, end);
  const dates =
    range.length <= MAX_HARI ? range : [...tanggalAda].sort().slice(0, MAX_HARI);

  const groups = [...perMesin.keys()]
    .sort((a, b) => a.localeCompare(b, "id", { numeric: true }))
    .map((mesin) => {
      const perBj = perMesin.get(mesin);
      const totalHari = Object.fromEntries(dates.map((d) => [d, 0]));
      let grand = 0;
      const rows = [...perBj.keys()]
        .sort((a, b) => a.localeCompare(b, "id", { numeric: true }))
        .map((nama) => {
          const cells = perBj.get(nama);
          let total = 0;
          const hari = {};
          for (const d of dates) {
            const v = cells.get(d) || 0;
            hari[d] = v;
            total += v;
            totalHari[d] += v;
          }
          grand += total;
          return { nama, hari, total };
        });
      return { mesin, rows, totalHari, grand };
    });

  return { tglAwal: start, tglAkhir: end, dates, groups };
}

function buildHasilProduksiHtml({ tglAwal, tglAkhir, dates, groups }) {
  const fmtCell = (v) => (Number(v) ? formatNumber(v) : "");
  const periode = `${formatDateId(tglAwal)} s/d ${formatDateId(tglAkhir)}`;

  const colgroup = `<colgroup>
      <col style="width:210px" />
      ${dates.map(() => "<col />").join("")}
      <col style="width:64px" />
    </colgroup>`;

  const head = `<tr>
      <th class="left">Nama</th>
      ${dates.map((d) => `<th class="center">${d.slice(8, 10)}</th>`).join("")}
      <th class="right">Total</th>
    </tr>`;

  const sections = groups
    .map((g) => {
      const body = g.rows
        .map(
          (r) => `
        <tr>
          <td class="left name">${escapeHtml(r.nama)}</td>
          ${dates.map((d) => `<td class="right">${fmtCell(r.hari[d])}</td>`).join("")}
          <td class="right strong">${formatNumber(r.total)}</td>
        </tr>`,
        )
        .join("");
      const foot = `<tr class="grand">
        <td class="left">TOTAL</td>
        ${dates.map((d) => `<td class="right">${fmtCell(g.totalHari[d])}</td>`).join("")}
        <td class="right">${formatNumber(g.grand)}</td>
      </tr>`;
      // Mesin dengan baris sedikit tidak dipotong antar halaman; yang panjang boleh
      // berlanjut (header tabel diulang). Mesin berikutnya mengalir di halaman yang sama.
      return `<section class="mesin${g.rows.length <= 25 ? " keep" : ""}">
    <div class="mesin-title">${escapeHtml(g.mesin)}</div>
    <table class="data">
      ${colgroup}
      <thead>${head}</thead>
      <tbody>${body}</tbody>
      <tfoot>${foot}</tfoot>
    </table>
  </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8px; color: #1e293b; }
  .report-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 2px solid #1e40af; padding-bottom: 8px; margin-bottom: 10px;
  }
  .report-title { font-size: 16px; font-weight: 700; color: #1e40af; }
  .report-subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
  .report-meta { text-align: right; font-size: 14px; color: #1e293b; }
  .mesin { margin-bottom: 14px; }
  .mesin.keep { page-break-inside: avoid; }
  .mesin-title {
    font-size: 11px; font-weight: 700; color: #1e40af; padding: 3px 0;
    page-break-after: avoid;
  }
  table.data { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.data thead { display: table-header-group; }
  table.data tfoot { display: table-row-group; }
  table.data tr { page-break-inside: avoid; }
  table.data th {
    background: #1e40af; color: #fff; font-size: 8px; padding: 4px 2px;
    border: 1px solid #1e3a8a;
  }
  table.data td {
    padding: 2px 3px; border: 1px solid #e2e8f0; height: 15px; white-space: nowrap;
    font-size: 7.5px;
  }
  table.data tbody tr:nth-child(even) td { background: #f8fafc; }
  td.name { overflow: hidden; text-overflow: ellipsis; font-size: 8px; }
  tr.grand td { background: #1e40af !important; color: #fff; font-weight: 700; }
  .left { text-align: left; padding-left: 5px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .strong { font-weight: 700; background: #eef2ff !important; }
</style>
</head>
<body>
  <div class="report-header">
    <div>
      <div class="report-title">Hasil Produksi Barang Jadi</div>
      <div class="report-subtitle">Periode: ${escapeHtml(periode)} &middot; Satuan: Pcs</div>
    </div>
    <div class="report-meta">Jumlah mesin: ${groups.length}</div>
  </div>
  ${sections || '<p class="center">Tidak ada data.</p>'}
</body>
</html>`;
}

async function getHasilProduksiPdf({ tglAwal, tglAkhir, username }) {
  const who = String(username ?? "-").trim() || "-";
  const printedAt = new Date().toLocaleString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const data = await getHasilProduksiCrosstab({ tglAwal, tglAkhir });
  const html = buildHasilProduksiHtml(data);

  const browser = await getPdfBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1123, height: 794 });

  try {
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
    await page.evaluate((h) => {
      document.open();
      document.write(h);
      document.close();
    }, html);

    return await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width:100%; font-size:8px; color:#94a3b8; font-family:'Segoe UI',Arial,sans-serif; display:flex; justify-content:space-between; padding:0 8mm;">
          <span>Print by ${escapeHtml(who)} on ${escapeHtml(printedAt)}</span>
          <span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
        </div>`,
      margin: { top: "8mm", right: "8mm", bottom: "14mm", left: "8mm" },
    });
  } finally {
    await page.close();
  }
}

module.exports = {
  getStokBarangJadiV2Crosstab,
  getStokBarangJadiV2Pdf,
  getHasilProduksiCrosstab,
  getHasilProduksiPdf,
};
