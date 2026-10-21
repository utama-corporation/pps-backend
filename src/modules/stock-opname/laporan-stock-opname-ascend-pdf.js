// Laporan Stock Opname (Ascend) — padanan CrStockOpnameAscend.rpt di
// FrmStockOpname.vb (LinkLabel1_LinkClicked). A4 portrait, satu tabel per famili,
// header & footer diulang di setiap halaman (contoh: SOAscend.pdf).
const pdfmake = require("pdfmake");

pdfmake.setFonts({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});
pdfmake.setUrlAccessPolicy(() => false);
const STANDARD_FONTS = new Set([
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
]);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

const COMPANY = "GSU";
const TITLE = "Laporan Stock Opname (Ascend)";
const FS = 7;
const MARGIN_L = 14;
const MARGIN_R = 12;
// No | Famili Name | Item Name | Ascend | Fisik | Selisih | Remark (lebar isi; total 569pt)
const COL_W = [22, 107, 166, 42, 48, 38, 104];

const pad = (n) => String(n).padStart(2, "0");
const num = (v) => Number(v) || 0;
const fmt2 = (v) =>
  num(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Kolom DATE dari mssql = tengah malam UTC → baca komponen UTC supaya tanggal tidak bergeser.
function fmtDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v ?? "");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function nowWib() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const TABLE_LAYOUT = {
  hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.6 : 0),
  vLineWidth: () => 0.6,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 3,
  paddingRight: () => 3,
};

function groupByFamily(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.FamilyName || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.values()];
}

function familyTable(list) {
  const head = ["No", "Famili Name", "Item Name", "Ascend", "Fisik", "Selisih", "Remark"].map(
    (t) => ({ text: t, alignment: "center" }),
  );
  const body = list.map((r, i) => {
    const hasFisik = r.QtyFisik !== null && r.QtyFisik !== undefined;
    return [
      { text: String(i + 1), alignment: "center" },
      { text: r.FamilyName || "" },
      { text: r.ItemName || "" },
      { text: fmt2(r.Pcs), alignment: "right" },
      { text: hasFisik ? fmt2(r.QtyFisik) : "", alignment: "right" },
      { text: hasFisik ? fmt2(num(r.QtyFisik) - num(r.Pcs)) : "", alignment: "right" },
      { text: r.UsageRemark || "" },
    ];
  });
  return {
    table: { headerRows: 1, widths: COL_W, body: [head, ...body], dontBreakRows: true },
    layout: TABLE_LAYOUT,
    margin: [0, 0, 0, 11],
  };
}

/**
 * @param {{noSO: string, tanggal: Date|string, gudang: string, rows: Array}} data
 * @param {{user?: string}} opts
 */
function buildDocDefinition(data, { user = "" } = {}) {
  const printed = nowWib();
  const content = groupByFamily(data.rows).map(familyTable);
  if (content.length === 0) content.push({ text: "Tidak ada data item.", margin: [0, 8, 0, 0] });

  return {
    pageSize: "A4",
    pageMargins: [MARGIN_L, 116, MARGIN_R, 34],
    defaultStyle: { font: "Helvetica", fontSize: FS },
    info: { title: `Laporan Stock Opname Ascend ${data.noSO}` },
    header: {
      margin: [MARGIN_L, 15, MARGIN_R, 0],
      stack: [
        { text: COMPANY, alignment: "center", fontSize: 8 },
        { text: TITLE, alignment: "center", fontSize: 9, margin: [0, 10, 0, 0] },
        {
          margin: [8, 22, 0, 0],
          fontSize: 8,
          stack: [
            { text: `No SO : ${data.noSO}` },
            { text: `Tanggal SO : ${fmtDate(data.tanggal)}`, margin: [0, 7, 0, 0] },
            { text: `Warehouse : ${data.gudang}`, margin: [0, 7, 0, 0] },
          ],
        },
      ],
    },
    content,
    footer: (currentPage, pageCount) => ({
      margin: [MARGIN_L + 4, 9, MARGIN_R + 4, 0],
      columns: [
        { width: "*", text: `Print by ${user} on ${printed}`, italics: true, fontSize: 6.5 },
        {
          width: 80,
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          italics: true,
          fontSize: 6.5,
        },
      ],
    }),
  };
}

async function generateLaporanStockOpnameAscendPdf(data, opts) {
  const buffer = await pdfmake.createPdf(buildDocDefinition(data, opts)).getBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateLaporanStockOpnameAscendPdf, buildDocDefinition };
