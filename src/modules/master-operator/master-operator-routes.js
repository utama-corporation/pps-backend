const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const ctrl = require("./master-operator-controller");

// List operators (active only by default)
// Query: ?includeDisabled=1&q=ana&orderBy=NamaOperator&orderDir=ASC
// Master Operator page: ?all=1&q=ana (semua status + kolom bagian)
router.get("/", verifyToken, ctrl.list);
// Daftar bagian mesin (untuk dropdown form operator & regu)
router.get(
  "/bagian",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:read"),
  ctrl.listBagian,
);
// List operator by regu
router.get("/regu/:idregu", verifyToken, ctrl.listByIdRegu);

// CRUD Master Operator — permission datamasteroperator:{create,update,delete}
router.post(
  "/",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:create"),
  ctrl.create,
);
router.put(
  "/:id",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:update"),
  ctrl.update,
);
router.delete(
  "/:id",
  verifyToken,
  attachPermissions,
  requirePermission("datamasteroperator:delete"),
  ctrl.remove,
);

module.exports = router;
