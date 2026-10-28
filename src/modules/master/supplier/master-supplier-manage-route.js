// master-supplier-manage-route.js
// Master Supplier (CRUD) — dipasang di /api/mst-supplier
const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./master-supplier-manage-controller");

const guard = (perm) => [verifyToken, attachPermissions, requirePermission(perm)];

router.get("/", guard("datamastersupplier:read"), ctrl.list);
router.post("/", guard("datamastersupplier:create"), ctrl.create);
router.put("/:id", guard("datamastersupplier:update"), ctrl.update);
router.delete("/:id", guard("datamastersupplier:delete"), ctrl.remove);

module.exports = router;
