const masterKategoriService = require("./master-kategori-service");

async function getKategori(req, res) {
  const { username } = req;
  console.log("Fetching all kategori | Username:", username);

  try {
    const data = await masterKategoriService.getAllKategori();

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data kategori tidak ditemukan",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: "Data kategori berhasil diambil",
      data,
      totalData: data.length,
    });
  } catch (error) {
    console.error("Error fetching kategori:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

module.exports = { getKategori };
