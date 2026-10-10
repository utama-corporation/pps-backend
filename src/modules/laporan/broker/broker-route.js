// src/modules/laporan/broker/broker-route.js
const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./broker-controller");

router.use(verifyToken, attachPermissions, requirePermission("laporan:read"));


// GET /api/laporan/broker/stok-qc/pdf?tglAkhir=YYYY-MM-DD
router.get(
  "/stok-qc/pdf",
  verifyToken,
  ctrl.stokBrokerQcPdfHandler,
);

module.exports = router;