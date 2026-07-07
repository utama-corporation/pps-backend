const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");

const ctrl = require("./master-bahan-baku-controller");

router.use(verifyToken, attachPermissions);

// ⚠️ route statis harus didaftarkan sebelum route berparameter (:idbahanbaku)
router.get(
  "/master/bahan-baku/proses/stok",
  requirePermission("penerimaanbahanbaku:read"), // sesuaikan permission-mu
  ctrl.getStokProses,
);

router.get(
  "/master/bahan-baku/proses/:idbahanbaku/label",
  requirePermission("penerimaanbahanbaku:read"), // sesuaikan permission-mu
  ctrl.getLabelByIdBahanBaku,
);

module.exports = router;
