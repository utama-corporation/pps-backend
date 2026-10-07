// master-regu-route.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./master-regu-controller");

// List regu
// Query: ?q=nama&idBagian=1&orderBy=NamaRegu&orderDir=ASC
router.get("/regu", verifyToken, ctrl.list);
// Detail regu (header + daftar operator)
router.get("/regu/:id", verifyToken, ctrl.getById);

// CRUD Master Regu — permission datamasteroperator:{create,update,delete}
// (satu paket dengan Master Operator di form FrmMstOperatorRegu)
router.post(
  "/regu",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:create"),
  ctrl.create,
);
router.put(
  "/regu/:id",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:update"),
  ctrl.update,
);
router.delete(
  "/regu/:id",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:delete"),
  ctrl.remove,
);

module.exports = router;
