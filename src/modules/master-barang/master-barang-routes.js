const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const ctrl = require("./master-barang-controller");

// Master Barang (FrmMstBahanBaku, FrmMstBarangJadi, ... FrmMstWashing) — permission datamasterbarang:*
router.use(verifyToken, attachPermissions);

router.get("/meta", requirePermission("datamasterbarang:read"), ctrl.getMeta);
router.get("/:type", requirePermission("datamasterbarang:read"), ctrl.list);
router.post("/:type", requirePermission("datamasterbarang:create"), ctrl.create);
router.put("/:type/:id(\\d+)", requirePermission("datamasterbarang:update"), ctrl.update);
router.delete("/:type/:id(\\d+)", requirePermission("datamasterbarang:delete"), ctrl.disable);

module.exports = router;
