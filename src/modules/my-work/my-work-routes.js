const express = require("express");
const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const ctrl = require("./my-work-controller");

/* My Work: semua pengguna login; antrian disaring per izin di service. */
const router = express.Router();
router.use(verifyToken, attachPermissions);

router.get("/", ctrl.summary);
router.get("/:key", ctrl.items);

module.exports = router;
