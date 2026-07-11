const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./master-mixer-controller");

router.use(verifyToken, attachPermissions);

router.get(
  "/stok",
  requirePermission("penerimaanbahanbaku:read"),
  ctrl.getStokProses,
);

router.get(
  "/:idmixer/label",
  requirePermission("penerimaanbahanbaku:read"),
  ctrl.getLabelByIdMixer,
);

// GET only active (Enable = 1)
router.get("/", ctrl.getAllActive);

module.exports = router;
