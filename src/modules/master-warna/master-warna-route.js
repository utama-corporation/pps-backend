const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const ctrl = require("./master-warna-controller");

router.get("/cetakan/:idCetakan(\\d+)", verifyToken, ctrl.getByIdCetakan);

// GET only active (Enable = 1)
router.get("/", verifyToken, ctrl.getAllActive);

module.exports = router;
