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

function toFloat(value) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(value) {
  if (value == null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function buildWashingV22Main(spRows, noProduksi) {
  if (!Array.isArray(spRows) || spRows.length === 0) {
    throw notFound(`Data produksi ${noProduksi} tidak ditemukan`);
  }
  return spRows.map((row) => ({
    Tipe: row.Tipe == null ? "" : String(row.Tipe),
    Jenis: row.Jenis == null ? "" : String(row.Jenis),
    NamaMesin: row.NamaMesin == null ? "" : String(row.NamaMesin),
    TglProduksi: formatDateOnly(row.TglProduksi),
    Shift: toIntOrNull(row.Shift),
    CreateBy: row.CreateBy == null ? "" : String(row.CreateBy),
    CheckBy1: row.CheckBy1 == null ? "" : String(row.CheckBy1),
    CheckBy2: row.CheckBy2 == null ? "" : String(row.CheckBy2),
    ApproveBy: row.ApproveBy == null ? "" : String(row.ApproveBy),
    TimeStart: null,
    TimeEnd: null,
    Brt: toFloat(row.Brt),
    Stat: row.Stat == null ? "" : String(row.Stat),
    JmlhAnggota: toIntOrNull(row.JmlhAnggota),
    Hadir: toIntOrNull(row.Hadir),
    Remarks: null,
    NoProduksi: row.NoProduksi == null ? "" : String(row.NoProduksi),
    NoLabel: row.NoLabel == null ? "" : String(row.NoLabel),
  }));
}

function buildWashingV22Downtime(downtimeRows) {
  const out = [];
  for (const row of Array.isArray(downtimeRows) ? downtimeRows : []) {
    const startSec = timeToSeconds(row.TimeStart);
    const endSec = timeToSeconds(row.TimeEnd);
    if (startSec == null || endSec == null) continue;
    let durasiDetik = endSec - startSec;
    if (durasiDetik < 0) durasiDetik += 24 * 3600;
    const hh = Math.floor(durasiDetik / 3600);
    const mm = Math.floor((durasiDetik % 3600) / 60);
    const ss = durasiDetik % 60;
    out.push({
      NoProduksi: row.NoProduksi == null ? "" : String(row.NoProduksi),
      NoUrut: toIntOrNull(row.NoUrut),
      TimeStart: formatTimeOfDay(row.TimeStart),
      TimeEnd: formatTimeOfDay(row.TimeEnd),
      Remarks: row.Remarks == null ? "" : String(row.Remarks),
      DurasiDetik: durasiDetik,
      DurasiLabel: `${hh}:${pad2(mm)}`,
      DurasiHHMMSS: `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`,
    });
  }
  return out;
}

function firstNonNull(rows, key) {
  for (const r of rows) {
    if (r[key] != null && r[key] !== "") return r[key];
  }
  return null;
}

function statHtml(stat) {
  if (stat === "PASS") return `<span class="pass">PASS</span>`;
  if (stat === "HOLD") return `<span class="hold">HOLD</span>`;
  return stat ? escapeHtml(stat) : "";
}

function buildWashingReportHtml({ main, downtime, by }) {
  const inputRows = main.filter((r) => r.Tipe === "Input");
  const rejectRows = main.filter((r) => r.Tipe === "Reject");
  const bagusRows = main.filter((r) => r.Tipe === "Output");

  const inputTotal = inputRows.reduce((s, r) => s + r.Brt, 0);
  const bagusTotal = bagusRows.reduce((s, r) => s + r.Brt, 0);
  const rejectTotal = rejectRows.reduce((s, r) => s + r.Brt, 0);
  const totalDurasiDetik = downtime.reduce((s, r) => s + (r.DurasiDetik || 0), 0);
  const totalDurasiLabel = `${pad2(Math.floor(totalDurasiDetik / 3600))}:${pad2(
    Math.floor((totalDurasiDetik % 3600) / 60),
  )}`;

  const noProduksi = firstNonNull(main, "NoProduksi") || "-";
  const tanggal = firstNonNull(main, "TglProduksi") || "-";
  const namaMesin = firstNonNull(main, "NamaMesin") || "-";
  const shift = firstNonNull(main, "Shift");
  const createBy = firstNonNull(main, "CreateBy");
  const checkBy1 = firstNonNull(main, "CheckBy1");
  const checkBy2 = firstNonNull(main, "CheckBy2");
  const approveBy = firstNonNull(main, "ApproveBy");
  const jmlhAnggota = firstNonNull(main, "JmlhAnggota");
  const hadir = firstNonNull(main, "Hadir");
  const absen =
    jmlhAnggota != null && hadir != null ? jmlhAnggota - hadir : null;

  const inputBody = inputRows
    .map(
      (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis || "-")}</td>
        <td class="num">${fmtNumber(r.Brt)}</td>
      </tr>`,
    )
    .join("");

  const rowHtml = (r) => `<tr>
        <td class="txt">${escapeHtml(r.Jenis || "-")}</td>
        <td class="txt center">${escapeHtml(r.NoLabel || "-")}</td>
        <td class="num">${r.Tipe === "Reject" ? "" : fmtNumber(r.Brt)}</td>
        <td class="center">${statHtml(r.Stat)}</td>
        <td class="num">${r.Tipe === "Reject" ? fmtNumber(r.Brt) : ""}</td>
      </tr>`;
  const bagusBody = bagusRows.map(rowHtml).join("");
  const rejectBody = rejectRows.map(rowHtml).join("");

  const downBody = downtime
    .map(
      (r) => `<tr>
        <td class="center">${escapeHtml(
          `${r.TimeStart || "-"} - ${r.TimeEnd || "-"}`,
        )}</td>
        <td class="center">${escapeHtml(r.DurasiLabel)}</td>
        <td class="txt">${escapeHtml(r.Remarks || "-")}</td>
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
  .page { display: flex; flex-direction: column; min-height: 194mm; }
  .title { text-align: center; font-size: 14pt; font-weight: 700; margin-bottom: 8px; letter-spacing: .2px; }
  .meta { display: grid; grid-template-columns: max-content max-content 1fr; gap: 2px 0; width: max-content; margin-bottom: 8px; font-size: 9pt; }
  .meta .lbl { padding-right: 6px; }
  .meta .sep { padding-right: 8px; }
  .meta .val { font-weight: 600; }
  .box { border: 1.5px solid #111827; display: flex; margin-bottom: 20px; flex: 1 0 auto; }
  .col { display: flex; flex-direction: column; min-width: 0; }
  .col + .col { border-left: 1px solid #111827; }
  .col-1 { width: 25%; }
  .col-2 { width: 45%; }
  .col-3 { width: 30%; }
  .col-head { text-align: center; font-weight: 700; font-size: 9.5pt; padding: 5px 4px; border-bottom: 1px solid #111827; background: #F3F4F6; }
  .col-body { flex: 1; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-weight: 700; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #111827; text-align: left; vertical-align: bottom; background: #FAFAFA; }
  thead th.num, thead th.center { text-align: center; }
  thead th.right { text-align: right; }
  .col-1 thead th, .col-3 thead th { height: 44px; vertical-align: middle; }
  .col-2 thead th { height: 22px; white-space: nowrap; vertical-align: middle; }
  tbody td { padding: 3px 5px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.center, td.center { text-align: center; }
  td.txt { word-break: break-word; }
  .sub-h { border-left: 1px solid #111827; }
  .pass { color: #15803D; font-weight: 700; }
  .hold { color: #B45309; font-weight: 700; }
  .col-foot { margin-top: auto; border-top: 1.5px solid #111827; }
  .col-foot table td { padding: 4px 5px; font-weight: 700; border-bottom: none; }
  .col-foot .lbl { text-align: right; }
  .col-foot .val { text-align: right; font-variant-numeric: tabular-nums; }
  .sign { display: flex; border: 1.5px solid #111827; }
  .sign-tbl { flex: 1; min-width: 0; }
  .sign-tbl table { table-layout: fixed; }
  .sign-tbl th { font-size: 8.5pt; font-weight: 700; text-align: left; padding: 5px 8px 3px; border-bottom: 1px solid #111827; }
  .sign-role { font-size: 7.5pt; padding: 3px 8px; border-bottom: 1px solid #111827; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;}
  .sign-name { padding: 58px 8px 8px; font-weight: 600; font-size: 8.5pt; border-right: 1px solid #9CA3AF; height: 96px; vertical-align: bottom; }
  .sign-tbl tr td:last-child { border-right: none; }
  .anggota { width: 24%; border-left: 1px solid #111827; display: flex; flex-direction: column; }
  .anggota table { table-layout: fixed; flex: 1; }
  .anggota th { font-weight: 700; text-align: center; padding: 5px 4px; border-bottom: 1px solid #111827; font-size: 8.5pt; }
  .anggota td { padding: 4px 8px; border-bottom: 1px solid #9CA3AF; font-size: 8.5pt; }
  .anggota td.v { text-align: right; border-left: 1px solid #9CA3AF; font-weight: 600; font-variant-numeric: tabular-nums; width: 64px; }
  .anggota tr:last-child td { border-bottom: none; }
  .printby { margin-top: 7px; font-size: 7.5pt; color: #6B7280; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="page">
  <div class="title">Laporan Harian Hasil Washing Produksi</div>

  <div class="meta">
    <span class="lbl">No Produksi</span><span class="sep">:</span><span class="val">${escapeHtml(noProduksi)}</span>
    <span class="lbl">Tanggal</span><span class="sep">:</span><span class="val">${escapeHtml(tanggal)}</span>
    <span class="lbl">Nama Mesin</span><span class="sep">:</span><span class="val">${escapeHtml(namaMesin)}</span>
    <span class="lbl">Shift</span><span class="sep">:</span><span class="val">${shift == null ? "-" : escapeHtml(shift)}</span>
  </div>

  <div class="box">
    <div class="col col-1">
      <div class="col-head">Pemakaian Bahan Baku</div>
      <div class="col-body">
        <table>
          <colgroup><col style="width:68%" /><col style="width:32%" /></colgroup>
          <thead><tr><th class="center">Nama Bahan</th><th class="center sub-h">Qty (Kg)</th></tr></thead>
          <tbody>${inputBody || `<tr><td class="txt">-</td><td class="num">-</td></tr>`}</tbody>
        </table>
      </div>
      <div class="col-foot">
        <table>
          <colgroup><col style="width:68%" /><col style="width:32%" /></colgroup>
          <tr><td class="lbl">Total</td><td class="val">${fmtNumber(inputTotal)}</td></tr>
        </table>
      </div>
    </div>

    <div class="col col-2">
      <div class="col-head">Hasil Washing</div>
      <div class="col-body">
        <table>
          <colgroup><col style="width:32%" /><col style="width:21%" /><col style="width:15%" /><col style="width:17%" /><col style="width:15%" /></colgroup>
          <thead>
            <tr>
              <th rowspan="2" class="center" style="vertical-align:middle">Nama Barang</th>
              <th colspan="3" class="center sub-h">Bagus</th>
              <th rowspan="2" class="center sub-h">Reject (Kg)</th>
            </tr>
            <tr>
              <th class="center sub-h">No Label</th>
              <th class="center sub-h">Qty (Kg)</th>
              <th class="center sub-h">Hasil Cek QC</th>
            </tr>
          </thead>
          <tbody>${bagusBody || ""}${rejectBody || ""}${(!bagusRows.length && !rejectRows.length) ? `<tr><td class="txt">-</td><td class="center">-</td><td class="num">-</td><td class="center">-</td><td class="num">-</td></tr>` : ""}</tbody>
        </table>
      </div>
      <div class="col-foot">
        <table>
          <colgroup><col style="width:32%" /><col style="width:21%" /><col style="width:15%" /><col style="width:17%" /><col style="width:15%" /></colgroup>
          <tr><td class="lbl" colspan="2">Total</td><td class="val">${fmtNumber(bagusTotal)}</td><td></td><td class="val">${fmtNumber(rejectTotal)}</td></tr>
        </table>
      </div>
    </div>

    <div class="col col-3">
      <div class="col-head">Downtime</div>
      <div class="col-body">
        <table>
          <colgroup><col style="width:32%" /><col style="width:18%" /><col style="width:50%" /></colgroup>
          <thead><tr><th class="center">Jam Berhenti</th><th class="center">Durasi (Menit)</th><th>Keterangan</th></tr></thead>
          <tbody>${downBody || `<tr><td class="center">-</td><td class="center">-</td><td class="txt">-</td></tr>`}</tbody>
        </table>
      </div>
      <div class="col-foot">
        <table>
          <colgroup><col style="width:32%" /><col style="width:18%" /><col style="width:50%" /></colgroup>
          <tr><td class="lbl">Total</td><td class="val" style="text-align:center">${escapeHtml(totalDurasiLabel)}</td><td></td></tr>
        </table>
      </div>
    </div>
  </div>

  <div class="sign">
    <div class="sign-tbl">
      <table>
        <colgroup><col style="width:22%" /><col style="width:34%" /><col style="width:24%" /><col style="width:20%" /></colgroup>
        <thead>
          <tr>
            <th class="center sub-h">Di Buat Oleh</th>
            <th class="center sub-h" colspan="2">Di Periksa Oleh</th>
            <th class="center sub-h">Di Setujui Oleh</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="sign-role">Operator</td>
            <td class="sign-role">Ka. Regu Cuci</td>
            <td class="sign-role">Ka. Div. Cuci &amp; Broker</td>
            <td class="sign-role">Ka. Dept. Produksi</td>
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
        <thead><tr><th colspan="2">Jumlah Anggota</th></tr></thead>
        <tbody>
          <tr><td>Hadir</td><td class="v">${hadir == null ? "-" : hadir}</td></tr>
          <tr><td>Absen</td><td class="v">${absen == null ? "-" : absen}</td></tr>
          <tr><td>Total</td><td class="v">${jmlhAnggota == null ? "-" : jmlhAnggota}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="printby">Print by ${escapeHtml(by || "-")} on ${printDate}</div>
  </div>
</body>
</html>`;
}

async function renderWashingReportPdf({ main, downtime, by }) {
  const html = buildWashingReportHtml({ main, downtime, by });

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
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildWashingV22Main,
  buildWashingV22Downtime,
  buildWashingReportHtml,
  renderWashingReportPdf,
};
