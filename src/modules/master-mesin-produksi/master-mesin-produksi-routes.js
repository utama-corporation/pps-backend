const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const ctrl = require("./master-mesin-produksi-controller");

// Master Mesin Produksi (FrmMstMesin<Jenis>.vb) — permission datamastermesin:*
router.use(verifyToken, attachPermissions);

router.get("/meta", requirePermission("datamastermesin:read"), ctrl.getMeta);
router.get("/:type", requirePermission("datamastermesin:read"), ctrl.list);
router.post("/:type", requirePermission("datamastermesin:create"), ctrl.create);
router.put("/:type/:id(\\d+)", requirePermission("datamastermesin:update"), ctrl.update);
router.delete("/:type/:id(\\d+)", requirePermission("datamastermesin:delete"), ctrl.disable);

module.exports = router;
