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

function fmt2(value) {
  if (value == null || value === 0) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtInt(value) {
  if (value == null || value === 0) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(value, base) {
  if (value == null || value === 0 || !base) return "";
  return `${((value / base) * 100).toFixed(2)}%`;
}

function runningSum(values) {
  const nums = [];
  for (const v of values) {
    if (v != null && Number.isFinite(v)) nums.push(v);
  }
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return sum === 0 ? null : sum;
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

function buildHotStampingMain(spRows, noProduksi) {
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

function buildHotStampingReportHtml({ main, by }) {
  const inputRows = main.filter((r) => isTipe(r, "input"));
  const outputRows = main.filter((r) => isTipe(r, "output"));

  const inputTotal = runningSum(inputRows.map((r) => r.Total));
  const outputQtyTotal = runningSum(outputRows.map((r) => r.Total));
  const outputBeratTotal = runningSum(outputRows.map((r) => r.Total2));

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
        <td class="num">${fmt2(r.Total)}</td>
        <td class="num">${fmtPct(r.Total, inputTotal)}</td>
      </tr>`,
    )
    .join("");

  const outputBody = outputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="center">${escapeHtml(r.NoLabel)}</td>
        <td class="num">${fmtInt(r.Total)}</td>
        <td class="num">${fmt2(r.Total2)}</td>
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
  .page { display: flex; flex-direction: column; min-height: 204.15mm; }
  .title { text-align: center; font-size: 14pt; font-weight: 700; margin-bottom: 11px; letter-spacing: .2px; }
  .meta { display: grid; grid-template-columns: 103px max-content 1fr; gap: 1px 0; width: max-content; margin-bottom: 30px; font-size: 9pt; line-height: 1.21; }
  .meta .lbl { padding-left: 10px; }
  .meta .sep { padding-right: 5px; }
  .box { border: 1.5px solid #111827; display: flex; flex-direction: column; flex: 0 0 auto; }
  .box-cols { display: flex; flex: 1; }
  .col { display: flex; flex-direction: column; min-width: 0; }
  .col + .col { border-left: 1px solid #111827; }
  .col-1 { width: 27.2%; }
  .col-2 { width: 48.4%; }
  .col-3 { width: 24.4%; }
  .col-head { text-align: center; font-weight: 700; font-size: 9.5pt; padding: 1px 4px; border-bottom: 1px solid #111827; background: #F3F4F6; }
  .col-body { flex: 1; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-weight: 700; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #111827; text-align: left; vertical-align: bottom; background: #FAFAFA; }
  thead th.num, thead th.center { text-align: center; }
  .col-1 thead th, .col-3 thead th { height: 52px; padding: 17px 5px 4px; vertical-align: top; }
  .col-2 thead tr:first-child th { height: 23px; padding: 2px 5px 4px; white-space: nowrap; vertical-align: top; }
  .col-2 thead tr:last-child th { height: 31px; padding: 0 5px; line-height: 1.25; white-space: nowrap; vertical-align: top; }
  .col-2 thead tr:last-child th:nth-child(2), .col-2 thead tr:last-child th:nth-child(3) { vertical-align: bottom; }
  tbody td { padding: 0 5px; border-bottom: none; vertical-align: top; font-family: 'Times New Roman', Times, serif; font-size: 6.6pt; line-height: 1.52; }
  .col-1 thead th:not(:last-child),
  .col-3 thead th:not(:last-child),
  .col-2 thead tr:first-child th:first-child,
  .col-2 thead tr:last-child th:not(:last-child) { border-right: 1px solid #111827; }
  .col-1 .col-body { background-image: linear-gradient(#111827,#111827), linear-gradient(#111827,#111827); background-size: 1px 100%, 1px 100%; background-position: 61.7% 0, 81.1% 0; background-repeat: no-repeat; }
  .col-2 .col-body { background-image: linear-gradient(#111827,#111827), linear-gradient(#111827,#111827), linear-gradient(#111827,#111827); background-size: 1px 100%, 1px 100%, 1px 100%; background-position: 63.8% 0, 79.7% 0, 89.3% 0; background-repeat: no-repeat; }
  .col-3 .col-body { background-image: linear-gradient(#111827,#111827), linear-gradient(#111827,#111827); background-size: 1px 100%, 1px 100%; background-position: 21.9% 0, 35.8% 0; background-repeat: no-repeat; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; }
  td.txt { white-space: pre-line; word-break: break-word; }
  .box-foot { display: flex; border-top: 1.5px solid #111827; margin-top: -3px; }
  .foot { min-width: 0; }
  .foot + .foot { border-left: 1px solid #111827; }
  .foot-1 { width: 27.2%; }
  .foot-2 { width: 48.4%; }
  .foot-3 { width: 24.4%; }
  .box-foot table td { padding: 0 5px; border-right: 1px solid #111827; font-weight: 700; border-bottom: none; font-family: 'Times New Roman', Times, serif; font-size: 7.7pt; }
  .box-foot table td:last-child { border-right: none; }
      .box-foot .val { text-align: right; font-variant-numeric: tabular-nums; }
  .sign { display: flex; border: 1.5px solid #111827; margin-top: auto; width: 87.7%; }
  .sign-tbl { flex: 1; min-width: 0; }
  .sign-tbl table { table-layout: fixed; }
  .sign-tbl th { font-size: 7pt; font-weight: 700; text-align: center; padding: 7px 6px 5px; border-bottom: 1px solid #111827; }
  .sign-role { font-size: 7pt; padding: 3px 6px; border-bottom: 1px solid #111827; color: #374151; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sign-name { padding: 80px 8px 11px; font-weight: 600; font-size: 7.5pt; border-right: 1px solid #9CA3AF; height: 103px; vertical-align: bottom; }
  .sign-tbl tr td:last-child { border-right: none; }
  .anggota { width: 27.5%; border-left: 1px solid #111827; display: flex; flex-direction: column; }
  .anggota table { table-layout: fixed; }
  .anggota th { font-weight: 700; text-align: center; vertical-align: top; padding: 18px 4px 0; height: 45px; border-bottom: 1px solid #111827; font-size: 8.5pt; }
  .anggota td { padding: 4px 6px; border-bottom: 1px solid #9CA3AF; font-size: 8.5pt; text-align: center; }
  .anggota td.v { font-variant-numeric: tabular-nums; }
  .anggota tbody tr:nth-child(1) td { height: 26px; }
    .anggota tbody tr:nth-child(2) td { height: 36px; }
    .anggota tr:last-child td { border-bottom: none; padding: 5px 6px 7px; }
  .printby { margin-top: 0; padding-top: 0; font-size: 7.5pt; color: #6B7280; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="page">
  <div class="title">Laporan Harian Hasil Hot Stamping Produksi</div>

  <div class="meta">
    <span class="lbl">No Produksi</span><span class="sep">:</span><span>${escapeHtml(noProduksi)}</span>
    <span class="lbl">Tanggal</span><span class="sep">:</span><span>${escapeHtml(tanggal)}</span>
    <span class="lbl">Nama Mesin</span><span class="sep">:</span><span>${escapeHtml(namaMesin)}</span>
    <span class="lbl">Shift</span><span class="sep">:</span><span>${shift == null ? "" : escapeHtml(shift)}</span>
  </div>

  <div class="box">
    <div class="box-cols">
      <div class="col col-1">
        <div class="col-head">Pemakaian Bahan</div>
        <div class="col-body">
          <table>
            <colgroup><col style="width:61.7%" /><col style="width:19.4%" /><col style="width:18.9%" /></colgroup>
            <thead><tr><th>Nama Bahan</th><th class="center">Qty<br />()</th><th class="center">%</th></tr></thead>
            <tbody>${inputBody}</tbody>
          </table>
        </div>
      </div>

      <div class="col col-2">
        <div class="col-head">Hasil Hot Stamping</div>
        <div class="col-body">
          <table>
            <colgroup><col style="width:63.8%" /><col style="width:15.9%" /><col style="width:9.6%" /><col style="width:10.7%" /></colgroup>
            <thead>
              <tr>
                <th rowspan="2" class="center" style="vertical-align:middle; padding-bottom:10px">Nama Barang</th>
                <th colspan="3" class="center">Bagus</th>
              </tr>
              <tr>
                <th class="center">Jumlah<br />Label</th>
                <th class="center">Qty</th>
                <th class="center">Berat</th>
              </tr>
            </thead>
            <tbody>${outputBody}</tbody>
          </table>
        </div>
      </div>

      <div class="col col-3">
        <div class="col-head">Downtime</div>
        <div class="col-body">
          <table>
            <colgroup><col style="width:21.9%" /><col style="width:13.9%" /><col style="width:64.2%" /></colgroup>
            <thead><tr><th class="center">Jam<br />Berhenti</th><th class="center">Durasi</th><th class="center">Keterangan</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="box-foot">
      <div class="foot foot-1">
        <table>
          <colgroup><col style="width:61.7%" /><col style="width:19.4%" /><col style="width:18.9%" /></colgroup>
          <tr><td></td><td class="val">${fmt2(inputTotal)}</td><td></td></tr>
        </table>
      </div>
      <div class="foot foot-2">
        <table>
          <colgroup><col style="width:63.8%" /><col style="width:15.9%" /><col style="width:9.6%" /><col style="width:10.7%" /></colgroup>
          <tr><td></td><td></td><td class="val">${fmtInt(outputQtyTotal)}</td><td class="val">${fmt2(outputBeratTotal)}</td></tr>
        </table>
      </div>
      <div class="foot foot-3">
        <table>
          <colgroup><col style="width:21.9%" /><col style="width:13.9%" /><col style="width:64.2%" /></colgroup>
          <tr><td></td><td></td><td></td></tr>
        </table>
      </div>
    </div>
  </div>

  <div class="sign">
    <div class="sign-tbl">
      <table>
        <colgroup><col style="width:23.3%" /><col style="width:21.95%" /><col style="width:24.1%" /><col style="width:30.65%" /></colgroup>
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
            <td class="sign-role">Ka. Div. Produksi Hilir</td>
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
    <div class="anggota">
      <table>
        <colgroup><col style="width:46.9%" /><col style="width:53.1%" /></colgroup>
        <thead><tr><th colspan="2">Jumlah Anggota</th></tr></thead>
        <tbody>
          <tr><td>Hadir</td><td class="v"></td></tr>
          <tr><td>Absen</td><td class="v"></td></tr>
          <tr><td>Total</td><td class="v"></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="printby">Print by ${escapeHtml(by || "-")} on ${printDate}</div>
  </div>
</body>
</html>`;
}

async function renderHotStampingReportPdf({ main, by }) {
  const html = buildHotStampingReportHtml({ main, by });

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
      margin: { top: "3mm", right: "3.9mm", bottom: "1.5mm", left: "2.1mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildHotStampingMain,
  buildHotStampingReportHtml,
  renderHotStampingReportPdf,
};
