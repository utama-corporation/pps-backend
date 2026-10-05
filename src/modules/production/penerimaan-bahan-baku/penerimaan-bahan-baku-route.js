// penerimaan-bahan-baku-route.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const ctrl = require("./penerimaan-bahan-baku-controller");

router.get("/", verifyToken, ctrl.list);
// Statis, harus di atas "/:noPenerimaan" supaya tidak ketangkap sebagai param.
router.get("/tim-status", verifyToken, ctrl.timStatus);
// Opsi form input (supplier, jenis per kategori, max sak) dan aturan potongan.
router.get("/form-options", verifyToken, ctrl.formOptions);
router.get("/potongan/:idSupplier", verifyToken, ctrl.potongan);
router.get("/:noPenerimaan", verifyToken, ctrl.getDetail);
// Fase 1: buat header dokumen (analog create WashingProduksi_h).
router.post("/", verifyToken, ctrl.createHeader);
// Fase 2: tambah pallet/sak ke header yang sudah ada — boleh dipanggil
// >1x per NoPenerimaan (1x per section Bahan Baku Pakai/Proses).
router.post("/:noPenerimaan/pallets", verifyToken, ctrl.addPallets);
// Ubah/hapus pallet dan sak yang sudah tersimpan (padanan form VB).
router.patch("/:noPenerimaan/pallets/:noBahanBaku/:noPallet", verifyToken, ctrl.updatePallet);
router.delete("/:noPenerimaan/pallets/:noBahanBaku/:noPallet", verifyToken, ctrl.removePallet);
router.post("/:noPenerimaan/pallets/:noBahanBaku/:noPallet/saks", verifyToken, ctrl.addSaks);
router.delete(
  "/:noPenerimaan/pallets/:noBahanBaku/:noPallet/saks/:noSak",
  verifyToken,
  ctrl.removeSak,
);
router.get("/:noPenerimaan/laporan", verifyToken, ctrl.laporan);
router.delete("/:noPenerimaan", verifyToken, ctrl.remove);
// Tandai penerimaan sebagai selesai (IsComplete = 1).
router.patch("/:noPenerimaan/complete", verifyToken, ctrl.complete);

module.exports = router;
