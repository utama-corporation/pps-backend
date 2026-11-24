// src/modules/retur-beli/retur-beli-routes.js
const express = require("express");
const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const ctrl = require("./retur-beli-controller");

/* Retur Beli (retur ke supplier). Urutan: verify -> attach -> require -> controller.
 * Rute statis (/label/...) didaftarkan sebelum rute berparameter. */
const router = express.Router();
router.use(verifyToken, attachPermissions);

const read = requirePermission("returbeli:read");
const create = requirePermission("returbeli:create");
const update = requirePermission("returbeli:update");
const remove = requirePermission("returbeli:delete");
const decide = requirePermission("returbeli:decide");

router.get("/", read, ctrl.getAll);
router.get("/label/:noLabel", read, ctrl.lookupLabel);
router.get("/:noRetur", read, ctrl.getDetail);
router.get("/:noRetur/outputs", read, ctrl.getOutputs);
router.get("/:noRetur/turnover", read, ctrl.getTurnover);

router.post("/", create, ctrl.create);
router.put("/:noRetur", update, ctrl.update);
router.delete("/:noRetur", remove, ctrl.remove);

router.post("/:noRetur/items", update, ctrl.addItems);
router.put("/:noRetur/items/:idItem", update, ctrl.updateItem);
router.delete("/:noRetur/items/:idItem", update, ctrl.deleteItem);

// Keputusan penyelesaian (DIGANTI / POTONG_TAGIHAN) adalah wewenang terpisah,
// mengikuti pola `retur:decide` pada retur-v3.
router.patch("/:noRetur/decision", decide, ctrl.decide);

router.post("/:noRetur/scan", update, ctrl.scanAuto);
router.delete("/:noRetur/turnover/:idTurnover", update, ctrl.undoScan);

router.patch("/:noRetur/complete", update, ctrl.complete);

module.exports = router;
