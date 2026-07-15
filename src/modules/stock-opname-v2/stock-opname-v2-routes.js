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

router.get(
  "/stock-opname-v2/kategori/:categoryId/riwayat",
  verifyToken,
  stockOpnameV2Controller.listRiwayatHandler,
);

// ⚠️ Daftarkan SEBELUM POST "/stock-opname-v2/transaksi" (statis vs
// dokumentasi urutan route, meski beda method tidak akan tabrakan) — dipakai
// FE untuk menampilkan preview jumlah label sebelum benar-benar generate.
router.get(
  "/stock-opname-v2/transaksi/preview",
  verifyToken,
  stockOpnameV2Controller.previewLabelCountHandler,
);

router.post(
  "/stock-opname-v2/transaksi",
  verifyToken,
  stockOpnameV2Controller.generateStockOpnameHandler,
);

router.patch(
  "/stock-opname-v2/transaksi/:stockOpnameNo/complete",
  verifyToken,
  stockOpnameV2Controller.completeStockOpnameHandler,
);

router.delete(
  "/stock-opname-v2/transaksi/:stockOpnameNo",
  verifyToken,
  stockOpnameV2Controller.deleteStockOpnameHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/jenis",
  verifyToken,
  stockOpnameV2Controller.getJenisInNosoHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/jenis/:typeId/label",
  verifyToken,
  stockOpnameV2Controller.getSnapshotHandler,
);

router.post(
  "/stock-opname-v2/transaksi/:stockOpnameNo/hasil",
  verifyToken,
  stockOpnameV2Controller.insertHasilHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/blok",
  verifyToken,
  stockOpnameV2Controller.listBlokHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/blok/:blok/lokasi",
  verifyToken,
  stockOpnameV2Controller.getLocationsHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/blok/:blok/lokasi/:locationId/label",
  verifyToken,
  stockOpnameV2Controller.getSnapshotHandler,
);

module.exports = router;
