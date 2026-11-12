const service = require("./favorit-service");

const TIPE_VALID = new Set(["laporan", "menu"]);

const isValid = (tipe, kode) =>
  typeof tipe === "string" &&
  TIPE_VALID.has(tipe) &&
  typeof kode === "string" &&
  kode.length > 0 &&
  kode.length <= 200;

const fail = (res, err, label) => {
  console.error(`Error favorit ${label}:`, err);
  res.status(500).json({ success: false, message: "Terjadi kesalahan di server" });
};

exports.list = async (req, res) => {
  try {
    const data = await service.list(req.idUsername);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, "list");
  }
};

exports.add = async (req, res) => {
  const { tipe, kode, komentar } = req.body || {};
  if (komentar != null && (typeof komentar !== "string" || komentar.length > 500)) {
    return res.status(400).json({ success: false, message: "Komentar maksimal 500 karakter." });
  }
  if (!isValid(tipe, kode)) {
    return res.status(400).json({ success: false, message: "tipe/kode tidak valid." });
  }
  try {
    await service.add(req.idUsername, tipe, kode, komentar?.trim() || null);
    res.status(201).json({ success: true, message: "Favorit ditambahkan." });
  } catch (err) {
    fail(res, err, "add");
  }
};

exports.remove = async (req, res) => {
  const { tipe, kode } = req.params;
  if (!isValid(tipe, kode)) {
    return res.status(400).json({ success: false, message: "tipe/kode tidak valid." });
  }
  try {
    await service.remove(req.idUsername, tipe, kode);
    res.json({ success: true, message: "Favorit dihapus." });
  } catch (err) {
    fail(res, err, "remove");
  }
};

exports.reorder = async (req, res) => {
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || !items.every((i) => i && isValid(i.tipe, i.kode))) {
    return res.status(400).json({ success: false, message: "items tidak valid." });
  }
  try {
    await service.reorder(req.idUsername, items);
    res.json({ success: true, message: "Urutan disimpan." });
  } catch (err) {
    fail(res, err, "reorder");
  }
};
