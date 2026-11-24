const service = require("./my-work-service");

exports.summary = async (req, res) => {
  try {
    const data = await service.getSummary({
      username: req.username,
      permissions: req.userPermissions,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("Error my-work summary:", err);
    res.status(500).json({ success: false, message: "Terjadi kesalahan di server" });
  }
};

exports.items = async (req, res) => {
  try {
    const data = await service.getItems({
      key: req.params.key,
      search: req.query.search,
      username: req.username,
      permissions: req.userPermissions,
    });
    if (!data) {
      return res.status(404).json({ success: false, message: "Antrian tidak ditemukan." });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error("Error my-work items:", err);
    res.status(500).json({ success: false, message: "Terjadi kesalahan di server" });
  }
};
