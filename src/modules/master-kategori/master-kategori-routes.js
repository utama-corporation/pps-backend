const express = require("express");
const router = express.Router();
const verifyToken = require("../../core/middleware/verify-token");
const masterKategoriController = require("./master-kategori-controller");

router.get(
  "/master-kategori",
  verifyToken,
  masterKategoriController.getKategori,
);

module.exports = router;
