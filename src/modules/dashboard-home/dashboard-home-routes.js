const express = require("express");
const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const ctrl = require("./dashboard-home-controller");

/* Dashboard utama tablet PPS: semua pengguna login; domain disaring per izin di service. */
const router = express.Router();
router.use(verifyToken, attachPermissions);

router.get("/", ctrl.home);

module.exports = router;
