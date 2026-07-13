const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./master-washing-controller");

router.use(verifyToken, attachPermissions);

router.get(
  "/stok",
  requirePermission("penerimaanbahanbaku:read"),
  ctrl.getStokProses,
);

router.get(
  "/:idwashing/label",
  requirePermission("penerimaanbahanbaku:read"),
  ctrl.getLabelByIdWashing,
);

// GET only active (IsEnable = 1)
router.get("/", ctrl.getAllActive);

module.exports = router;
