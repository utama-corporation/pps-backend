// Laporan Penerimaan Bahan Baku (per pallet) — padanan CrPenBahanBakuPerPallet.rpt
// di FrmBahanBakuv2.vb (LblLapBahanBaku_LinkClicked). Dirender dengan pdfmake,
// kertas Letter portrait seperti hasil Crystal Report.
const pdfmake = require("pdfmake");

pdfmake.setFonts({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
  Courier: {
    normal: "Courier",
    bold: "Courier-Bold",
    italics: "Courier-Oblique",
    bolditalics: "Courier-BoldOblique",
  },
});
pdfmake.setUrlAccessPolicy(() => false);
// Hanya nama font standar PDF yang boleh "dibuka"; file lokal lain ditolak.
const STANDARD_FONTS = new Set([
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
]);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FS = 7;
const MARGIN_L = 18;
const MARGIN_R = 19;
const CONTENT_W = 612 - MARGIN_L - MARGIN_R;
// Kolom tabel: No, No.Pallet, Jmlh Goni, Kondisi, Berat
// (lebar isi; padding sel 3+3 ditambahkan pdfmake → total 250pt)
const COL_W = [20, 41, 40, 63, 56];
const TABLE_X = 0;
// Tabel lebih dari ini boleh terpecah antar halaman (header diulang).
const UNBREAKABLE_MAX_ROWS = 28;

function fmtDate(v) {
  if (!v) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function todayWib() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const num = (v) => Number(v) || 0;
const fix2 = (v) => num(v).toFixed(2);
// 5.422,99 (id-ID) dan 5,418 / 8,423.75 (en-US) — dua gaya itu memang
// bercampur di laporan Crystal aslinya.
const idNum2 = (v) =>
  num(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const enInt = (v) => Math.trunc(num(v)).toLocaleString("en-US");
const enNum2 = (v) =>
  num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const letter = (i) => {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

function cmpPallet(a, b) {
  return String(a.NoPallet).localeCompare(String(b.NoPallet), "id", { numeric: true });
}

// rows (hasil query per pallet+kondisi) → struktur per NoBahanBaku → per jenis.
function groupRows(rows) {
  const docs = new Map();
  for (const r of rows) {
    if (!docs.has(r.NoBahanBaku)) {
      docs.set(r.NoBahanBaku, {
        noBahanBaku: r.NoBahanBaku,
        tanggal: r.DateCreate,
        supplier: r.NamaSupplier || "",
        jenis: new Map(),
      });
    }
    const doc = docs.get(r.NoBahanBaku);
    const nama = r.Jenis || "-";
    if (!doc.jenis.has(nama)) doc.jenis.set(nama, []);
    doc.jenis.get(nama).push(r);
  }
  return [...docs.values()].map((d) => ({
    ...d,
    jenis: [...d.jenis.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "id", { numeric: true, sensitivity: "base" }))
      .map(([nama, list]) => ({ nama, rows: list })),
  }));
}

const BORDER_LAYOUT = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingTop: () => 3.9,
  paddingBottom: () => 3.9,
  paddingLeft: () => 3,
  paddingRight: () => 3,
};

function kondisiBlock(label, list, startNo) {
  const body = [
    ["No", "No.Pallet", "Jmlh Goni", "Kondisi", "Berat"].map((t) => ({
      text: t,
      alignment: "center",
    })),
    ...list.map((r, i) => [
      { text: String(startNo + i), alignment: "center" },
      { text: String(r.NoPallet), alignment: "center" },
      { text: String(num(r.JumlahSak)), alignment: "center" },
      { text: r.Kondisi, alignment: "left" },
      { text: fix2(r.Berat), alignment: "right" },
    ]),
  ];
  return [
    { text: label, margin: [TABLE_X, 4, 0, 3] },
    {
      margin: [TABLE_X, 0, 0, 0],
      table: { headerRows: 1, widths: COL_W, body },
      layout: BORDER_LAYOUT,
    },
  ];
}

function jenisBlock(index, jenis, isLast) {
  const sorted = [...jenis.rows].sort(cmpPallet);
  const kering = sorted.filter((r) => r.Kondisi === "KERING");
  const lembab = sorted.filter((r) => r.Kondisi === "LEMBAB");

  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
  const goniK = sum(kering, (r) => num(r.JumlahSak));
  const goniL = sum(lembab, (r) => num(r.JumlahSak));
  const kgK = sum(kering, (r) => num(r.Berat));
  const kgL = sum(lembab, (r) => num(r.Berat));
  const intK = sum(kering, (r) => Math.trunc(num(r.Berat)));
  const intL = sum(lembab, (r) => Math.trunc(num(r.Berat)));
  const pallets = new Set(sorted.map((r) => String(r.NoPallet))).size;
  const totalGoni = goniK + goniL;
  const totalKg = kgK + kgL;

  const tables = [];
  if (kering.length) tables.push(...kondisiBlock("KERING", kering, 1));
  if (lembab.length) tables.push(...kondisiBlock("LEMBAB", lembab, kering.length + 1));

  const summaryRow = (cells) => ({
    columns: cells,
    columnGap: 0,
    margin: [0, 0, 0, 1.5],
    fontSize: FS,
  });
  const col = (w, text, alignment = "left") => ({ width: w, text, alignment });

  const summary1 = [col(65, "")];
  const summary2 = [col(65, "")];
  summary1.push(col(135, kering.length ? `Jumlah Goni Kering:${goniK}` : ""));
  summary2.push(col(135, ""));
  summary1.push(col(158, lembab.length ? `Jumlah Goni Lembab:${goniL}` : ""));
  summary2.push(col(158, ""));
  summary1.push(col(112, kering.length ? `Kering(Kg) : ${idNum2(kgK)}` : ""));
  summary2.push(col(112, kering.length ? `Kering(Kg) :${enInt(intK)}` : ""));
  summary1.push(col("*", lembab.length ? `Lembab(Kg) : ${idNum2(kgL)}` : "", "right"));
  summary2.push(col("*", lembab.length ? `Lembab(Kg) :${enInt(intL)}` : "", "right"));

  const unbreakable = sorted.length <= UNBREAKABLE_MAX_ROWS;
  const tableStack = { stack: tables, unbreakable };

  const footer = {
    columns: [
      { width: 277, text: `Jenis Plastik : ${jenis.nama}`, noWrap: true },
      { width: 38, text: "Total Goni :" },
      { width: 32, text: String(totalGoni), alignment: "right" },
      { width: 21, text: "" },
      { width: 83, text: `Jumlah Pallet : ${pallets}` },
      { width: "*", text: `Jmlh Berat(Kg) : ${fix2(totalKg)}` },
    ],
    columnGap: 0,
    margin: [-11, 20, 0, 0],
    fontSize: FS,
  };

  const out = [
    {
      text: [
        { text: `${letter(index)}.`, bold: true },
        { text: "   Jenis Plastik :  ", bold: true },
        { text: jenis.nama, bold: true },
      ],
      margin: [TABLE_X, 8, 0, 0],
      fontSize: FS,
      keepWithNext: true,
    },
    tableStack,
    { stack: [summaryRow(summary1), summaryRow(summary2)], margin: [0, 6, 0, 0], unbreakable: true },
    { stack: [footer], unbreakable: true },
  ];
  if (isLast) {
    out.push({
      canvas: [{ type: "line", x1: -10, y1: 0, x2: 567, y2: 0, lineWidth: 0.6 }],
      margin: [0, 4, 0, 0],
    });
  }
  return { content: out, goni: totalGoni, pallets, kg: totalKg, palletSet: sorted };
}

function docSection(doc, firstSection) {
  const content = [];
  const head = {
    stack: [
      {
        text: "LAPORAN PENERIMAAN BAHAN BAKU",
        font: "Courier",
        bold: true,
        fontSize: 7.5,
        alignment: "center",
      },
      {
        canvas: [{ type: "line", x1: -15, y1: 2, x2: 541, y2: 2, lineWidth: 1 }],
      },
    ],
    margin: [0, 0, 0, 0],
  };
  if (!firstSection) head.pageBreak = "before";
  content.push(head);

  content.push({
    columns: [
      { width: 101, text: `Tanggal : ${fmtDate(doc.tanggal)}` },
      { width: 174, text: `No.Bahan Baku  : ${doc.noBahanBaku}` },
      { width: "*", text: `Nama Supplier   : ${doc.supplier}` },
    ],
    margin: [8, 9, 0, 3],
    fontSize: FS,
  });

  let goni = 0;
  let kg = 0;
  const palletSet = new Set();
  doc.jenis.forEach((j, i) => {
    const b = jenisBlock(i, j, i === doc.jenis.length - 1);
    content.push(...b.content);
    goni += b.goni;
    kg += b.kg;
    for (const r of b.palletSet) palletSet.add(`${j.nama}|${r.NoPallet}`);
  });

  const lbl = (w, t) => ({ width: w, text: t });
  content.push({
    unbreakable: true,
    stack: [
      {
        columns: [
          { width: 321, text: "Note :" },
          lbl(67, "Jumlah Goni"),
          lbl(8, ":"),
          { width: "*", text: String(goni) },
        ],
        margin: [-6, 8, 0, 3],
        fontSize: FS,
      },
      {
        columns: [
          { width: 321, text: "" },
          lbl(67, "Jumlah Pallet"),
          lbl(8, ":"),
          { width: "*", text: String(palletSet.size) },
        ],
        margin: [-6, 0, 0, 2],
        fontSize: FS,
      },
      {
        columns: [
          { width: 321, text: "" },
          lbl(67, "Jmlh Berat (Kg)"),
          lbl(8, ":"),
          { width: "*", text: enNum2(kg) },
        ],
        margin: [-6, 0, 0, 0],
        fontSize: FS,
      },
    ],
  });
  return content;
}

/**
 * @param {Array} rows baris per pallet+kondisi (NoBahanBaku, DateCreate, NamaSupplier,
 *   Jenis, NoPallet, Kondisi, JumlahSak, Berat)
 * @param {{user?: string}} opts
 */
function buildDocDefinition(rows, { user = "" } = {}) {
  const docs = groupRows(rows);
  const content = [];
  docs.forEach((d, i) => content.push(...docSection(d, i === 0)));

  const cetak = todayWib();
  return {
    pageSize: "LETTER",
    pageMargins: [MARGIN_L, 14, MARGIN_R, 42],
    defaultStyle: { font: "Helvetica", fontSize: FS },
    info: { title: "Laporan Penerimaan Bahan Baku" },
    content,
    footer: (currentPage, pageCount) => ({
      margin: [MARGIN_L + 8, 5, MARGIN_R, 0],
      columns: [
        {
          width: "*",
          stack: [{ text: `Cetak :${cetak}` }, { text: `  By :${user}` }],
          fontSize: 6.5,
        },
        {
          width: 80,
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          fontSize: 6.5,
          margin: [0, 8, 0, 0],
        },
      ],
    }),
  };
}

async function generateLaporanPenerimaanBahanBakuPdf(rows, opts) {
  const buffer = await pdfmake.createPdf(buildDocDefinition(rows, opts)).getBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateLaporanPenerimaanBahanBakuPdf, buildDocDefinition };
