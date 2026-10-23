// src/modules/laporan/barangjadi/barangjadi-route.js
const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./barangjadi-controller");

router.use(verifyToken, attachPermissions, requirePermission("laporan:read"));

// GET /api/laporan/barang-jadi/stok-v2?tglAkhir=YYYY-MM-DD
router.get("/stok-v2", ctrl.stokBarangJadiV2DataHandler);

// GET /api/laporan/barang-jadi/stok-v2/pdf?tglAkhir=YYYY-MM-DD
router.get("/stok-v2/pdf", verifyToken, ctrl.stokBarangJadiV2PdfHandler);

// GET /api/laporan/barang-jadi/hasil-produksi/pdf?tglAwal=YYYY-MM-DD&tglAkhir=YYYY-MM-DD
router.get("/hasil-produksi/pdf", verifyToken, ctrl.hasilProduksiPdfHandler);

module.exports = router;
