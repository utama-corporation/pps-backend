const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "broker-qc-label-pdf.html");

function buildBrokerQcLabelHtml(data) {
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  return templateHtml
    .replace(/{{noLabel}}/g, data.noLabel || "-")
    .replace("{{jenisPlastik}}", data.jenisPlastik || "-")
    .replace("{{density}}", data.density || "-")
    .replace("{{moisture}}", data.moisture || "-")
    .replace("{{mfi}}", data.mfi || "-")
    .replace("{{tanggal}}", data.tanggal || "-")
    .replace("{{createBy}}", data.createBy || "-")
    .replace("{{qrBase64}}", data.qrBase64 || "")
    .replace("{{watermarkText}}", data.watermarkText || "");
}

module.exports = { buildBrokerQcLabelHtml };
