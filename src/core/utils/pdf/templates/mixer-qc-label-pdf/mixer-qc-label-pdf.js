const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "mixer-qc-label-pdf.html");

/**
 * Template label QC Mixer.
 *
 * Data yang dibutuhkan:
 *   noLabel, jenisPlastik, moisture, meltTemp, mfi, visualNote,
 *   tanggal, createBy, watermarkText
 */
function buildMixerQcLabelHtml(data) {
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  return templateHtml
    .replace(/{{noLabel}}/g, data.noLabel || "-")
    .replace("{{jenisPlastik}}", data.jenisPlastik || "-")
    .replace("{{moisture}}", data.moisture || "-")
    .replace("{{meltTemp}}", data.meltTemp || "-")
    .replace("{{mfi}}", data.mfi || "-")
    .replace("{{visualNote}}", data.visualNote || "-")
    .replace("{{tanggal}}", data.tanggal || "-")
    .replace("{{createBy}}", data.createBy || "-")
    .replace("{{watermarkText}}", data.watermarkText || "");
}

module.exports = { buildMixerQcLabelHtml };