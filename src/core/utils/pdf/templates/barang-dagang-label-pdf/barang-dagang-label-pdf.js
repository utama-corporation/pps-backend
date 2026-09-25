const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "barang-dagang-label-pdf.html");

function formatQty(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const base = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${base} pcs`;
}

function buildBarangDagangLabelHtml(data) {
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  return templateHtml
    .replace(/{{noLabel}}/g, data.noLabel || "-")
    .replace("{{namaProduk}}", data.namaProduk || "-")
    .replace("{{qty}}", formatQty(data.qty))
    .replace("{{tanggal}}", data.tanggal || "-")
    .replace("{{createBy}}", data.createBy || "-")
    .replace("{{qrBase64}}", data.qrBase64 || "")
    .replace("{{watermarkText}}", data.watermarkText || "");
}

module.exports = { buildBarangDagangLabelHtml };
