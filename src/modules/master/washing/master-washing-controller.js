const service = require("./master-washing-service");

async function getAllActive(req, res) {
  const { username } = req;
  console.log("Fetching master washing (active only) | Username:", username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: "Data master washing (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching master washing (active):", error);
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
    console.error("Get Stok Washing Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdWashing(req, res) {
  try {
    const idWashing = parseInt(req.params.idwashing, 10);

    if (!Number.isFinite(idWashing)) {
      return res.status(400).json({
        success: false,
        message: "idwashing wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdWashing(idWashing);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Washing By IdWashing Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdWashing };
