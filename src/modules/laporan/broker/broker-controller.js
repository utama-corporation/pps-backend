// src/modules/laporan/broker/broker-controller.js
const brokerService = require("./broker-service");

async function stokBrokerQcPdfHandler(req, res) {
  const tglAkhir = String(req.query.tglAkhir || "").trim();

  console.log(
    "Generating Laporan Stok Broker QC PDF | Username:",
    req.username,
    "| tglAkhir:",
    tglAkhir,
  );

  try {
    const pdfBuffer = await brokerService.getStokBrokerQcPdf({ tglAkhir });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Laporan-Stok-Broker-QC-${tglAkhir}.pdf"`,
    );
    return res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error("Error generating Laporan Stok Broker QC PDF:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
}

const STOK_QC_COLUMNS = [
  { key: "NoBroker", label: "No. Broker" },
  { key: "DateCreate", label: "Tanggal" },
  { key: "Jenis", label: "Jenis" },
  { key: "JmlhSak", label: "Jml Sak" },
  { key: "Berat", label: "Berat (Kg)" },
  { key: "Moisture", label: "Moisture" },
  { key: "Moisture2", label: "Moisture 2" },
  { key: "Moisture3", label: "Moisture 3" },
  { key: "Density", label: "Density" },
  { key: "Density2", label: "Density 2" },
  { key: "Density3", label: "Density 3" },
  { key: "MFI", label: "MFI" },
];

async function stokBrokerQcDataHandler(req, res) {
  const tglAkhir = String(req.query.tglAkhir || "").trim();

  try {
    const rows = await brokerService.getStokBrokerQcRows(tglAkhir);

    return res.status(200).json({
      success: true,
      periode: { tglAkhir },
      columns: STOK_QC_COLUMNS,
      rows,
      totalRows: rows.length,
    });
  } catch (error) {
    console.error("Error generating Stok Broker QC JSON:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
}

module.exports = {
  stokBrokerQcPdfHandler,
  stokBrokerQcDataHandler,
};