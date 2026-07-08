const service = require("./master-bonggolan-service");

async function getAllActive(req, res) {
  const { username } = req;
  console.log("Fetching master bonggolan (active only) | Username:", username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: "Data master bonggolan (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching master bonggolan (active):", error);
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
    console.error("Get Stok Bonggolan Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdBonggolan(req, res) {
  try {
    const idBonggolan = parseInt(req.params.idbonggolan, 10);

    if (!Number.isFinite(idBonggolan)) {
      return res.status(400).json({
        success: false,
        message: "idbonggolan wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdBonggolan(idBonggolan);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Bonggolan By IdBonggolan Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdBonggolan };
