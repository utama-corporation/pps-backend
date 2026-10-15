// routes/penjualan-route.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const penjualanController = require("./penjualan-controller");

router.get(
  "/",
  verifyToken,
  attachPermissions,
  requirePermission("penjualan:read"),
  penjualanController.getHeaders,
);

router.get(
  "/:noBJJual",
  verifyToken,
  attachPermissions,
  requirePermission("penjualan:read"),
  penjualanController.getHeaderDetail,
);

router.post(
  "/:noBJJual/scan",
  verifyToken,
  attachPermissions,
  requirePermission("penjualan:create"),
  penjualanController.scanLabel,
);

router.post(
  "/:noBJJual/items",
  verifyToken,
  attachPermissions,
  requirePermission("penjualan:create"),
  penjualanController.addItem,
);

router.patch(
  "/:noBJJual/items",
  verifyToken,
  attachPermissions,
  requirePermission("penjualan:create"),
  penjualanController.updateItem,
);

router.delete(
  "/:noBJJual/items",
  verifyToken,
  attachPermissions,
  requirePermission("penjualan:create"),
  penjualanController.deleteItem,
);

module.exports = router;
