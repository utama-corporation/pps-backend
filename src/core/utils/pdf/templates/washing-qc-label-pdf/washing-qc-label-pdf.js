const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "washing-qc-label-pdf.html");

// Mirror broker-qc-label-pdf.js. Bedanya hanya jumlah metrik: Washing_h tidak
// punya kolom MFI (broker punya), jadi QC washing hanya Density + Moisture.
function buildWashingQcLabelHtml(data) {
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  return templateHtml
    .replace(/{{noLabel}}/g, data.noLabel || "-")
    .replace("{{jenisPlastik}}", data.jenisPlastik || "-")
    .replace("{{density}}", data.density || "-")
    .replace("{{moisture}}", data.moisture || "-")
    .replace("{{tanggal}}", data.tanggal || "-")
    .replace("{{createBy}}", data.createBy || "-")
    .replace("{{qrBase64}}", data.qrBase64 || "")
    .replace("{{watermarkText}}", data.watermarkText || "");
}

module.exports = { buildWashingQcLabelHtml };