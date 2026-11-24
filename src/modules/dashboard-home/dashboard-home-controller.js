const service = require("./dashboard-home-service");

exports.home = async (req, res) => {
  const range = Number.parseInt(req.query.range ?? "7", 10);
  if (!service.RANGES.includes(range)) {
    return res.status(400).json({
      success: false,
      message: `Parameter range harus salah satu dari ${service.RANGES.join(", ")}.`,
    });
  }
  try {
    const data = await service.getHome({
      permissions: req.userPermissions,
      range,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("Error dashboard home:", err);
    res.status(500).json({ success: false, message: "Terjadi kesalahan di server" });
  }
};
