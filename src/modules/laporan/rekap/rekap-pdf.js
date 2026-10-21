// src/modules/laporan/rekap/rekap-pdf.js
// Builder + renderer PDF untuk Laporan Rekap Produksi.
// Semua SP rekap produksi (washing, broker, crusher, gilingan, mixer, inject,
// packing, hot-stamping, pasang-kunci, spanner) punya struktur hasil yang sama:
// DimType, ItemCode, Jenis, Pcs, Berat, IdWarehouse.
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");

const REKAP_TITLE = {
  washing: "Rekap Produksi Washing",
  broker: "Rekap Produksi Broker",
  crusher: "Rekap Produksi Crusher",
  gilingan: "Rekap Produksi Gilingan",
  mixer: "Rekap Produksi Mixer",
  "inject-bj": "Rekap Produksi Inject Barang Jadi",
  "inject-fwip": "Rekap Produksi Inject FWIP",
  packing: "Rekap Produksi Packing Barang Jadi",
  "hot-stamping": "Rekap Produksi Hot Stamping FWIP",
  "pasang-kunci": "Rekap Produksi Pasang Kunci FWIP",
  spanner: "Rekap Produksi Spanner FWIP",
};

// Urutan tampilan kelompok DimType. Jenis lain (bukan Input/Output/Waste)
// diurutkan abjad dan ditaruh di akhir.
const URUTAN_TIPE = ["Input", "Output", "Waste"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateId(value) {
  if (!value) return "-";
  const raw = String(value).slice(0, 10);
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function getRekapTitle(jenis) {
  return REKAP_TITLE[jenis] || `Rekap Produksi ${jenis}`;
}

function normalizeTipe(value) {
  return String(value ?? "").trim();
}

function urutkanTipe(tipeList) {
  return [...tipeList].sort((a, b) => {
    const ia = URUTAN_TIPE.indexOf(a);
    const ib = URUTAN_TIPE.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, "id");
  });
}

function groupRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const tipe = normalizeTipe(row.DimType) || "-";
    if (!map.has(tipe)) map.set(tipe, []);
    map.get(tipe).push(row);
  }
  return urutkanTipe([...map.keys()]).map((tipe) => ({
    tipe,
    rows: map.get(tipe),
  }));
}

function sumBy(rows, key) {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}

function buildRekapHtml({ jenis, tglAkhir, rows }) {
  const data = Array.isArray(rows) ? rows : [];
  const groups = groupRows(data);

  const inputRows = data.filter((r) => normalizeTipe(r.DimType) === "Input");
  const outputRows = data.filter((r) => normalizeTipe(r.DimType) === "Output");
  const wasteRows = data.filter((r) => normalizeTipe(r.DimType) === "Waste");

  const totalPcs = sumBy(data, "Pcs");
  const totalBerat = sumBy(data, "Berat");

  const body = groups
    .map((group) => {
      const subtotalPcs = sumBy(group.rows, "Pcs");
      const subtotalBerat = sumBy(group.rows, "Berat");

      const detail = group.rows
        .map(
          (r) => `<tr>
            <td class="left">${escapeHtml(r.ItemCode ?? "-")}</td>
            <td class="left name">${escapeHtml(r.Jenis ?? "-")}</td>
            <td class="right">${formatNumber(r.Pcs, 0)}</td>
            <td class="right">${formatNumber(r.Berat, 2)}</td>
            <td class="center">${escapeHtml(r.IdWarehouse ?? "-")}</td>
          </tr>`,
        )
        .join("");

      return `<tr class="group"><td colspan="5">${escapeHtml(group.tipe.toUpperCase())}</td></tr>
        ${detail}
        <tr class="subtotal">
          <td colspan="2">Subtotal ${escapeHtml(group.tipe)}</td>
          <td class="right">${formatNumber(subtotalPcs, 0)}</td>
          <td class="right">${formatNumber(subtotalBerat, 2)}</td>
          <td class="center"></td>
        </tr>`;
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
  .report-title { font-size: 15px; font-weight: 700; color: #1e40af; }
  .report-subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
  .report-meta { text-align: right; font-size: 9px; color: #475569; }
  .summary-strip { display: flex; gap: 8px; margin-bottom: 10px; }
  .summary-card { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; }
  .summary-label { font-size: 8px; color: #64748b; text-transform: uppercase; }
  .summary-value { font-size: 13px; font-weight: 700; color: #1e40af; }
  table.data { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.data th {
    background: #1e40af; color: #fff; font-size: 8px; text-transform: uppercase;
    letter-spacing: 0.3px; padding: 5px 6px; border: 1px solid #1e3a8a;
  }
  table.data td { padding: 4px 6px; border: 1px solid #e2e8f0; }
  table.data tr { page-break-inside: avoid; }
  table.data tbody tr:nth-child(even) td { background: #f8fafc; }
  tr.group td {
    background: #e0e7ff !important; color: #1e3a8a; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.3px; font-size: 8px;
  }
  tr.subtotal td { background: #eef2ff !important; font-weight: 700; }
  tfoot td {
    background: #1e40af !important; color: #fff; font-weight: 700; font-size: 9px;
  }
  td.name { word-break: break-word; }
  .left { text-align: left; }
  .center { text-align: center; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { text-align: center; padding: 18px 0; color: #94a3b8; }
</style>
</head>
<body>
  <div class="report-header">
    <div>
      <div class="report-title">Laporan ${escapeHtml(getRekapTitle(jenis))}</div>
      <div class="report-subtitle">Posisi rekap per tanggal: ${escapeHtml(formatDateId(tglAkhir))}</div>
    </div>
    <div class="report-meta">Jumlah baris: ${data.length}</div>
  </div>

  <div class="summary-strip">
    <div class="summary-card">
      <div class="summary-label">Input (Pcs)</div>
      <div class="summary-value">${formatNumber(sumBy(inputRows, "Pcs"), 0)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Output (Pcs)</div>
      <div class="summary-value">${formatNumber(sumBy(outputRows, "Pcs"), 0)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Waste (Kg)</div>
      <div class="summary-value">${formatNumber(sumBy(wasteRows, "Berat"), 2)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Pcs</div>
      <div class="summary-value">${formatNumber(totalPcs, 0)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Berat (Kg)</div>
      <div class="summary-value">${formatNumber(totalBerat, 2)}</div>
    </div>
  </div>

  <table class="data">
    <colgroup>
      <col style="width:11%" />
      <col style="width:53%" />
      <col style="width:12%" />
      <col style="width:12%" />
      <col style="width:12%" />
    </colgroup>
    <thead>
      <tr>
        <th class="left">Kode Item</th>
        <th class="left">Nama Barang</th>
        <th class="right">Qty (Pcs)</th>
        <th class="right">Berat (Kg)</th>
        <th class="center">Warehouse</th>
      </tr>
    </thead>
    <tbody>${
      body ||
      '<tr><td colspan="5" class="empty">Tidak ada data.</td></tr>'
    }</tbody>
    <tfoot>
      <tr>
        <td colspan="2">TOTAL</td>
        <td class="right">${formatNumber(totalPcs, 0)}</td>
        <td class="right">${formatNumber(totalBerat, 2)}</td>
        <td class="center"></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}

async function renderRekapPdf({ html, username }) {
  const who = String(username ?? "-").trim() || "-";
  const printedAt = new Date().toLocaleString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1123, height: 794 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    return Buffer.from(
      await page.pdf({
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
      }),
    );
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildRekapHtml,
  renderRekapPdf,
  getRekapTitle,
  REKAP_TITLE,
};
