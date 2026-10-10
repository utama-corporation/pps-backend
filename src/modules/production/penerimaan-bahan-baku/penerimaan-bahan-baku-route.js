// penerimaan-bahan-baku-route.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");
const ctrl = require("./penerimaan-bahan-baku-controller");

router.use(verifyToken, attachPermissions);

const canRead = requirePermission("penerimaanbahanbaku:read");
const canCreate = requirePermission("penerimaanbahanbaku:create");
const canUpdate = requirePermission("penerimaanbahanbaku:update");
const canDelete = requirePermission("penerimaanbahanbaku:delete");

router.get("/", canRead, ctrl.list);
// Statis, harus di atas "/:noPenerimaan" supaya tidak ketangkap sebagai param.
router.get("/tim-status", canRead, ctrl.timStatus);
// Opsi form input (supplier, jenis per kategori, max sak) dan aturan potongan.
router.get("/form-options", canRead, ctrl.formOptions);
router.get("/potongan/:idSupplier", canRead, ctrl.potongan);
router.get("/:noPenerimaan", canRead, ctrl.getDetail);
// Fase 1: buat header dokumen (analog create WashingProduksi_h).
router.post("/", canCreate, ctrl.createHeader);
// Fase 2: tambah pallet/sak ke header yang sudah ada — boleh dipanggil
// >1x per NoPenerimaan (1x per section Bahan Baku Pakai/Proses).
router.post("/:noPenerimaan/pallets", canUpdate, ctrl.addPallets);
// Ubah/hapus pallet dan sak yang sudah tersimpan (padanan form VB).
router.patch(
  "/:noPenerimaan/pallets/:noBahanBaku/:noPallet",
  canUpdate,
  ctrl.updatePallet,
);
router.delete(
  "/:noPenerimaan/pallets/:noBahanBaku/:noPallet",
  canDelete,
  ctrl.removePallet,
);
router.post(
  "/:noPenerimaan/pallets/:noBahanBaku/:noPallet/saks",
  canUpdate,
  ctrl.addSaks,
);
router.delete(
  "/:noPenerimaan/pallets/:noBahanBaku/:noPallet/saks/:noSak",
  canDelete,
  ctrl.removeSak,
);
router.get("/:noPenerimaan/laporan", canRead, ctrl.laporan);
router.delete("/:noPenerimaan", canDelete, ctrl.remove);
// Tandai penerimaan sebagai selesai (IsComplete = 1).
router.patch("/:noPenerimaan/complete", canUpdate, ctrl.complete);

module.exports = router;
