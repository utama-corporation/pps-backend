// routes/return-production-route.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const returnController = require("./return-production-controller");

// ✅ GET ALL (paging + search + optional date range)
// Example: GET /api/return?page=1&pageSize=20&search=RT.0001&dateFrom=2025-12-01&dateTo=2025-12-31
router.get("/return", verifyToken, returnController.getAllReturns);

// GET BJRetur_h by date (YYYY-MM-DD)
// Example: GET /api/returns/2025-12-02
router.get(
  "/return/:date(\\d{4}-\\d{2}-\\d{2})",
  verifyToken,
  returnController.getReturnsByDate,
);

router.post("/return", verifyToken, returnController.createReturn);

// routes/return-production-route.js
router.put("/return/:noRetur", verifyToken, returnController.updateReturn);

// routes/return-production-route.js
router.delete("/return/:noRetur", verifyToken, returnController.deleteReturn);

// ✅ GET ALL outputs (furniture-wip + barang-jadi) untuk satu noRetur
// Example: GET /api/return/RT.0001/outputs
router.get(
  "/return/:noRetur/outputs",
  verifyToken,
  returnController.getAllOutputsByNoRetur,
);

router.get(
  "/return/:noRetur/outputs/furniture-wip",
  verifyToken,
  returnController.getOutputsFurnitureWipByNoRetur,
);

router.get(
  "/return/:noRetur/outputs/barang-jadi",
  verifyToken,
  returnController.getOutputsBarangJadiByNoRetur,
);

// GET /api/production/return/import-as-gsu/:date - fetch data from AS_GSU
router.get(
  "/return/import-as-gsu/:date(\\d{4}-\\d{2}-\\d{2})",
  verifyToken,
  returnController.getImportAsGsuByDate,
);

// GET /api/production/return/import-as-gsu-after
// Fetch AS_GSU data with InvoiceDate strictly after the fixed cutoff date.
router.get(
  "/return/import-as-gsu-after",
  verifyToken,
  returnController.getImportAsGsuAfterDate,
);

// POST /api/production/return/import-as-gsu - import selected items
router.post("/return/import-as-gsu", verifyToken, returnController.importAsGsu);

module.exports = router;
