const express = require("express");
const router = express.Router();
const verifyToken = require("../../../core/middleware/verify-token");
const labelController = require("./label-controller");

// Semua label
router.get("/label/all", verifyToken, labelController.getAllLabelsHandler);
router.get("/label/all/v2", verifyToken, labelController.getAllLabelsV2Handler);

// 🔥 Update lokasi berdasarkan NomorLabel
router.put(
  "/label/update-lokasi",
  verifyToken,
  labelController.updateLabelLocationHandler,
);

module.exports = router;
