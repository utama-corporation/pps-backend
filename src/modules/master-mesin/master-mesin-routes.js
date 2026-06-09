const express = require("express");
const router = express.Router();

const verifyToken = require("../../core/middleware/verify-token");
const ctrl = require("./master-mesin-controller");

// GET mesin broker (IdBagianMesin = 2)
router.get("/broker", verifyToken, ctrl.getBroker);
// GET mesin washing (IdBagianMesin = 7)
router.get("/washing", verifyToken, ctrl.getWashing);
// GET mesin crusher (IdBagianMesin = 3)
router.get("/crusher", verifyToken, ctrl.getCrusher);
// GET mesin gilingan (IdBagianMesin = 3)
router.get("/gilingan", verifyToken, ctrl.getGilingan);
// GET mesin mixer (IdBagianMesin = 5)
router.get("/mixer", verifyToken, ctrl.getMixer);
// GET mesin stamping (IdBagianMesin = 8)
router.get("/stamping", verifyToken, ctrl.getStamping);
// GET mesin spanner (IdBagianMesin = 9)
router.get("/spanner", verifyToken, ctrl.getSpanner);
// GET mesin pasang kunci (IdBagianMesin = 10)
router.get("/pasang-kunci", verifyToken, ctrl.getPasangKunci);
// GET mesin packing (IdBagianMesin = 11)
router.get("/packing", verifyToken, ctrl.getPacking);

// GET by idbagian (only active by default)
// The regex enforces numeric-only for :idbagian
router.get("/:idbagian(\\d+)", verifyToken, ctrl.getByIdBagian);

module.exports = router;
