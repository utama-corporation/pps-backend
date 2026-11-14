// src/modules/laporan/produktivitas/produktivitas-washing-pdf.js
// PDF Laporan Produktivitas Washing (meniru produktivitaswashing.pdf versi Crystal Report).
// Sumber: SP_LapProduktivitasWashing -> Produksi, NamaMesin, Jenis, TglProduksi,
// Inp, Outp, Tenggelam, PersenHasil, PersenWaste, NmSupplier.
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Format Indonesia: 1.096,63
function fmt2(value) {
  return num(value).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(value) {
  return `${Math.round(num(value))}%`;
}

function fmtDateDMY(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

function formatPrintedAt(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

function buildProduktivitasWashingHtml({ tglAwal, tglAkhir, rows }) {
  const data = Array.isArray(rows) ? rows : [];

  const tot = data.reduce(
    (a, r) => ({
      inp: a.inp + num(r.Inp),
      out: a.out + num(r.Outp),
      teng: a.teng + num(r.Tenggelam),
    }),
    { inp: 0, out: 0, teng: 0 },
  );
  const pHasil = tot.inp ? (tot.out / tot.inp) * 100 : 0;
  const pWaste = tot.inp ? (tot.teng / tot.inp) * 100 : 0;

  const body = data
    .map(
      (r) => `<tr>
        <td class="c">${escapeHtml(r.Produksi ?? "")}</td>
        <td class="t">${escapeHtml(r.NamaMesin ?? "")}</td>
        <td class="t">${escapeHtml(r.Jenis ?? "")}</td>
        <td class="c">${escapeHtml(fmtDateDMY(r.TglProduksi))}</td>
        <td class="n">${fmt2(r.Inp)}</td>
        <td class="n">${fmt2(r.Outp)}</td>
        <td class="n">${fmt2(r.Tenggelam)}</td>
        <td class="c">${fmtPct(r.PersenHasil)}</td>
        <td class="c">${fmtPct(r.PersenWaste)}</td>
        <td class="t">${escapeHtml(r.NmSupplier ?? "")}</td>
      </tr>`,
    )
    .join("");

  const totalRow = data.length
    ? `<tr class="total">
        <td colspan="4" class="c">Total</td>
        <td class="n">${fmt2(tot.inp)}</td>
        <td class="n">${fmt2(tot.out)}</td>
        <td class="n">${fmt2(tot.teng)}</td>
        <td class="c">${fmtPct(pHasil)}</td>
        <td class="c">${fmtPct(pWaste)}</td>
        <td></td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 8pt; color: #000; }
  .title { text-align: center; font-size: 9.5pt; }
  .sub { text-align: center; font-size: 9.5pt; margin: 8px 0 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #000; }
  thead { display: table-header-group; }
  thead th { font-weight: 400; font-size: 8pt; padding: 7px 4px; text-align: center; border: 1px solid #000; }
  tbody td { padding: 5px 6px; vertical-align: middle; border-right: 1px solid #000; border-bottom: 1px solid #000; }
  tbody td:last-child { border-right: none; }
  tbody tr { break-inside: avoid; }
  td.c { text-align: center; white-space: nowrap; }
  td.n { text-align: right; white-space: nowrap; padding-right: 8px; font-variant-numeric: tabular-nums; }
  td.t { text-align: left; }
  tr.total td { font-weight: 700; border-bottom: 1px solid #000; }
  td.empty { text-align: center; padding: 18px 0; color: #666; }
</style>
</head>
<body>
  <div class="title">Laporan Produktivitas Washing</div>
  <div class="sub">Dari ${escapeHtml(fmtDateDMY(tglAwal))} Sampai ${escapeHtml(fmtDateDMY(tglAkhir))}</div>
  <table>
    <colgroup>
      <col style="width:5.5%" /><col style="width:12%" /><col style="width:20%" /><col style="width:8.5%" />
      <col style="width:8%" /><col style="width:8%" /><col style="width:8%" />
      <col style="width:6.5%" /><col style="width:6.5%" /><col style="width:16.5%" />
    </colgroup>
    <thead>
      <tr>
        <th>Produksi</th><th>Mesin</th><th>Bahan</th><th>Tanggal</th>
        <th>In</th><th>Out</th><th>Tenggelam</th>
        <th>% Hasil</th><th>% Waste</th><th>Supplier</th>
      </tr>
    </thead>
    <tbody>${body || '<tr><td colspan="10" class="empty">Tidak ada data.</td></tr>'}${totalRow}</tbody>
  </table>
</body>
</html>`;
}

async function renderProduktivitasWashingPdf({ html, username }) {
  const who = String(username ?? "-").trim() || "-";
  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `
          <div style="width:100%; font-size:7px; font-style:italic; font-family:Arial,sans-serif; display:flex; justify-content:space-between; padding:0 8mm;">
            <span>Print by ${escapeHtml(who)} on ${escapeHtml(formatPrintedAt())}</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
        margin: { top: "10mm", right: "8mm", bottom: "14mm", left: "8mm" },
      }),
    );
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildProduktivitasWashingHtml,
  renderProduktivitasWashingPdf,
};
