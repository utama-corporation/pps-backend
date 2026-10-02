const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "barang-dagang-label-pdf.html");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 1.250 / 1.250,5 pcs — pemisah ribuan titik & desimal koma (format Indonesia)
function formatQty(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";

  const rounded = Math.round(parsed * 100) / 100;
  const [intPart, decPart] = String(Math.abs(rounded)).split(".");
  const int = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const num = `${rounded < 0 ? "-" : ""}${int}${decPart ? `,${decPart}` : ""}`;

  return `${num} pcs`;
}

function formatTanggal(value) {
  if (!value) return "-";

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);

  return `${dd}/${mm}/${yy}`;
}

function buildMetaRows(data) {
  const lokasi = String(data.lokasi == null ? "" : data.lokasi).trim();
  const by = String(data.createBy == null ? "" : data.createBy).trim();

  return [
    lokasi
      ? `<span class="lokasi"><span class="lbl">Lokasi</span>&nbsp;<span class="val">${escapeHtml(
          lokasi,
        )}</span></span>`
      : "",
    by
      ? `<span class="by">By&nbsp;: <span class="val">${escapeHtml(by)}</span></span>`
      : "",
  ]
    .filter(Boolean)
    .join("");
}

function buildBarangDagangLabelHtml(data) {
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const values = {
    noLabel: escapeHtml(data.noLabel || "-"),
    namaProduk: escapeHtml(data.namaProduk || "-"),
    qty: escapeHtml(formatQty(data.qty)),
    batchCode: escapeHtml(data.batchCode || data.tanggal || "-"),
    createdDate: escapeHtml(formatTanggal(data.createdAt)),
    metaRows: buildMetaRows(data),
    qrBase64: data.qrBase64 || "",
    watermarkText: escapeHtml(data.watermarkText || ""),
  };

  return templateHtml.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "",
  );
}

module.exports = { buildBarangDagangLabelHtml };
