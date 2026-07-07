const masterBahanBakuService = require("./master-bahan-baku-service");

// GET /master/bahan-baku/proses/stok
exports.getStokProses = async (req, res) => {
  try {
    const data = await masterBahanBakuService.getStokProses();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("Get Stok Bahan Baku Proses Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Terjadi kesalahan server" });
  }
};

// GET /master/bahan-baku/proses/:idbahanbaku/label
exports.getLabelByIdBahanBaku = async (req, res) => {
  try {
    const idBahanBaku = parseInt(req.params.idbahanbaku, 10);

    if (!Number.isFinite(idBahanBaku)) {
      return res.status(400).json({
        success: false,
        message: "idbahanbaku wajib berupa angka",
      });
    }

    const data =
      await masterBahanBakuService.getLabelByIdBahanBaku(idBahanBaku);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("Get Label Bahan Baku By IdBahanBaku Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Terjadi kesalahan server" });
  }
};
