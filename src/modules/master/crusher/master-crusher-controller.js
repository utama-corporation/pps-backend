const service = require("./master-crusher-service");

async function getAllActive(req, res) {
  const { username } = req;
  console.log("Fetching master crusher (active only) | Username:", username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: "Data master crusher (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching master crusher (active):", error);
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
    console.error("Get Stok Crusher Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdCrusher(req, res) {
  try {
    const idCrusher = parseInt(req.params.idcrusher, 10);

    if (!Number.isFinite(idCrusher)) {
      return res.status(400).json({
        success: false,
        message: "idcrusher wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdCrusher(idCrusher);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Crusher By IdCrusher Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdCrusher };
