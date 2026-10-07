const { notFound } = require("../../../core/utils/http-error");
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateOnly(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function toIntOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toFloatOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtPcs(value) {
  if (value == null) return "";
  return Math.round(value).toLocaleString("en-US");
}

function fmtKg(value) {
  if (value == null || value === 0) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sum(values) {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function isTipe(row, tipe) {
  return String(row.Tipe || "").trim().toLowerCase() === tipe;
}

function firstNonNull(rows, key) {
  for (const r of rows) {
    if (r[key] != null && r[key] !== "") return r[key];
  }
  return null;
}

// Baris hasil SP_LapHasilProduksiHarianPacking. Total = pcs, Total2 = berat (kg).
// Untuk Output BJ, NoLabel berisi jumlah label (COUNT NoBJ).
function buildPackingMain(spRows, noProduksi) {
  if (!Array.isArray(spRows) || spRows.length === 0) {
    throw notFound(`Data produksi ${noProduksi} tidak ditemukan`);
  }
  return spRows.map((row) => ({
    Tipe: row.Tipe == null ? "" : String(row.Tipe),
    Group: row.Group == null ? "" : String(row.Group),
    NoProduksi: row.NoProduksi == null ? "" : String(row.NoProduksi),
    NoLabel: row.NoLabel == null ? "" : String(row.NoLabel),
    Tanggal: formatDateOnly(row.Tanggal),
    NamaMesin: row.NamaMesin == null ? "" : String(row.NamaMesin),
    Shift: toIntOrNull(row.Shift),
    Jenis: row.Jenis == null ? "" : String(row.Jenis),
    Total: toFloatOrNull(row.Total),
    Total2: toFloatOrNull(row.Total2),
    CreateBy: row.CreateBy == null ? "" : String(row.CreateBy),
    CheckBy1: row.CheckBy1 == null ? "" : String(row.CheckBy1),
    CheckBy2: row.CheckBy2 == null ? "" : String(row.CheckBy2),
    ApproveBy: row.ApproveBy == null ? "" : String(row.ApproveBy),
  }));
}

// FWIP utuh + FWIP partial dengan nama sama dijumlahkan; material terpisah.
function mergeInputByJenis(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${String(r.Group).toUpperCase() === "MTERIAL" ? "M" : "F"}|${r.Jenis}`;
    const prev = map.get(key);
    if (prev) {
      prev.Total = (prev.Total || 0) + (r.Total || 0);
      prev.Total2 = (prev.Total2 || 0) + (r.Total2 || 0);
    } else {
      map.set(key, {
        Jenis: r.Jenis,
        Total: r.Total || 0,
        Total2: r.Total2 || 0,
      });
    }
  }
  return [...map.values()];
}

function buildPackingReportHtml({ main, by }) {
  const inputRows = mergeInputByJenis(main.filter((r) => isTipe(r, "input")));
  const outputRows = main.filter((r) => isTipe(r, "output"));

  const inputPcs = sum(inputRows.map((r) => r.Total));
  const inputKg = sum(inputRows.map((r) => r.Total2));
  const outputLabel = sum(outputRows.map((r) => Number(r.NoLabel)));
  const outputPcs = sum(outputRows.map((r) => r.Total));
  const outputKg = sum(outputRows.map((r) => r.Total2));

  const noProduksi = firstNonNull(main, "NoProduksi") || "-";
  const tanggal = firstNonNull(main, "Tanggal") || "-";
  const namaMesin = firstNonNull(main, "NamaMesin") || "-";
  const shift = firstNonNull(main, "Shift");
  const createBy = firstNonNull(main, "CreateBy");
  const checkBy1 = firstNonNull(main, "CheckBy1");
  const checkBy2 = firstNonNull(main, "CheckBy2");
  const approveBy = firstNonNull(main, "ApproveBy");

  const inputBody = inputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="num">${fmtPcs(r.Total)}</td>
        <td class="num">${fmtKg(r.Total2)}</td>
      </tr>`,
    )
    .join("");

  const outputBody = outputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="center">${escapeHtml(r.NoLabel)}</td>
        <td class="num">${fmtPcs(r.Total)}</td>
        <td class="num">${fmtKg(r.Total2)}</td>
      </tr>`,
    )
    .join("");

  const now = new Date();
  const printDate = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #111827; }
  .page { display: flex; flex-direction: column; min-height: 203mm; }
  .title { text-align: center; font-size: 14pt; font-weight: 700; margin-bottom: 14px; letter-spacing: .2px; }
  .meta { display: grid; grid-template-columns: max-content max-content 1fr; gap: 1px 0; width: max-content; margin-bottom: 30px; font-size: 9pt; line-height: 1.08; }
  .meta .lbl { padding-right: 6px; }
  .meta .sep { padding-right: 8px; }
  .box { border: 1.5px solid #111827; display: flex; flex-direction: column; flex: 1 0 auto; }
  .box-cols { display: flex; flex: 1; }
  .col { display: flex; flex-direction: column; min-width: 0; }
  .col + .col { border-left: 1px solid #111827; }
  .col-1 { width: 45%; }
  .col-2 { width: 55%; }
  .col-head { text-align: center; font-weight: 700; font-size: 9.5pt; padding: 0 4px; border-bottom: 1px solid #111827; background: #F3F4F6; }
  .col-body { flex: 1; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-weight: 700; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #111827; text-align: center; vertical-align: bottom; background: #FAFAFA; height: 34px; }
  thead th:not(:last-child) { border-right: 1px solid #111827; }
  tbody td { padding: 1px 5px; vertical-align: top; font-size: 7.7pt; line-height: 1.05; }
  .col-1 .col-body { background-image: linear-gradient(#111827,#111827), linear-gradient(#111827,#111827); background-size: 1px 100%, 1px 100%; background-position: 60% 0, 80% 0; background-repeat: no-repeat; }
  .col-2 .col-body { background-image: linear-gradient(#111827,#111827), linear-gradient(#111827,#111827), linear-gradient(#111827,#111827); background-size: 1px 100%, 1px 100%, 1px 100%; background-position: 46% 0, 63% 0, 80% 0; background-repeat: no-repeat; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; }
  td.txt { word-break: break-word; }
  .box-foot { display: flex; border-top: 1.5px solid #111827; }
  .foot { min-width: 0; }
  .foot + .foot { border-left: 1px solid #111827; }
  .foot-1 { width: 45%; }
  .foot-2 { width: 55%; }
  .box-foot table td { padding: 4px 5px; font-weight: 700; border-right: 1px solid #111827; }
  .box-foot table td:last-child { border-right: none; }
  .box-foot .val { text-align: right; font-variant-numeric: tabular-nums; }
  .box-foot .valc { text-align: center; }
  .sign { display: flex; border: 1.5px solid #111827; margin-top: 23px; }
  .sign-tbl { flex: 1; min-width: 0; }
  .sign-tbl th { font-size: 8.5pt; font-weight: 700; text-align: center; padding: 5px 6px 3px; border-bottom: 1px solid #111827; }
  .sign-role { font-size: 7.5pt; padding: 3px 6px; border-bottom: 1px solid #111827; color: #374151; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sign-name { padding: 92px 8px 6px; font-weight: 600; font-size: 8.5pt; border-right: 1px solid #9CA3AF; height: 110px; vertical-align: bottom; }
  .sign-tbl tr td:last-child { border-right: none; }
  .printby { margin-top: auto; padding-top: 47px; font-size: 7.5pt; color: #6B7280; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="page">
  <div class="title">Laporan Harian Hasil Packing Produksi</div>

  <div class="meta">
    <span class="lbl">No Produksi</span><span class="sep">:</span><span>${escapeHtml(noProduksi)}</span>
    <span class="lbl">Tanggal</span><span class="sep">:</span><span>${escapeHtml(tanggal)}</span>
    <span class="lbl">Mesin</span><span class="sep">:</span><span>${escapeHtml(namaMesin)}</span>
    <span class="lbl">Shift</span><span class="sep">:</span><span>${shift == null ? "" : escapeHtml(shift)}</span>
  </div>

  <div class="box">
    <div class="box-cols">
      <div class="col col-1">
        <div class="col-head">Pemakaian Bahan</div>
        <div class="col-body">
          <table>
            <colgroup><col style="width:60%" /><col style="width:20%" /><col style="width:20%" /></colgroup>
            <thead><tr><th>Nama Bahan</th><th>Qty<br />(Pcs)</th><th>Berat<br />(Kg)</th></tr></thead>
            <tbody>${inputBody}</tbody>
          </table>
        </div>
      </div>

      <div class="col col-2">
        <div class="col-head">Hasil Packing</div>
        <div class="col-body">
          <table>
            <colgroup><col style="width:46%" /><col style="width:17%" /><col style="width:17%" /><col style="width:20%" /></colgroup>
            <thead><tr><th>Nama Barang</th><th>Jumlah<br />Label</th><th>Qty<br />(Pcs)</th><th>Berat<br />(Kg)</th></tr></thead>
            <tbody>${outputBody}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="box-foot">
      <div class="foot foot-1">
        <table>
          <colgroup><col style="width:60%" /><col style="width:20%" /><col style="width:20%" /></colgroup>
          <tr><td></td><td class="val">${fmtPcs(inputPcs)}</td><td class="val">${fmtKg(inputKg)}</td></tr>
        </table>
      </div>
      <div class="foot foot-2">
        <table>
          <colgroup><col style="width:46%" /><col style="width:17%" /><col style="width:17%" /><col style="width:20%" /></colgroup>
          <tr><td></td><td class="valc">${fmtPcs(outputLabel)}</td><td class="val">${fmtPcs(outputPcs)}</td><td class="val">${fmtKg(outputKg)}</td></tr>
        </table>
      </div>
    </div>
  </div>

  <div class="sign">
    <div class="sign-tbl">
      <table>
        <colgroup><col style="width:25%" /><col style="width:25%" /><col style="width:25%" /><col style="width:25%" /></colgroup>
        <thead>
          <tr>
            <th>Di Buat Oleh,</th>
            <th colspan="2">Di Periksa Oleh,</th>
            <th>Di Setujui Oleh</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="sign-role">Operator</td>
            <td class="sign-role">Ka. Regu Packing</td>
            <td class="sign-role">Ka. Div, Produksi Inject</td>
            <td class="sign-role">Ka. Dept, Produksi</td>
          </tr>
          <tr>
            <td class="sign-name">${escapeHtml(createBy || "")}</td>
            <td class="sign-name">${escapeHtml(checkBy1 || "")}</td>
            <td class="sign-name">${escapeHtml(checkBy2 || "")}</td>
            <td class="sign-name">${escapeHtml(approveBy || "")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="printby">Print by ${escapeHtml(by || "-")} on ${printDate}</div>
  </div>
</body>
</html>`;
}

async function renderPackingReportPdf({ main, by }) {
  const html = buildPackingReportHtml({ main, by });

  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 1000 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "3mm", right: "8mm", bottom: "4mm", left: "8mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildPackingMain,
  buildPackingReportHtml,
  renderPackingReportPdf,
};
