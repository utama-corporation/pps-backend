const express = require("express");
const router = express.Router();
const verifyToken = require("../../core/middleware/verify-token");
const mappingController = require("./mapping-controller");

router.get("/blok", verifyToken, mappingController.getMapping);
router.get("/lokasi", verifyToken, mappingController.getLokasiByBlok);
router.post("/lokasi/:blok", verifyToken, mappingController.createLokasi);
router.put(
  "/lokasi/:blok/:idLokasi",
  verifyToken,
  mappingController.updateLokasi,
);
router.get("/layout/:blok", verifyToken, mappingController.getLayoutByBlok);
router.post("/layout/:blok", verifyToken, mappingController.saveLayoutByBlok);
module.exports = router;
