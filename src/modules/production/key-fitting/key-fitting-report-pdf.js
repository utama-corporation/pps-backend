const { notFound } = require("../../../core/utils/http-error");
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");
const { setReportContent } = require("../../../core/utils/pdf/report-layout");

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
    if (prev) {
      prev.Total = (prev.Total || 0) + (r.Total || 0);
      if (r.NoLabel && !prev.Labels.includes(r.NoLabel)) {
        prev.Labels.push(r.NoLabel);
        prev.NoLabel = prev.Labels.join(", ");
      }
    } else {
      map.set(key, {
        Jenis: r.Jenis,
        NoLabel: r.NoLabel || "",
        Labels: r.NoLabel ? [r.NoLabel] : [],
        Total: r.Total || 0,
      });
    }
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

  // Layout: tabel luar 3 sel (Bahan / Hasil / Reject), tiap sel berisi tabel
  // sendiri yang mengalir mandiri (baris antar grup tidak disejajarkan).
  // Sengaja pakai SEL TABEL, bukan kolom flex: saat isi terpotong antar halaman
  // (thead berulang + break-inside: avoid), Chrome tidak menambah tinggi flex
  // item sehingga kolom panjang (mis. nama barang Spanner yang wrap 3 baris)
  // tumpah menimpa baris total & kotak tanda tangan. Sel tabel ikut memanjang.
  // Garis kolom dalam = background gradient di sel luar (posisi % = lebar
  // <col>), jadi tetap lurus sampai bawah walau isi grup lebih pendek.
  const groups = [
    { cols: [40, 36, 24], rows: inputRows, fmt: fmtPcs, total: fmtPcs(inputTotal),
      head: ["Nama Bahan", "No Label", "Qty<br />(Pcs)"] },
    { cols: [46, 32, 22], rows: outputRows, fmt: fmtPcs, total: fmtPcs(outputTotal),
      head: ["Nama Barang", "Nomor<br />Label", "Qty<br />(Pcs)"] },
    { cols: [40, 34, 26], rows: rejectRows, fmt: fmtKg, total: fmtKg(rejectTotal),
      head: ["Nama Reject", "Nomor<br />Label", "Berat<br />(Kg)"] },
  ];
  const colgroup = (g) =>
    `<colgroup>${g.cols.map((w) => `<col style="width:${w}%" />`).join("")}</colgroup>`;
  const linesStyle = (g) =>
    `background-position:${g.cols[0]}% 0,${g.cols[0] + g.cols[1]}% 0`;
  const bodyCells = groups
    .map(
      (g) => `<td class="grp" style="${linesStyle(g)}">
        <table class="inner">${colgroup(g)}
          <thead><tr>${g.head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${g.rows
            .map(
              (r) => `<tr>
              <td class="txt">${escapeHtml(r.Jenis)}</td>
              <td class="lbl-no">${escapeHtml(r.NoLabel)}</td>
              <td class="num">${g.fmt(r.Total)}</td>
            </tr>`,
            )
            .join("")}</tbody>
        </table>
      </td>`,
    )
    .join("");
  const fillerCells = groups
    .map((g) => `<td class="grp" style="${linesStyle(g)}"></td>`)
    .join("");
  const totalCells = groups
    .map(
      (g) => `<td class="grp" style="${linesStyle(g)}">
        <table class="inner">${colgroup(g)}
          <tr><td></td><td></td><td class="val">${g.total}</td></tr>
        </table>
      </td>`,
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
  .title { text-align: center; font-size: 14pt; font-weight: 700; margin-bottom: 14px; letter-spacing: .2px; }
  .meta { display: grid; grid-template-columns: max-content max-content 1fr; gap: 1px 0; width: max-content; margin-bottom: 30px; font-size: 9pt; line-height: 1.08; }
  .meta .lbl { padding-right: 6px; }
  .meta .sep { padding-right: 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .grid { border: 1.5px solid #111827; }
  .grid > thead > tr > th { text-align: center; font-weight: 700; font-size: 9.5pt; padding: 0 4px; border-bottom: 1px solid #111827; background: #F3F4F6; }
  .grid > thead > tr > th + th, .grid > tbody > tr > td + td { border-left: 1px solid #111827; }
  .grid > tbody > tr > td.grp { padding: 0; vertical-align: top;
    background-image: linear-gradient(#111827, #111827), linear-gradient(#111827, #111827);
    background-size: 1px 100%; background-repeat: no-repeat; }
  .grid > tbody > tr.filler > td { height: 0; }
  .grid > tbody > tr.total > td { border-top: 1.5px solid #111827; }
  .inner thead th { font-weight: 700; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #111827; text-align: center; vertical-align: bottom; height: 34px; }
  .inner tbody td { padding: 1px 5px; vertical-align: top; font-size: 7.7pt; line-height: 1.05; }
  .total .inner td { padding: 4px 5px; font-weight: 700; height: 22px; }
  .total .inner td.val { text-align: right; font-variant-numeric: tabular-nums; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.center { text-align: center; }
  td.lbl-no { text-align: center; overflow-wrap: break-word; padding-left: 2px; padding-right: 2px; }
  td.txt { overflow-wrap: break-word; word-break: break-word; }
  .sign { display: flex; border: 1.5px solid #111827; margin-top: 23px; }
  .sign-tbl { flex: 1; min-width: 0; }
  .sign-tbl th { font-size: 8.5pt; font-weight: 700; text-align: center; padding: 5px 6px 3px; border-bottom: 1px solid #111827; }
  .sign-role { font-size: 7.5pt; padding: 3px 6px; border-bottom: 1px solid #111827; color: #374151; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sign-name { padding: 92px 8px 6px; font-weight: 600; font-size: 8.5pt; border-right: 1px solid #9CA3AF; height: 110px; vertical-align: bottom; }
  .sign-tbl tr td:last-child { border-right: none; }
  .sign-tbl th:not(:last-child), .sign-role:not(:last-child) { border-right: 1px solid #111827; }
  .sign-name { border-right: 1px solid #111827; }
  .sign-tbl tr td:last-child { border-right: none; }
  .printby { padding-top: 47px; font-size: 7.5pt; color: #6B7280; }
  .footer-block { break-inside: avoid; }
  .inner tr, .grid > thead > tr, .grid > tbody > tr.total { break-inside: avoid; }
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

  <table class="grid">
    <colgroup><col style="width:36%" /><col style="width:32%" /><col style="width:32%" /></colgroup>
    <thead>
      <tr>
        <th>Pemakaian Bahan</th>
        <th>${escapeHtml(hasilLabel)}</th>
        <th>Reject</th>
      </tr>
    </thead>
    <tbody>
      <tr class="body">${bodyCells}</tr>
      <tr class="filler">${fillerCells}</tr>
      <tr class="total">${totalCells}</tr>
    </tbody>
  </table>

  <div class="footer-block">
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
            <td class="sign-role">Tally/Stock Controller</td>
            <td class="sign-role">Ka. Regu Produksi</td>
            <td class="sign-role">Ka. Div. Stock</td>
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
    // Laporan 1 halaman: baris filler dipanjangkan agar garis kolom turun
    // sampai kotak tanda tangan. 203mm = 210mm - margin atas/bawah 7mm.
    await setReportContent(page, html, {
      contentHeightMm: 203,
      stretchSelector: ".grid tr.filler > td",
    });
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
