const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const ctrl = require("./spk-barang-jadi-controller");

router.use(verifyToken);

router.get("/", ctrl.getMonitoring);
router.get("/history", ctrl.getSpkHistory);
router.post("/", ctrl.createSpk);
router.get("/:noSPK", ctrl.getSpkDetail);

module.exports = router;
