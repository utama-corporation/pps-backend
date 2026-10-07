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

function formatTimeOfDay(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const m = value.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${pad2(Number(m[1]))}:${m[2]}` : value;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
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

function fmtKg(value) {
  if (value == null) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function timeToSeconds(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const m = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
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

function buildGilinganMain(spRows, noProduksi) {
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
    Berat: toFloatOrNull(row.Berat),
    CreateBy: row.CreateBy == null ? "" : String(row.CreateBy),
    CheckBy1: row.CheckBy1 == null ? "" : String(row.CheckBy1),
    CheckBy2: row.CheckBy2 == null ? "" : String(row.CheckBy2),
    ApproveBy: row.ApproveBy == null ? "" : String(row.ApproveBy),
    JmlhAnggota: toIntOrNull(row.JmlhAnggota),
    Hadir: toIntOrNull(row.Hadir),
    Stat: row.Stat == null ? "" : String(row.Stat),
  }));
}

function buildGilinganDowntime(downtimeRows) {
  const out = [];
  for (const row of Array.isArray(downtimeRows) ? downtimeRows : []) {
    const startSec = timeToSeconds(row.TimeStart);
    const endSec = timeToSeconds(row.TimeEnd);
    if (startSec == null || endSec == null) continue;
    let durasiDetik = endSec - startSec;
    if (durasiDetik < 0) durasiDetik += 24 * 3600;
    const hh = Math.floor(durasiDetik / 3600);
    const mm = Math.floor((durasiDetik % 3600) / 60);
    out.push({
      TimeStart: formatTimeOfDay(row.TimeStart),
      TimeEnd: formatTimeOfDay(row.TimeEnd),
      Remarks: row.Remarks == null ? "" : String(row.Remarks),
      DurasiDetik: durasiDetik,
      DurasiLabel: `${hh}:${pad2(mm)}`,
    });
  }
  return out;
}

function buildGilinganReportHtml({ main, downtime, by }) {
  const inputRows = main.filter((r) => isTipe(r, "input"));
  const outputRows = main.filter((r) => isTipe(r, "output"));

  const inputTotal = runningSum(inputRows.map((r) => r.Berat));
  const outputTotal = runningSum(outputRows.map((r) => r.Berat));

  const totalDurasiDetik = downtime.reduce(
    (s, r) => s + (r.DurasiDetik || 0),
    0,
  );
  const totalDurasiLabel =
    downtime.length === 0
      ? ""
      : `${pad2(Math.floor(totalDurasiDetik / 3600))}:${pad2(
          Math.floor((totalDurasiDetik % 3600) / 60),
        )}`;

  const noProduksi = firstNonNull(main, "NoProduksi") || "-";
  const tanggal = firstNonNull(main, "Tanggal") || "-";
  const namaMesin = firstNonNull(main, "NamaMesin") || "-";
  const shift = firstNonNull(main, "Shift");
  const createBy = firstNonNull(main, "CreateBy");
  const checkBy1 = firstNonNull(main, "CheckBy1");
  const checkBy2 = firstNonNull(main, "CheckBy2");
  const approveBy = firstNonNull(main, "ApproveBy");
  const jmlhAnggota = firstNonNull(main, "JmlhAnggota");
  const hadir = firstNonNull(main, "Hadir");

  let hadirCell = "";
  let absenCell = "";
  let totalCell = "";
  if (jmlhAnggota != null && jmlhAnggota !== 0) {
    totalCell = String(jmlhAnggota);
    if (hadir != null) {
      hadirCell = String(hadir);
      absenCell = String(jmlhAnggota - hadir);
    }
  }

  const inputBody = inputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="num">${r.Berat == null ? "" : fmtKg(r.Berat)}</td>
      </tr>`,
    )
    .join("");

  const outputBody = outputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis)}</td>
        <td class="center">${escapeHtml(r.NoLabel)}</td>
        <td class="num">${r.Berat == null ? "" : fmtKg(r.Berat)}</td>
        <td class="center">${escapeHtml(r.Stat)}</td>
      </tr>`,
    )
    .join("");

  const downBody = downtime
    .map(
      (r) => `<tr>
        <td class="center nowrap"><span class="dt">${escapeHtml(
          r.TimeStart || "",
        )}</span> <span class="dt">${escapeHtml(r.TimeEnd || "")}</span></td>
        <td class="center">${escapeHtml(r.DurasiLabel)}</td>
        <td class="txt">${escapeHtml(r.Remarks)}</td>
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
  .box { border: 1.5px solid #111827; display: flex; flex-direction: column; margin-bottom: 0; flex: 1 0 auto; }
  .box-cols { display: flex; flex: 1; }
  .col { display: flex; flex-direction: column; min-width: 0; }
  .col + .col { border-left: 1px solid #111827; }
  .col-1 { width: 29.6%; }
  .col-2 { width: 43.2%; }
  .col-3 { width: 27.2%; }
  .col-head { text-align: center; font-weight: 700; font-size: 9.5pt; padding: 0 4px; border-bottom: 1px solid #111827; background: #F3F4F6; }
  .col-body { flex: 1; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-weight: 700; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #111827; text-align: left; vertical-align: bottom; background: #FAFAFA; }
  thead th.num, thead th.center { text-align: center; }
  .col-1 thead th, .col-3 thead th { height: 52px; padding: 17px 5px 4px; vertical-align: top; }
  .col-2 thead tr:first-child th { height: 21px; padding: 3px 5px 0; white-space: nowrap; vertical-align: top; }
   .col-2 thead tr:last-child th { height: 31px; padding: 1px 5px 0; line-height: 1.25; white-space: nowrap; vertical-align: top; }
   .col-2 thead tr:last-child th:nth-child(2) { vertical-align: bottom; }
  tbody td { padding: 1px 5px; border-bottom: none; vertical-align: top; font-size: 7.7pt; line-height: 1.05; }
  .col-1 thead th:not(:last-child), .col-1 tbody td:not(:last-child),
  .col-3 thead th:not(:last-child), .col-3 tbody td:not(:last-child),
  .col-2 thead tr:first-child th:first-child,
  .col-2 thead tr:last-child th:not(:last-child),
  .col-2 tbody td:not(:last-child) { border-right: 1px solid #111827; }
  tbody tr:last-child td { border-bottom: none; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; }
  td.txt { word-break: break-word; }
  td.nowrap { white-space: nowrap; }
  .box-foot { display: flex; border-top: 1.5px solid #111827; }
  .foot { min-width: 0; }
  .foot + .foot { border-left: 1px solid #111827; }
  .foot-1 { width: 29.6%; }
  .foot-2 { width: 43.2%; }
  .foot-3 { width: 27.2%; }
  .box-foot table td { padding: 4px 5px; font-weight: 700; border-bottom: none; }
  .box-foot .val { text-align: right; font-variant-numeric: tabular-nums; }
  .sign { display: flex; border: 1.5px solid #111827; margin-top: 23px; }
  .sign-tbl { flex: 1; min-width: 0; }
  .sign-tbl table { table-layout: fixed; }
  .sign-tbl th { font-size: 8.5pt; font-weight: 700; text-align: center; padding: 5px 6px 3px; border-bottom: 1px solid #111827; }
  .sign-role { font-size: 7.5pt; padding: 3px 6px; border-bottom: 1px solid #111827; color: #374151; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sign-name { padding: 92px 8px 6px; font-weight: 600; font-size: 8.5pt; border-right: 1px solid #9CA3AF; height: 110px; vertical-align: bottom; }
  .sign-tbl tr td:last-child { border-right: none; }
  .anggota { width: 21.91%; border-left: 1px solid #111827; display: flex; flex-direction: column; }
  .anggota table { table-layout: fixed; flex: 1; }
  .anggota th { font-weight: 700; text-align: center; vertical-align: top; padding: 13px 4px 0; height: 42px; border-bottom: 1px solid #111827; font-size: 8.5pt; }
  .anggota td { padding: 7px 6px; border-bottom: 1px solid #9CA3AF; font-size: 8.5pt; text-align: center; }
  .anggota td.v { font-variant-numeric: tabular-nums; }
  .anggota tr:last-child td { border-bottom: none; padding: 19px 6px 9px; }
  .printby { margin-top: auto; padding-top: 47px; font-size: 7.5pt; color: #6B7280; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="page">
  <div class="title">Laporan Harian Hasil Gilingan Produksi</div>

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
            <colgroup><col style="width:81%" /><col style="width:19%" /></colgroup>
            <thead><tr><th class="center">Nama Bahan</th><th class="center">Qty<br />(Kg)</th></tr></thead>
            <tbody>${inputBody}</tbody>
          </table>
        </div>
      </div>

      <div class="col col-2">
        <div class="col-head">Hasil Gilingan</div>
        <div class="col-body">
          <table>
            <colgroup><col style="width:53.31%" /><col style="width:19.35%" /><col style="width:15.51%" /><col style="width:11.83%" /></colgroup>
            <thead>
              <tr>
                <th rowspan="2" class="center" style="vertical-align:middle">Nama Barang</th>
                <th colspan="3" class="center">Bagus</th>
              </tr>
              <tr>
                <th class="center">Nomor<br />Label</th>
                <th class="center">Qty (Kg)</th>
                <th class="center">Hasil<br />Cek Qc</th>
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
            <colgroup><col style="width:21.81%" /><col style="width:13.8%" /><col style="width:64.39%" /></colgroup>
            <thead><tr><th class="center">Jam<br />Berhenti</th><th class="center">Durasi</th><th>Keterangan</th></tr></thead>
            <tbody>${downBody}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="box-foot">
      <div class="foot foot-1">
        <table>
          <colgroup><col style="width:81%" /><col style="width:19%" /></colgroup>
          <tr><td></td><td class="val">${fmtKg(inputTotal)}</td></tr>
        </table>
      </div>
      <div class="foot foot-2">
        <table>
          <colgroup><col style="width:53.31%" /><col style="width:19.35%" /><col style="width:15.51%" /><col style="width:11.83%" /></colgroup>
          <tr><td></td><td></td><td class="val">${fmtKg(outputTotal)}</td><td></td></tr>
        </table>
      </div>
      <div class="foot foot-3">
        <table>
          <colgroup><col style="width:21.81%" /><col style="width:13.8%" /><col style="width:64.39%" /></colgroup>
          <tr><td></td><td class="val">${escapeHtml(totalDurasiLabel)}</td><td></td></tr>
        </table>
      </div>
    </div>
  </div>

  <div class="sign">
    <div class="sign-tbl">
      <table>
        <colgroup><col style="width:19.51%" /><col style="width:27.77%" /><col style="width:25.33%" /><col style="width:27.39%" /></colgroup>
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
            <td class="sign-role">Ka. Regu Pencampur &amp; Penggilingan Bahan</td>
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
    <div class="anggota">
      <table>
        <colgroup><col style="width:42.6%" /><col style="width:57.4%" /></colgroup>
        <thead><tr><th colspan="2">Jumlah Anggota</th></tr></thead>
        <tbody>
          <tr><td>Hadir</td><td class="v">${hadirCell}</td></tr>
          <tr><td>Absen</td><td class="v">${absenCell}</td></tr>
          <tr><td>Total</td><td class="v">${totalCell}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="printby">Print by ${escapeHtml(by || "-")} on ${printDate}</div>
  </div>
</body>
</html>`;
}

async function renderGilinganReportPdf({ main, downtime, by }) {
  const html = buildGilinganReportHtml({ main, downtime, by });

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
  buildGilinganMain,
  buildGilinganDowntime,
  buildGilinganReportHtml,
  renderGilinganReportPdf,
};
