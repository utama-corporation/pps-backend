const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const ctrl = require("./master-material-controller");

router.get("/material/output", verifyToken, ctrl.getOutputByParams);
router.get(
  "/material/furniture-wip-compositions",
  verifyToken,
  ctrl.getFurnitureWipCompositions,
);
router.get(
  "/material/barang-jadi-compositions",
  verifyToken,
  ctrl.getBarangJadiCompositions,
);

module.exports = router;
