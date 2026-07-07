// routes/inject-production-route.js
const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const injectProduksiController = require("./inject-production-controller");

// ✅ GET ALL InjectProduksi_h (paged)
router.get("/inject", verifyToken, injectProduksiController.getAllProduksi);

// 🔹 GET Furniture WIP from InjectProduksi_h by NoProduksi
router.get(
  "/inject/furniture-wip/:noProduksi",
  verifyToken,
  injectProduksiController.getFurnitureWipByNoProduksi,
);

// 🔹 GET Barang Jadi (Packing) from InjectProduksi_h by NoProduksi
router.get(
  "/inject/packing/:noProduksi",
  verifyToken,
  injectProduksiController.getPackingByNoProduksi,
);

router.get(
  "/inject/pcs-per-label/:noProduksi",
  verifyToken,
  injectProduksiController.getPcsPerLabelByNoProduksi,
);

router.get(
  "/inject/batch/:noProduksi",
  verifyToken,
  injectProduksiController.getBatchByNoProduksi,
);

// ⚠️ Daftarkan SEBELUM "/inject/qc/:noProduksi" agar "counter" tidak
// tertangkap sebagai :noProduksi.
router.get(
  "/inject/qc/counter",
  verifyToken,
  injectProduksiController.getQcCounters,
);

// ⚠️ Daftarkan SEBELUM "/inject/qc/counter/:idMesin" agar "by-produksi"
// tidak tertangkap sebagai :idMesin.
router.get(
  "/inject/qc/counter/by-produksi/:noProduksi",
  verifyToken,
  injectProduksiController.getQcCounterByProduksi,
);

router.get(
  "/inject/qc/counter/:idMesin",
  verifyToken,
  injectProduksiController.getQcCounterByMesin,
);

router.post(
  "/inject/qc/counter/:idMesin/reset",
  verifyToken,
  injectProduksiController.resetQcCounter,
);

router.get(
  "/inject/qc/:noProduksi",
  verifyToken,
  injectProduksiController.getQcByNoProduksi,
);

router.get(
  "/inject/:noProduksi/formula-inputs",
  verifyToken,
  injectProduksiController.getFormulaInputsByNoProduksi,
);

router.get(
  "/inject/:noProduksi/validate-label/:labelCode",
  verifyToken,
  injectProduksiController.validateInputLabelForNoProduksi,
);

// 🔹 GET InjectProduksi_h by date (YYYY-MM-DD)
// ⚠️ keep this LAST so it doesn't conflict with /inject (list)
router.get(
  "/inject/:date(\\d{4}-\\d{2}-\\d{2})",
  verifyToken,
  injectProduksiController.getProduksiByDate,
);

router.post("/inject", verifyToken, injectProduksiController.createProduksi);

router.post("/inject/batch", verifyToken, injectProduksiController.submitBatch);

router.post(
  "/inject/:noProduksi/terminate",
  verifyToken,
  injectProduksiController.terminateInjectProduksi,
);

router.patch(
  "/inject/:noProduksi/complete",
  verifyToken,
  injectProduksiController.completeProduksi,
);

router.post("/inject/qc", verifyToken, injectProduksiController.createQc);

router.put("/inject/qc/:id", verifyToken, injectProduksiController.updateQc);

router.post(
  "/inject/split-time/:idMesin/:tanggal",
  verifyToken,
  injectProduksiController.splitProduksiTime,
);

router.put(
  "/inject/:noProduksi",
  verifyToken,
  injectProduksiController.updateProduksi,
);

router.delete(
  "/inject/:noProduksi",
  verifyToken,
  injectProduksiController.deleteProduksi,
);

router.get(
  "/inject/:noProduksi/inputs",
  verifyToken,
  injectProduksiController.getInputsByNoProduksi,
);

router.get(
  "/inject/:noProduksi/outputs",
  verifyToken,
  injectProduksiController.getOutputsByNoProduksi,
);

router.get(
  "/inject/:noProduksi/outputs/bonggolan",
  verifyToken,
  injectProduksiController.getOutputsBonggolanByNoProduksi,
);

router.get(
  "/inject/:noProduksi/outputs/furniture-wip",
  verifyToken,
  injectProduksiController.getOutputsFurnitureWipByNoProduksi,
);

router.get(
  "/inject/:noProduksi/outputs/barang-jadi",
  verifyToken,
  injectProduksiController.getOutputsPackingByNoProduksi,
);

router.get(
  "/inject/:noProduksi/outputs/reject",
  verifyToken,
  injectProduksiController.getOutputsRejectByNoProduksi,
);

router.get(
  "/inject/validate-label/:labelCode",
  verifyToken,
  injectProduksiController.validateLabel,
);

router.post(
  "/inject/:noProduksi/inputs",
  verifyToken,
  injectProduksiController.upsertInputsAndPartials,
);

router.delete(
  "/inject/:noProduksi/inputs",
  verifyToken,
  injectProduksiController.deleteInputsAndPartials,
);

module.exports = router;
