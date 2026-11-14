// src/modules/laporan/produktivitas/produktivitas-broker-pdf.js
// PDF Laporan Produktivitas Broker (meniru produktivitasbroker.pdf versi Crystal Report).
// Sumber: SP_LapProduktivitasBroker -> 1 baris per bahan, dikelompokkan per NoProduksi.
// Hasil/TotalBerat/OutP/Waste hanya terisi di baris pertama tiap produksi.
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

// Negatif ditulis (x) seperti di PDF contoh.
function fmtDec(value, digits = 2) {
  const n = num(value);
  const s = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const rounded = Number(Math.abs(n).toFixed(digits));
  return n < 0 && rounded !== 0 ? `(${s})` : s;
}

function fmtPct(part, total) {
  if (!total) return "0%";
  const p = Math.round((part / total) * 100);
  return p < 0 ? `(${Math.abs(p)}%)` : `${p}%`;
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

function groupByProduksi(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.NoProduksi ?? "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.values()].map((items) => {
    const head = items[0];
    const bahanTotal = items.reduce((s, r) => s + num(r.Berat), 0);
    const outP = items.reduce((m, r) => Math.max(m, num(r.OutP)), 0);
    const waste = items.reduce((m, r) => Math.max(m, num(r.Waste)), 0);
    const hasil = items.find((r) => r.Hasil)?.Hasil ?? "";
    return {
      items,
      tanggal: head.TglProduksi,
      mesin: head.NamaMesin,
      regu: head.NamaRegu,
      hasil,
      bahanTotal,
      outP,
      waste,
      susut: bahanTotal - outP - waste,
    };
  });
}

function buildProduktivitasBrokerHtml({ tglAwal, tglAkhir, rows }) {
  const groups = groupByProduksi(Array.isArray(rows) ? rows : []);

  const grand = groups.reduce(
    (a, g) => ({
      qty: a.qty + g.bahanTotal,
      outP: a.outP + g.outP,
      waste: a.waste + g.waste,
      susut: a.susut + g.susut,
    }),
    { qty: 0, outP: 0, waste: 0, susut: 0 },
  );

  const body = groups
    .map((g) => {
      const trs = g.items
        .map((r, i) => {
          const first = i === 0;
          // Date, Total, Hasil Produksi, dan Persentase digabung (rowspan) selama
          // satu produksi sehingga nilainya berada di tengah baris-baris bahannya.
          const span = ` rowspan="${g.items.length}"`;
          const merged = first
            ? {
                date: `<td class="c m"${span}>${escapeHtml(fmtDateDMY(g.tanggal))}</td>`,
                total: `<td class="n m"${span}>${fmtDec(g.bahanTotal)}</td>`,
                hasil: `<td class="t m"${span}>${escapeHtml(g.hasil)}</td>`,
                outP: `<td class="n m"${span}>${fmtDec(g.outP, 0)}</td>`,
                waste: `<td class="n m"${span}>${fmtDec(g.waste)}</td>`,
                susut: `<td class="n m"${span}>${fmtDec(g.susut)}</td>`,
                pHasil: `<td class="c m"${span}>${fmtPct(g.outP, g.bahanTotal)}</td>`,
                pSusut: `<td class="c m"${span}>${fmtPct(g.susut, g.bahanTotal)}</td>`,
              }
            : {};
          return `<tr${first ? ' class="first"' : ""}>
            ${merged.date ?? ""}
            <td class="c">${escapeHtml(r.NamaMesin ?? "")}</td>
            <td class="c">${escapeHtml(r.NamaRegu ?? "")}</td>
            <td class="t">${escapeHtml(r.Bahan ?? "")}</td>
            <td class="n">${fmtDec(r.Berat)}</td>
            ${merged.total ?? ""}
            ${merged.hasil ?? ""}
            ${merged.outP ?? ""}
            ${merged.waste ?? ""}
            ${merged.susut ?? ""}
            ${merged.pHasil ?? ""}
            ${merged.pSusut ?? ""}
          </tr>`;
        })
        .join("");
      return `<tbody class="grp">${trs}</tbody>`;
    })
    .join("");

  const empty =
    '<tbody><tr><td colspan="12" class="empty">Tidak ada data.</td></tr></tbody>';

  const totalRow = groups.length
    ? `<tbody class="grand"><tr>
        <td colspan="4" class="c b">Total</td>
        <td class="n b">${fmtDec(grand.qty)}</td>
        <td class="n b">${fmtDec(grand.qty)}</td>
        <td></td>
        <td class="n b">${fmtDec(grand.outP, 0)}</td>
        <td class="n b">${fmtDec(grand.waste)}</td>
        <td class="n b">${fmtDec(grand.susut)}</td>
        <td class="c b">${fmtPct(grand.outP, grand.qty)}</td>
        <td class="c b">${fmtPct(grand.susut, grand.qty)}</td>
      </tr></tbody>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 8pt; color: #000; }
  .title { text-align: center; font-weight: 700; font-size: 9.5pt; }
  .sub { text-align: center; font-weight: 700; font-size: 9.5pt; margin: 8px 0 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #000; }
  thead { display: table-header-group; }
  thead th { font-weight: 700; font-size: 8pt; padding: 6px 4px; text-align: center; border: 1px solid #000; }
  thead tr.r2 th { border-top: 1px solid #000; }
  tbody td { padding: 2px 4px; vertical-align: middle; }
  tbody.grp { break-inside: avoid; }
  tbody.grp tr.first td { border-top: 1px solid #000; }
  tbody.grp:first-of-type tr.first td { border-top: none; }
  td.c { text-align: center; white-space: nowrap; }
  td.n { text-align: right; white-space: nowrap; padding-right: 10px; font-variant-numeric: tabular-nums; }
  td.t { text-align: left; }
  td.b { font-weight: 700; }
  tbody.grand td { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px; }
  td.empty { text-align: center; padding: 18px 0; color: #666; }
  /* garis pemisah kolom: semua kolom, menyambung dari header sampai baris terakhir.
     (jangan pakai :last-child — pada baris ke-2 dst. sel terakhir adalah kolom Qty) */
  tbody td { border-right: 1px solid #000; }
  /* sel gabungan per produksi: di tengah secara vertikal */
  tbody td.m { vertical-align: middle; }
</style>
</head>
<body>
  <div class="title">Laporan Produktivitas Broker</div>
  <div class="sub">Dari ${escapeHtml(fmtDateDMY(tglAwal))} Sampai ${escapeHtml(fmtDateDMY(tglAkhir))}</div>
  <table>
    <colgroup>
      <col style="width:7%" /><col style="width:10.5%" /><col style="width:7%" />
      <col style="width:17%" /><col style="width:7%" /><col style="width:7.5%" />
      <col style="width:16%" /><col style="width:6%" /><col style="width:6%" /><col style="width:6%" />
      <col style="width:5%" /><col style="width:5%" />
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">Date</th><th rowspan="2">Mesin</th><th rowspan="2">Regu</th>
        <th colspan="3">Pemakaian Bahan</th>
        <th colspan="4">Hasil Produksi</th>
        <th colspan="2">Persentase</th>
      </tr>
      <tr class="r2">
        <th>Bahan</th><th>Qty</th><th>Total</th>
        <th>Bahan</th><th>Qty</th><th>Bonggol</th><th>Susut</th>
        <th>Hasil</th><th>Susut</th>
      </tr>
    </thead>
    ${groups.length ? body + totalRow : empty}
  </table>
</body>
</html>`;
}

async function renderProduktivitasBrokerPdf({ html }) {
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
        margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
      }),
    );
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildProduktivitasBrokerHtml,
  renderProduktivitasBrokerPdf,
};
