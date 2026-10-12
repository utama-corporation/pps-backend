// src/modules/laporan/barangjadi/barangjadi-controller.js
const service = require("./barangjadi-service");

async function stokBarangJadiV2PdfHandler(req, res) {
  const tglAkhir = String(req.query.tglAkhir || "").trim();

  console.log(
    "Generating Laporan Stock Barang Jadi V2 PDF | Username:",
    req.username,
    "| tglAkhir:",
    tglAkhir,
  );

  try {
    const buffer = await service.getStokBarangJadiV2Pdf({
      tglAkhir,
      username: req.username,
    });

    res.setHeader("Content-Type", "application/pdf");
    // inline = tampil di browser, bukan diunduh.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Stock-Barang-Jadi-V2-${tglAkhir}.pdf"`,
    );
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error generating Laporan Stock Barang Jadi V2 PDF:", error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Internal Server Error" : error.message,
      ...(statusCode === 500 ? { error: error.message } : {}),
    });
  }
}

module.exports = {
  stokBarangJadiV2PdfHandler,
};
