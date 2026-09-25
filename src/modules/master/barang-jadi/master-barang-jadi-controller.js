const service = require("./master-barang-jadi-service");

async function getAllActive(req, res) {
  const { username } = req;
  const search = String(req.query.search || req.query.namaBJ || "").trim();

  console.log(
    "Fetching MstBarangJadi (active only) | Username:",
    username,
  );

  try {
    const data = await service.getAllActive({ search });
    return res.status(200).json({
      success: true,
      message: "Data MstBarangJadi (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstBarangJadi (active):", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getStokProses(req, res) {
  try {
    const data = await service.getStokProses();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Stok Barang Jadi Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdBarangJadi(req, res) {
  try {
    const idBJ = parseInt(req.params.idbj, 10);

    if (!Number.isFinite(idBJ)) {
      return res.status(400).json({
        success: false,
        message: "idbj wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdBarangJadi(idBJ);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Barang Jadi By IdBJ Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdBarangJadi };
