const masterJenisService = require("./master-jenis-service");

async function getJenis(req, res) {
  const { username } = req;
  const idKategori = parseInt(req.query.idKategori, 10);

  console.log("Fetching jenis by kategori | Username:", username, "| IdKategori:", idKategori);

  if (!Number.isInteger(idKategori) || idKategori <= 0) {
    return res.status(400).json({
      success: false,
      message: "Parameter query 'idKategori' wajib berupa integer valid",
    });
  }

  try {
    const result = await masterJenisService.getJenisByKategori(idKategori);

    if (!result || result.jenis.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data jenis tidak ditemukan untuk kategori tersebut",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: `Data ${result.kategori.namaKategori} berhasil diambil`,
      kategori: result.kategori,
      data: result.jenis,
      totalData: result.jenis.length,
    });
  } catch (error) {
    console.error("Error fetching jenis by kategori:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

module.exports = { getJenis };
