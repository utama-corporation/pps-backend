const express = require("express");
const router = express.Router();
const verifyToken = require("../../core/middleware/verify-token");
const stockOpnameV2Controller = require("./stock-opname-v2-controller");

router.get(
  "/stock-opname-v2/kategori",
  verifyToken,
  stockOpnameV2Controller.listKategoriHandler,
);

router.get(
  "/stock-opname-v2/kategori/:categoryId/jenis",
  verifyToken,
  stockOpnameV2Controller.listJenisHandler,
);

router.post(
  "/stock-opname-v2/no-stock-opname",
  verifyToken,
  stockOpnameV2Controller.generateStockOpnameHandler,
);

router.patch(
  "/stock-opname-v2/no-stock-opname/:stockOpnameNo/complete",
  verifyToken,
  stockOpnameV2Controller.completeStockOpnameHandler,
);

router.get(
  "/stock-opname-v2/no-stock-opname/:stockOpnameNo/jenis",
  verifyToken,
  stockOpnameV2Controller.getJenisInNosoHandler,
);

router.get(
  "/stock-opname-v2/no-stock-opname/:stockOpnameNo/jenis/:typeId/label",
  verifyToken,
  stockOpnameV2Controller.getSnapshotHandler,
);

router.post(
  "/stock-opname-v2/no-stock-opname/:stockOpnameNo/hasil",
  verifyToken,
  stockOpnameV2Controller.insertHasilHandler,
);

router.get(
  "/stock-opname-v2/blok",
  verifyToken,
  stockOpnameV2Controller.listBlokHandler,
);

router.get(
  "/stock-opname-v2/no-stock-opname/:stockOpnameNo/blok/:blok/lokasi",
  verifyToken,
  stockOpnameV2Controller.getLocationsHandler,
);

router.get(
  "/stock-opname-v2/no-stock-opname/:stockOpnameNo/blok/:blok/lokasi/:locationId/label",
  verifyToken,
  stockOpnameV2Controller.getSnapshotHandler,
);

module.exports = router;
