const service = require("./master-broker-service");

async function getAllActive(req, res) {
  const { username } = req;
  console.log("🔍 Fetching MstBroker (active only) | Username:", username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: "Data MstBroker (active) berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstBroker (active):", error);
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
    console.error("Get Stok Broker Proses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

async function getLabelByIdBroker(req, res) {
  try {
    const idBroker = parseInt(req.params.idbroker, 10);

    if (!Number.isFinite(idBroker)) {
      return res.status(400).json({
        success: false,
        message: "idbroker wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdBroker(idBroker);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Broker By IdBroker Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdBroker };
