const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const ctrl = require("./master-cetakan-controller");

// GET only active (Enable = 1) — dipakai service lain, tanpa permission
router.get("/", verifyToken, ctrl.getAllActive);

// Master Cetakan Warna Material (form FrmCetakan.vb) — permission datamastercetakan:*
router.get(
  "/warna-material/options",
  verifyToken,
  attachPermissions,
  requirePermission("datamastercetakan:read"),
  ctrl.getOptions,
);
router.get(
  "/warna-material",
  verifyToken,
  attachPermissions,
  requirePermission("datamastercetakan:read"),
  ctrl.listWarnaMaterial,
);
router.get(
  "/warna-material/detail",
  verifyToken,
  attachPermissions,
  requirePermission("datamastercetakan:read"),
  ctrl.getDetail,
);
router.post(
  "/warna-material",
  verifyToken,
  attachPermissions,
  requirePermission("datamastercetakan:create"),
  ctrl.createWarnaMaterial,
);
router.put(
  "/warna-material",
  verifyToken,
  attachPermissions,
  requirePermission("datamastercetakan:update"),
  ctrl.updateWarnaMaterial,
);
router.delete(
  "/warna-material",
  verifyToken,
  attachPermissions,
  requirePermission("datamastercetakan:delete"),
  ctrl.removeWarnaMaterial,
);

module.exports = router;
