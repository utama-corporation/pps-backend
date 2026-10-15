// src/modules/laporan/barangdagang/barangdagang-controller.js
const service = require("./barangdagang-service");

async function stokBarangDagangV2PdfHandler(req, res) {
  const tglAkhir = String(req.query.tglAkhir || "").trim();
  const warehouse = String(req.query.warehouse || "ALL").trim() || "ALL";

  console.log(
    "Generating Laporan Stock Barang Dagang V2 PDF | Username:",
    req.username,
    "| tglAkhir:",
    tglAkhir,
    "| warehouse:",
    warehouse,
  );

  try {
    const buffer = await service.getStokBarangDagangV2Pdf({
      tglAkhir,
      warehouse,
      username: req.username,
    });

    res.setHeader("Content-Type", "application/pdf");
    // inline = tampil di browser, bukan diunduh.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Stock-Barang-Dagang-V2-${tglAkhir}.pdf"`,
    );
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error(
      "Error generating Laporan Stock Barang Dagang V2 PDF:",
      error,
    );
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Internal Server Error" : error.message,
      ...(statusCode === 500 ? { error: error.message } : {}),
    });
  }
}

module.exports = {
  stokBarangDagangV2PdfHandler,
};
