const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const ctrl = require("./user-lokasi-access-controller");

router.use(verifyToken, attachPermissions);

// Daftar semua user (dipakai FE utk pilih user saat assign akses lokasi).
router.get(
  "/user-lokasi-access/users",
  requirePermission("stockopname:create"),
  ctrl.listAllUsersHandler,
);

router.get(
  "/user-lokasi-access/blok/:blok/lokasi/:idLokasi",
  requirePermission("stockopname:create"),
  ctrl.listUsersByLokasiHandler,
);

router.get(
  "/user-lokasi-access/user/:idUsername",
  requirePermission("stockopname:create"),
  ctrl.listLokasiByUserHandler,
);

router.post(
  "/user-lokasi-access",
  requirePermission("stockopname:create"),
  ctrl.assignAccessHandler,
);

router.delete(
  "/user-lokasi-access/:blok/:idLokasi/:idUsername",
  requirePermission("stockopname:create"),
  ctrl.revokeAccessHandler,
);

module.exports = router;
