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
  if (value == null) return "";
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

function isGroup(row, group) {
  return String(row.Group || "").trim().toUpperCase() === group;
}

function firstNonNull(rows, key) {
  for (const r of rows) {
    if (r[key] != null && r[key] !== "") return r[key];
  }
  return null;
}

// Baris hasil SP_LapHasilProduksiHarianPasangKunci -> bentuk datar siap render.
function buildKeyFittingMain(spRows, noProduksi) {
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
    CreateBy: row.CreateBy == null ? "" : String(row.CreateBy),
    CheckBy1: row.CheckBy1 == null ? "" : String(row.CheckBy1),
    CheckBy2: row.CheckBy2 == null ? "" : String(row.CheckBy2),
    ApproveBy: row.ApproveBy == null ? "" : String(row.ApproveBy),
  }));
}

// FWIP utuh + FWIP partial + material dengan nama sama dijumlahkan jadi satu baris.
function mergeInputByJenis(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${isGroup(r, "MTERIAL") ? "M" : "F"}|${r.Jenis}`;
    const prev = map.get(key);
    if (prev) prev.Total = (prev.Total || 0) + (r.Total || 0);
    else map.set(key, { Jenis: r.Jenis, Total: r.Total || 0 });
  }
  return [...map.values()];
}

function buildKeyFittingReportHtml({
  main,
  by,
  title = "Laporan Harian Hasil Pasang Kunci Produksi",
  hasilLabel = "Hasil Pasang Kunci",
  reguLabel = "Ka. Regu Pasang Kunci",
}) {
  const inputRows = mergeInputByJenis(main.filter((r) => isTipe(r, "input")));
  const outputRows = main.filter(
    (r) => isTipe(r, "output") && !isGroup(r, "REJECT"),
  );
  const rejectRows = main.filter(
    (r) => isTipe(r, "output") && isGroup(r, "REJECT"),
  );

  const inputTotal = sum(inputRows.map((r) => r.Total));
  const outputTotal = sum(outputRows.map((r) => r.Total));
  const rejectTotal = sum(rejectRows.map((r) => r.Total));

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
      </tr>`,
    )
    .join("");

  const outputBody = outputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="lbl-no">${escapeHtml(r.NoLabel)}</td>
        <td class="num">${fmtPcs(r.Total)}</td>
      </tr>`,
    )
    .join("");

  const rejectBody = rejectRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="lbl-no">${escapeHtml(r.NoLabel)}</td>
        <td class="num">${fmtKg(r.Total)}</td>
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
  .col-1 { width: 24%; }
  .col-2 { width: 38%; }
  .col-3 { width: 38%; }
  .col-head { text-align: center; font-weight: 700; font-size: 9.5pt; padding: 0 4px; border-bottom: 1px solid #111827; background: #F3F4F6; }
  /* Garis pemisah kolom = satu elemen .vl per garis, membentang dari header sampai
     baris total, jadi lurus dan tidak putus. Posisi (%) = lebar <col>. */
  .col-inner { flex: 1; position: relative; display: flex; flex-direction: column; }
  .col-inner .vl { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px solid #111827; pointer-events: none; }
  .col-body { flex: 1; }
  .col-foot { border-top: 1.5px solid #111827; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-weight: 700; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #111827; text-align: center; vertical-align: bottom; background: #FAFAFA; height: 34px; }
  tbody td { padding: 1px 5px; vertical-align: top; font-size: 7.7pt; line-height: 1.05; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; }
  td.lbl-no { text-align: center; white-space: nowrap; padding-left: 2px; padding-right: 2px; }
  td.txt { word-break: break-word; }
  .col-foot td { padding: 4px 5px; font-weight: 700; height: 22px; }
  .col-foot .val { text-align: right; font-variant-numeric: tabular-nums; }
  .sign { display: flex; border: 1.5px solid #111827; margin-top: 23px; }
  .sign-tbl { flex: 1; min-width: 0; }
  .sign-tbl th { font-size: 8.5pt; font-weight: 700; text-align: center; padding: 5px 6px 3px; border-bottom: 1px solid #111827; }
  .sign-role { font-size: 7.5pt; padding: 3px 6px; border-bottom: 1px solid #111827; color: #374151; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sign-name { padding: 92px 8px 6px; font-weight: 600; font-size: 8.5pt; border-right: 1px solid #9CA3AF; height: 110px; vertical-align: bottom; }
  .sign-tbl tr td:last-child { border-right: none; }
  .sign-tbl th:not(:last-child), .sign-role:not(:last-child) { border-right: 1px solid #111827; }
  .sign-name { border-right: 1px solid #111827; }
  .sign-tbl tr td:last-child { border-right: none; }
  .printby { margin-top: auto; padding-top: 47px; font-size: 7.5pt; color: #6B7280; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="page">
  <div class="title">${escapeHtml(title)}</div>

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
        <div class="col-inner">
          <i class="vl" style="left:80%"></i>
          <div class="col-body">
            <table>
              <colgroup><col style="width:80%" /><col style="width:20%" /></colgroup>
              <thead><tr><th>Nama Bahan</th><th>Qty<br />(Pcs)</th></tr></thead>
              <tbody>${inputBody}</tbody>
            </table>
          </div>
          <div class="col-foot">
            <table>
              <colgroup><col style="width:80%" /><col style="width:20%" /></colgroup>
              <tr><td></td><td class="val">${fmtPcs(inputTotal)}</td></tr>
            </table>
          </div>
        </div>
      </div>

      <div class="col col-2">
        <div class="col-head">${escapeHtml(hasilLabel)}</div>
        <div class="col-inner">
          <i class="vl" style="left:46%"></i><i class="vl" style="left:78%"></i>
          <div class="col-body">
            <table>
              <colgroup><col style="width:46%" /><col style="width:32%" /><col style="width:22%" /></colgroup>
              <thead><tr><th>Nama Barang</th><th>Nomor<br />Label</th><th>Qty<br />(Pcs)</th></tr></thead>
              <tbody>${outputBody}</tbody>
            </table>
          </div>
          <div class="col-foot">
            <table>
              <colgroup><col style="width:46%" /><col style="width:32%" /><col style="width:22%" /></colgroup>
              <tr><td colspan="2"></td><td class="val">${fmtPcs(outputTotal)}</td></tr>
            </table>
          </div>
        </div>
      </div>

      <div class="col col-3">
        <div class="col-head">Reject</div>
        <div class="col-inner">
          <i class="vl" style="left:40%"></i><i class="vl" style="left:74%"></i>
          <div class="col-body">
            <table>
              <colgroup><col style="width:40%" /><col style="width:34%" /><col style="width:26%" /></colgroup>
              <thead><tr><th>Nama Reject</th><th>Nomor<br />Label</th><th>Berat<br />(Kg)</th></tr></thead>
              <tbody>${rejectBody}</tbody>
            </table>
          </div>
          <div class="col-foot">
            <table>
              <colgroup><col style="width:40%" /><col style="width:34%" /><col style="width:26%" /></colgroup>
              <tr><td colspan="2"></td><td class="val">${fmtKg(rejectTotal)}</td></tr>
            </table>
          </div>
        </div>
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
            <td class="sign-role">${escapeHtml(reguLabel)}</td>
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

async function renderKeyFittingReportPdf({ main, by, ...labels }) {
  const html = buildKeyFittingReportHtml({ main, by, ...labels });

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
  buildKeyFittingMain,
  buildKeyFittingReportHtml,
  renderKeyFittingReportPdf,
};
