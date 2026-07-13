const service = require("./master-furniture-wip-service");

async function getAllActive(req, res) {
  const { username } = req;
  console.log(
    "Fetching master furniture-wip (active only) | Username:",
    username,
  );

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: "Data master furniture-wip (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching master furniture-wip (active):", error);
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
    console.error("Get Stok Furniture WIP Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdFurnitureWip(req, res) {
  try {
    const idFurnitureWip = parseInt(req.params.idfurniturewip, 10);

    if (!Number.isFinite(idFurnitureWip)) {
      return res.status(400).json({
        success: false,
        message: "idfurniturewip wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdFurnitureWip(idFurnitureWip);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Furniture WIP By IdFurnitureWip Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdFurnitureWip };
