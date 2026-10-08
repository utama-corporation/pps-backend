const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./crusher-production-controller");

router.get("/crusher", verifyToken, ctrl.getAllProduksi);

// GET CrusherProduksi_h by date (YYYY-MM-DD)
router.get(
  "/crusher/:date(\\d{4}-\\d{2}-\\d{2})",
  verifyToken,
  ctrl.getProduksiByDate,
);

// GET master crushers (enabled only, for dropdowns)
router.get("/crusher/masters", verifyToken, ctrl.getCrusherMasters);

router.post("/crusher", verifyToken, ctrl.createProduksi);

// POST /crusher/split-time/:idMesin/:tanggal
router.post(
  "/crusher/split-time/:idMesin/:tanggal",
  verifyToken,
  ctrl.splitProduksiTime,
);

// Kunci produksi: IsComplete 0 -> 1. Butuh permission produksi_crusher:lock.
router.patch(
  "/crusher/:noCrusherProduksi/complete",
  verifyToken,
  attachPermissions,
  requirePermission("produksi_crusher:lock"),
  ctrl.completeProduksi,
);

// Buka kunci: IsComplete 1 -> 0 (produksi bisa diedit lagi).
router.patch(
  "/crusher/:noCrusherProduksi/uncomplete",
  verifyToken,
  attachPermissions,
  requirePermission("produksi_crusher:lock"),
  ctrl.uncompleteProduksi,
);

router.put("/crusher/:noCrusherProduksi", verifyToken, ctrl.updateProduksi); // ⬅️ NEW

router.delete("/crusher/:noCrusherProduksi", verifyToken, ctrl.deleteProduksi); // ⬅️ NEW

router.get(
  "/crusher/:noCrusherProduksi/inputs",
  verifyToken,
  ctrl.getInputsByNoCrusherProduksi,
);

router.get(
  "/crusher/:noCrusherProduksi/formula-inputs",
  verifyToken,
  ctrl.getFormulaInputsByNoCrusherProduksi,
);

router.get(
  "/crusher/:noCrusherProduksi/outputs",
  verifyToken,
  ctrl.getOutputsByNoCrusherProduksi,
);

router.get(
  "/crusher/validate-label/:labelCode",
  verifyToken,
  ctrl.validateLabel,
); // ⬅️ NEW

router.post(
  "/crusher/:noCrusherProduksi/inputs",
  verifyToken,
  ctrl.upsertInputsAndPartials,
); // ⬅️ NEW

router.delete(
  "/crusher/:noCrusherProduksi/inputs",
  verifyToken,
  ctrl.deleteInputsAndPartials,
); // ⬅️ NEW

router.get(
  "/crusher/:noCrusherProduksi/report/pdf",
  verifyToken,
  ctrl.exportReportPdf,
);

module.exports = router;
