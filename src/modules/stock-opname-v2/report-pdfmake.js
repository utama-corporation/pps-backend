// src/modules/stock-opname-v2/report-pdfmake.js
// Versi laporan stock-opname-v2 menggunakan pdfmake (tanpa Chromium).
// pdfmake generate PDF langsung dari data structure — 3-5x lebih cepat
// dari Puppeteer untuk tabel > 1000 baris.

const pdfMake = require("pdfmake/build/pdfmake");
const pdfFonts = require("pdfmake/build/vfs_fonts");
pdfMake.vfs = pdfFonts;

// Barang Jadi: Rekap per Jenis diurutkan berdasarkan nama Jenis (ASC).
function sortJenisBarangJadi(rows, categoryName) {
  if (!/barang\s*jadi/i.test(categoryName || "")) return rows;
  return [...rows].sort((a, b) =>
    String(a.typeName ?? "").localeCompare(String(b.typeName ?? ""), "id", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

const MAX_UNSCANNED_ROWS_PRINTED = 2000;
const MAX_MISMATCH_ROWS_PRINTED = 300;

function fmtNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }) : "0";
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  return `${d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} ${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
}

function locLabel(blok, locationId) {
  if (blok === "TIDAK_DIKETAHUI") return "Tidak diketahui";
  return [blok, locationId]
    .filter((value) => value !== null && value !== undefined)
    .join("");
}

function qtyText(row, isPcsMetric, digits, unitLabel) {
  const value = isPcsMetric ? row.totalPcs : row.totalWeight;
  return `${fmtNum(value, digits)} ${unitLabel}`;
}

function labelCell(row) {
  const label = row.labelNo || "";
  if (!row.labelDate) return { text: label, style: "cell" };
  return {
    stack: [
      { text: label, style: "cell" },
      { text: fmtDate(row.labelDate), fontSize: 6, color: "#64748b" },
    ],
  };
}

const styles = {
  title: { fontSize: 16, bold: true, color: "#1e40af", margin: [0, 0, 0, 8] },
  subtitle: { fontSize: 9, color: "#64748b", margin: [0, 0, 0, 10] },
  h2: { fontSize: 12, bold: true, color: "#1e40af", margin: [0, 10, 0, 4] },
  h3: { fontSize: 10, bold: true, color: "#334155", margin: [0, 8, 0, 3] },
  hdrCell: { bold: true, color: "white", fillColor: "#1e40af", fontSize: 7, alignment: "left" },
  hdrCellR: { bold: true, color: "white", fillColor: "#1e40af", fontSize: 7, alignment: "right" },
  hdrCellC: { bold: true, color: "white", fillColor: "#1e40af", fontSize: 7, alignment: "center" },
  cell: { fontSize: 7 },
  cellR: { fontSize: 7, alignment: "right" },
  cellC: { fontSize: 7, alignment: "center" },
  cellRed: { fontSize: 7, color: "#dc2626" },
  cellRedR: { fontSize: 7, color: "#dc2626", alignment: "right" },
  summaryTbl: { margin: [0, 0, 0, 8] },
  callout: { margin: [0, 0, 0, 8], fontSize: 8 },
  note: { margin: [0, -4, 0, 8], fontSize: 7, color: "#64748b" },
  footer: { fontSize: 7, color: "#94a3b8", alignment: "center" },
};

function tblLayout(hideHeaderLine) {
  return {
    hLineColor: () => "#cbd5e1",
    vLineColor: () => "#e2e8f0",
    hLineWidth: (i) => (i === 0 || hideHeaderLine ? 0 : 0.5),
    paddingTop: () => 2,
    paddingBottom: () => 2,
    paddingLeft: () => 4,
    paddingRight: () => 4,
  };
}

function buildReportDoc({ summary, scanSummary, unscannedLabels, locationMatch }) {
  const no = summary.stockOpnameNo;
  const cat = summary.categoryName;
  const tgl = summary.date;
  const isPcsMetric =
    summary.categoryCode === "furniturewip" ||
    summary.categoryCode === "barangdagang";
  const unit = isPcsMetric ? "pcs" : "kg";
  const unitH = isPcsMetric ? "Pcs" : "Berat";
  const dig = isPcsMetric ? 0 : 2;
  const tot = summary.total || {};
  const totalVal = isPcsMetric ? tot.totalPcs : tot.totalWeight;
  const unscanned = unscannedLabels?.totalUnscannedPcs ?? unscannedLabels?.totalUnscannedWeight ?? 0;
  const scanned = isPcsMetric ? (totalVal - unscanned) : Math.round((totalVal - unscanned) * 100) / 100;
  const unscannedData = unscannedLabels?.data || [];
  const unscannedTotalRecords = unscannedLabels?.totalRecords ?? unscannedData.length;
  const unitLabel = isPcsMetric ? "pcs" : "kg";

  const content = [];

  // === HEADER ===
  content.push({ text: `Laporan Stock Opname — ${no}`, style: "title" });
  content.push({ text: `Kategori: ${cat} | Tanggal Mulai: ${fmtDate(tgl)} | Laporan dibuat: ${fmtDate(new Date())}`, style: "subtitle" });

  // === RINGKASAN ===
  content.push({ text: "Ringkasan Hasil", style: "h2" });
  content.push({
    table: {
      headerRows: 1,
      widths: ["*", "auto", "auto"],
      body: [
        [{ text: "Metrik", style: "hdrCell" }, { text: "Jumlah Label", style: "hdrCellR" }, { text: unitH, style: "hdrCellR" }],
        [{ text: "Tercatat (semua label)", style: "cell" }, { text: fmtNum(tot.labelCount), style: "cellR" }, { text: `${fmtNum(totalVal, dig)} ${unitLabel}`, style: "cellR" }],
        [{ text: "Ditemukan / terscan", style: "cell" }, { text: fmtNum(tot.scannedCount), style: "cellR" }, { text: `${fmtNum(scanned, dig)} ${unitLabel}`, style: "cellR" }],
        [{ text: "Belum ditemukan", style: "cellRed" }, { text: fmtNum(tot.unscannedCount), style: "cellRedR" }, { text: `${fmtNum(unscanned, dig)} ${unitLabel}`, style: "cellRedR" }],
      ],
    },
    layout: tblLayout(true),
    style: "summaryTbl",
  });

  // === LABEL BELUM DITEMUKAN ===
  if (unscannedTotalRecords > 0) {
    content.push({ text: "Label Belum Ditemukan", style: "h2" });
    content.push({
      text: `${fmtNum(tot.unscannedCount)} dari ${fmtNum(tot.labelCount)} label tidak ditemukan, setara ${fmtNum(unscanned, dig)} ${unitLabel}`,
      style: "callout",
    });

    const printedUnscanned = unscannedData.slice(0, MAX_UNSCANNED_ROWS_PRINTED);
    content.push({
      table: {
        headerRows: 1,
        widths: ["auto", "*", "auto", "auto"],
        body: [
          [
            { text: "No. Label / Tgl", style: "hdrCell" },
            { text: "Jenis", style: "hdrCell" },
            { text: "Tercatat", style: "hdrCellC" },
            { text: unitH, style: "hdrCellR" },
          ],
          ...printedUnscanned.map((r) => [
            labelCell(r),
            { text: r.typeName || "-", style: "cell" },
            { text: locLabel(r.blok, r.locationId), style: "cellC" },
            { text: fmtNum(isPcsMetric ? (r.pcs ?? 0) : (r.weight ?? 0), dig), style: "cellR" },
          ]),
          [
            { text: `TOTAL (${fmtNum(unscannedTotalRecords)} label)`, style: "cell" },
            { text: "", style: "cell" },
            { text: "", style: "cellC" },
            { text: fmtNum(unscanned, dig), style: "cellR" },
          ],
        ],
      },
      layout: tblLayout(true),
      style: "summaryTbl",
    });

    if (unscannedTotalRecords > printedUnscanned.length) {
      content.push({
        text: `Menampilkan ${fmtNum(printedUnscanned.length)} dari ${fmtNum(unscannedTotalRecords)} label belum ditemukan.`,
        style: "note",
      });
    }
  } else {
    content.push({ text: "Label Belum Ditemukan", style: "h2" });
    content.push({ text: "Seluruh label ditemukan saat opname.", style: "callout" });
  }

  // === SCAN DI LOKASI BERBEDA ===
  const mismatches = locationMatch?.mismatches || [];
  const mismatchTotal = locationMatch?.mismatchCount ?? mismatches.length;
  content.push({ text: "Scan di Lokasi Berbeda", style: "h2" });
  if (mismatchTotal > 0) {
    content.push({
      text: `${fmtNum(mismatchTotal)} label discan di lokasi berbeda dari catatan sistem.`,
      style: "callout",
    });
    const rows = mismatches;
    content.push({
      table: {
        headerRows: 1,
        widths: ["auto", "*", "auto", "auto", "auto", "auto", "auto"],
        body: [
          [
            { text: "No. Label / Tgl", style: "hdrCell" },
            { text: "Jenis", style: "hdrCell" },
            { text: "Tercatat", style: "hdrCellC" },
            { text: "Discan", style: "hdrCellC" },
            { text: "User", style: "hdrCell" },
            { text: "Waktu", style: "hdrCellC" },
            { text: unitH, style: "hdrCellR" },
          ],
          ...rows.map((r) => [
            labelCell(r),
            { text: r.typeName || "-", style: "cell" },
            { text: locLabel(r.referenceBlok, r.referenceLocationId), style: "cellC" },
            { text: locLabel(r.scannedBlok, r.scannedLocationId), style: "cellRed" },
            { text: r.fullName || r.username || "-", style: "cell" },
            { text: fmtDateTime(r.scannedAt), style: "cellC" },
            { text: fmtNum(isPcsMetric ? (r.pcs ?? 0) : (r.weight ?? 0), dig), style: "cellR" },
          ]),
        ],
      },
      layout: tblLayout(true),
      style: "summaryTbl",
    });
    if (mismatchTotal > mismatches.length) {
      content.push({
        text: `Menampilkan ${fmtNum(mismatches.length)} dari ${fmtNum(mismatchTotal)} label salah lokasi.`,
        style: "note",
      });
    }
  } else {
    content.push({ text: "Seluruh label discan sesuai lokasi tercatat.", style: "callout" });
  }

  // === REKAP PER JENIS ===
  const perJenis = sortJenisBarangJadi(summary.perJenis || [], summary.categoryName);
  if (perJenis.length > 0) {
    content.push({ text: "Rekap per Jenis", style: "h2" });
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", "auto", "auto", "auto", "auto"],
        body: [
          [
            { text: "Jenis", style: "hdrCell" },
            { text: "Label", style: "hdrCellC" },
            { text: "Ditemukan", style: "hdrCellC" },
            { text: "Selisih", style: "hdrCellC" },
            { text: unitH, style: "hdrCellR" },
          ],
          ...perJenis.map((r) => [
            { text: r.typeName || `Jenis #${r.typeId ?? "-"}`, style: "cell" },
            { text: fmtNum(r.labelCount), style: "cellC" },
            { text: fmtNum(r.scannedCount), style: "cellC" },
            { text: fmtNum(r.unscannedCount), style: r.unscannedCount > 0 ? "cellRedR" : "cellC" },
            { text: qtyText(r, isPcsMetric, dig, unitLabel), style: "cellR" },
          ]),
        ],
      },
      layout: tblLayout(true),
      style: "summaryTbl",
    });
  }

  // === REKAP PER BLOK ===
  const perBlok = summary.perBlok || [];
  if (perBlok.length > 0) {
    content.push({ text: "Rekap per Blok", style: "h2" });
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", "auto", "auto", "auto", "auto", "auto"],
        body: [
          [
            { text: "Blok", style: "hdrCell" },
            { text: "Lokasi", style: "hdrCellC" },
            { text: "Label", style: "hdrCellC" },
            { text: "Ditemukan", style: "hdrCellC" },
            { text: "Selisih", style: "hdrCellC" },
            { text: unitH, style: "hdrCellR" },
          ],
          ...perBlok.map((r) => [
            { text: r.blok === "TIDAK_DIKETAHUI" ? "Tanpa Blok" : `Blok ${r.blok}`, style: "cell" },
            { text: fmtNum(r.locationCount), style: "cellC" },
            { text: fmtNum(r.labelCount), style: "cellC" },
            { text: fmtNum(r.scannedCount), style: "cellC" },
            { text: fmtNum(r.unscannedCount), style: r.unscannedCount > 0 ? "cellRedR" : "cellC" },
            { text: qtyText(r, isPcsMetric, dig, unitLabel), style: "cellR" },
          ]),
        ],
      },
      layout: tblLayout(true),
      style: "summaryTbl",
    });
  }

  // === AKTIVITAS USER ===
  const scanRows = scanSummary?.data || [];
  content.push({ text: "Aktivitas User", style: "h2" });
  if (scanRows.length > 0) {
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", "auto", "auto", "auto", "auto"],
        body: [
          [
            { text: "User", style: "hdrCell" },
            { text: "Label", style: "hdrCellC" },
            { text: unitH, style: "hdrCellR" },
            { text: "Scan Pertama", style: "hdrCellC" },
            { text: "Scan Terakhir", style: "hdrCellC" },
          ],
          ...scanRows.map((r) => [
            { text: r.fullName || r.username || "-", style: "cell" },
            { text: fmtNum(r.labelCount), style: "cellC" },
            { text: qtyText(r, isPcsMetric, dig, unitLabel), style: "cellR" },
            { text: fmtDateTime(r.firstScanAt), style: "cellC" },
            { text: fmtDateTime(r.lastScanAt), style: "cellC" },
          ]),
        ],
      },
      layout: tblLayout(true),
      style: "summaryTbl",
    });
  } else {
    content.push({ text: "Belum ada user yang melakukan scan.", style: "callout" });
  }

  return {
    content,
    styles,
    pageSize: "A4",
    pageMargins: [20, 40, 20, 50],
    defaultStyle: { fontSize: 9 },
    info: { title: `Laporan Stock Opname ${no}` },
    footer: (currentPage, pageCount) => ({
      text: `Halaman ${currentPage} dari ${pageCount}`,
      alignment: "center",
      fontSize: 7,
      color: "#94a3b8",
      margin: [0, 10, 0, 0],
    }),
  };
}

async function generatePdf({ summary, scanSummary, unscannedLabels, locationMatch }) {
  const docDef = buildReportDoc({ summary, scanSummary, unscannedLabels, locationMatch });
  const pdfDoc = pdfMake.createPdf(docDef);
  const buffer = await pdfDoc.getBuffer();
  return Buffer.from(buffer);
}

module.exports = { generatePdf, buildReportDoc };
