// routes/mixer-production-route.js
const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const mixerProduksiController = require("./mixer-production-controller");

// Semua route modul produksi mixer butuh token + daftar permission user.
// Permission model: produksi_mixer:{read,create,update,delete}. Menambah /
// menghapus baris input & output serta complete/split dihitung sebagai
// perubahan terhadap produksi yang sudah ada → produksi_mixer:update.
// produksi_mixer:delete khusus menghapus header produksinya sendiri.
router.use(verifyToken, attachPermissions);

// GET MixerProduksi_h by date (YYYY-MM-DD)
router.get(
  "/mixer/:date(\\d{4}-\\d{2}-\\d{2})",
  requirePermission("produksi_mixer:read"),
  mixerProduksiController.getProduksiByDate,
);

// GET /mixer?page=1&pageSize=20&search=M.0000...
router.get(
  "/mixer",
  requirePermission("produksi_mixer:read"),
  mixerProduksiController.getAllProduksi,
);

router.post(
  "/mixer",
  requirePermission("produksi_mixer:create"),
  mixerProduksiController.createProduksi,
);

router.patch(
  "/mixer/:noProduksi/complete",
  requirePermission("produksi_mixer:update"),
  mixerProduksiController.completeProduksi,
);

// Batalkan complete: IsComplete 1 -> 0 (produksi bisa diedit lagi).
router.patch(
  "/mixer/:noProduksi/uncomplete",
  requirePermission("produksi_mixer:update"),
  mixerProduksiController.uncompleteProduksi,
);

router.put(
  "/mixer/:noProduksi",
  requirePermission("produksi_mixer:update"),
  mixerProduksiController.updateProduksi,
);

router.delete(
  "/mixer/:noProduksi",
  requirePermission("produksi_mixer:delete"),
  mixerProduksiController.deleteProduksi,
);

router.get(
  "/mixer/:noProduksi/inputs",
  requirePermission("produksi_mixer:read"),
  mixerProduksiController.getInputsByNoProduksi,
);

router.get(
  "/mixer/:noProduksi/outputs",
  requirePermission("produksi_mixer:read"),
  mixerProduksiController.getOutputsByNoProduksi,
);

router.get(
  "/mixer/validate-label/:labelCode",
  requirePermission("produksi_mixer:read"),
  mixerProduksiController.validateLabel,
);

router.post(
  "/mixer/:noProduksi/inputs",
  requirePermission("produksi_mixer:update"),
  mixerProduksiController.upsertInputsAndPartials,
);

router.delete(
  "/mixer/:noProduksi/inputs",
  requirePermission("produksi_mixer:update"),
  mixerProduksiController.deleteInputsAndPartials,
);

router.post(
  "/mixer/split-time/:idMesin/:tanggal",
  requirePermission("produksi_mixer:update"),
  mixerProduksiController.splitProduksiTime,
);

module.exports = router;
