const service = require("./master-mixer-service");

async function getAllActive(req, res) {
  const { username } = req;
  console.log("Fetching master mixer (active only) | Username:", username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: "Data master mixer (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching master mixer (active):", error);
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
    console.error("Get Stok Mixer Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdMixer(req, res) {
  try {
    const idMixer = parseInt(req.params.idmixer, 10);

    if (!Number.isFinite(idMixer)) {
      return res.status(400).json({
        success: false,
        message: "idmixer wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdMixer(idMixer);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Mixer By IdMixer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdMixer };
