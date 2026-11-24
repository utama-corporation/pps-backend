const service = require("./kpi-service");

const pad2 = (n) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

exports.kpi = async (req, res) => {
  const tanggal = String(req.query.tanggal ?? "").trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return res
      .status(400)
      .json({ success: false, message: "Parameter tanggal wajib berformat YYYY-MM-DD." });
  }
  try {
    const data = await service.getKpi({ tanggal, permissions: req.userPermissions });
    if (!data) {
      return res.status(400).json({ success: false, message: "Tanggal tidak valid." });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error("Error kpi:", err);
    res.status(500).json({ success: false, message: "Terjadi kesalahan di server" });
  }
};
