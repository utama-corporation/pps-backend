// src/modules/laporan/barangdagang/barangdagang-route.js
const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./barangdagang-controller");

router.use(verifyToken, attachPermissions, requirePermission("laporan:read"));

// GET /api/laporan/barang-dagang/stok-v2?tglAkhir=YYYY-MM-DD&warehouse=ALL
router.get("/stok-v2", ctrl.stokBarangDagangV2DataHandler);

// GET /api/laporan/barang-dagang/stok-v2/pdf?tglAkhir=YYYY-MM-DD&warehouse=ALL
router.get(
  "/stok-v2/pdf",
  verifyToken,
  ctrl.stokBarangDagangV2PdfHandler,
);

module.exports = router;
