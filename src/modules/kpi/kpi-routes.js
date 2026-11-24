const express = require("express");
const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const ctrl = require("./kpi-controller");

/* KPI & Ratio: semua pengguna login; KPI disaring per izin di service. */
const router = express.Router();
router.use(verifyToken, attachPermissions);

router.get("/", ctrl.kpi);

module.exports = router;
