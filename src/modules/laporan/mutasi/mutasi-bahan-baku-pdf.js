// src/modules/laporan/mutasi/mutasi-bahan-baku-pdf.js
// PDF Laporan Mutasi Bahan Baku (format kolom bertingkat Masuk / Keluar).
// Sumber data: dbo.SP_PPSLapMutasiBahanBaku
//   Jenis, Awal, BSUOutput, MasukProd, Masuk, BrokerInputBahanBaku,
//   BSUInput, MixerInputBahanBaku, WashInput, Keluar, Akhir
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");

const MASUK_COLS = [
  { key: "BSUOutput", label: "BSU Output" },
  { key: "MasukProd", label: "Penerimaan BB" },
  { key: "Masuk", label: "Total Masuk", total: true },
];

const KELUAR_COLS = [
  { key: "BrokerInputBahanBaku", label: "Broker Input BB" },
  { key: "BSUInput", label: "BSU Input BB" },
  { key: "MixerInputBahanBaku", label: "Mixer Input BB" },
  { key: "WashInput", label: "Wash Input BB" },
  { key: "Keluar", label: "Total Keluar", total: true },
];

const VALUE_KEYS = [
  "Awal",
  ...MASUK_COLS.map((c) => c.key),
  ...KELUAR_COLS.map((c) => c.key),
  "Akhir",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 1.234,56 ; nilai 0 / kosong ditampilkan kosong.
function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "";
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateDMY(value) {
  const raw = String(value ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

function formatPrintedAt(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ${p(
    date.getHours(),
  )}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function sumBy(rows, key) {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}

function buildMutasiBahanBakuHtml({ tglAwal, tglAkhir, rows }) {
  const data = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) =>
      String(a.Jenis ?? "").localeCompare(String(b.Jenis ?? ""), "id", {
        sensitivity: "base",
      }),
    );

  const body = data
    .map(
      (r) => `<tr>
        <td class="name">${escapeHtml(r.Jenis ?? "")}</td>
        ${VALUE_KEYS.map((k) => `<td class="num${k === "Masuk" || k === "Keluar" ? " sub" : ""}">${formatQty(r[k])}</td>`).join("")}
      </tr>`,
    )
    .join("");

  const totalRow = `<tr class="grand">
      <td class="name">Total :</td>
      ${VALUE_KEYS.map((k) => `<td class="num">${formatQty(sumBy(data, k))}</td>`).join("")}
    </tr>`;

  const colCount = VALUE_KEYS.length + 1;
  const colgroup = `<colgroup><col style="width:17%"/>${VALUE_KEYS.map(() => `<col style="width:${(83 / VALUE_KEYS.length).toFixed(3)}%"/>`).join("")}</colgroup>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Segoe UI', sans-serif; font-size: 8px; color: #000; }
  .title { text-align: center; font-size: 14px; font-weight: 700; }
  .subtitle { text-align: center; font-size: 10px; margin: 2px 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th { font-weight: 700; font-size: 8px; padding: 3px 3px; border: 1px solid #000; text-align: center; vertical-align: middle; }
  td { padding: 2px 4px; border-left: 1px solid #000; border-right: 1px solid #000; white-space: nowrap; }
  /* tfoot kosong diulang Chrome di tiap halaman => garis penutup di setiap halaman */
  tfoot { display: table-footer-group; }
  tfoot td { border: none; border-top: 1px solid #000; padding: 0; height: 0; line-height: 0; font-size: 0; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f1f5f9; }
  tr.grand td { background: #e2e8f0 !important; }
  td.name { text-align: left; overflow: hidden; text-overflow: ellipsis; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.sub { font-weight: 700; }
  tr.grand td { font-weight: 700; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .empty { text-align: center; padding: 14px 0; }
</style>
</head>
<body>
  <div class="title">Laporan Mutasi Bahan Baku</div>
  <div class="subtitle">Dari ${escapeHtml(formatDateDMY(tglAwal))} Sampai ${escapeHtml(formatDateDMY(tglAkhir))}</div>
  <table>
    ${colgroup}
    <thead>
      <tr>
        <th rowspan="2">Jenis</th>
        <th rowspan="2">Awal</th>
        <th colspan="${MASUK_COLS.length}">Masuk</th>
        <th colspan="${KELUAR_COLS.length}">Keluar</th>
        <th rowspan="2">Akhir</th>
      </tr>
      <tr>
        ${[...MASUK_COLS, ...KELUAR_COLS].map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${body || `<tr><td colspan="${colCount}" class="empty">Tidak ada data.</td></tr>`}
      ${data.length ? totalRow : ""}
    </tbody>
    <tfoot><tr><td colspan="${colCount}"></td></tr></tfoot>
  </table>
</body>
</html>`;
}

async function renderMutasiBahanBakuPdf({ html, username }) {
  const who = String(username ?? "-").trim() || "-";
  const printedAt = formatPrintedAt();

  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    return Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `
          <div style="width:100%; font-size:8px; font-family:Arial,'Segoe UI',sans-serif; display:flex; justify-content:space-between; padding:0 8mm;">
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
  buildMutasiBahanBakuHtml,
  renderMutasiBahanBakuPdf,
};
