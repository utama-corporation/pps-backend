const express = require("express");
const verifyToken = require("../../core/middleware/verify-token");
const ctrl = require("./favorit-controller");

const router = express.Router();

router.use(verifyToken);

router.get("/", ctrl.list);
router.post("/", ctrl.add);
// Didaftarkan sebelum "/:tipe/:kode" agar "urutan" tidak terbaca sebagai tipe.
router.put("/urutan", ctrl.reorder);
router.delete("/:tipe/:kode", ctrl.remove);

module.exports = router;
