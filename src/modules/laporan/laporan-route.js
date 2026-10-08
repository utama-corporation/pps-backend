const express = require('express');
const router = express.Router();

const verifyToken = require('../../core/middleware/verify-token');
const ctrl = require('./laporan-controller');

router.get('/warehouse-options', verifyToken, ctrl.getWarehouseOptions);
router.get('/bahan-baku/stok', verifyToken, ctrl.stokBahanBaku);
router.get('/bahan-baku/mutasi', verifyToken, ctrl.mutasiBahanBaku);
router.get('/bahan-baku/penerimaan', verifyToken, ctrl.penerimaanBahanBaku);
router.get('/bahan-baku/kartu-stok', verifyToken, ctrl.kartuStokBahanBaku);
router.get('/bahan-baku/umur', verifyToken, ctrl.umurBahanBaku);
router.get('/stok/:jenis', verifyToken, ctrl.stokUmum);
router.get('/reject/stok', verifyToken, ctrl.stokReject);
router.get('/mutasi/:jenis', verifyToken, ctrl.mutasiUmum);
router.get('/umur/:jenis', verifyToken, ctrl.umurKategori);
router.get('/produksi/:jenis', verifyToken, ctrl.produksiKategori);
router.get('/rekap/:jenis', verifyToken, ctrl.rekapProduksi);
router.get('/rekap-harian', verifyToken, ctrl.rekapHarian);
router.get('/semua-label', verifyToken, ctrl.semuaLabel);
router.get('/dashboard-produktifitas', verifyToken, ctrl.dashboardProduktifitas);
router.get('/hasil-produksi', verifyToken, ctrl.hasilProduksi);
router.get('/produktivitas/:jenis', verifyToken, ctrl.produktivitas);

module.exports = router;
