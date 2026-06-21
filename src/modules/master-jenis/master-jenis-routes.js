const express = require("express");
const router = express.Router();
const verifyToken = require("../../core/middleware/verify-token");
const masterJenisController = require("./master-jenis-controller");

router.get("/master-jenis", verifyToken, masterJenisController.getJenis);

module.exports = router;
