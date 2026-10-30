const express = require('express');
const router = express.Router();

const verifyToken = require('../../core/middleware/verify-token');
const attachPermissions = require('../../core/middleware/attach-permissions');
const requirePermission = require('../../core/middleware/require-permission');
const ctrl = require('./laporan-controller');

// Semua endpoint laporan butuh laporan:read (route individual tetap memakai
// verifyToken; dipanggil dua kali itu aman/no-op).
router.use(verifyToken, attachPermissions, requirePermission('laporan:read'));

router.get('/warehouse-options', verifyToken, ctrl.getWarehouseOptions);
router.get('/bahan-baku/stok', verifyToken, ctrl.stokBahanBaku);
router.get('/bahan-baku/stok/pdf', verifyToken, ctrl.stokBahanBakuPdf);
router.get('/bahan-baku/mutasi', verifyToken, ctrl.mutasiBahanBaku);
router.get('/bahan-baku/penerimaan', verifyToken, ctrl.penerimaanBahanBaku);
router.get('/bahan-baku/kartu-stok', verifyToken, ctrl.kartuStokBahanBaku);
router.get('/bahan-baku/umur', verifyToken, ctrl.umurBahanBaku);
router.get('/stok/:jenis', verifyToken, ctrl.stokUmum);
// PDF stok washing/broker (crosstab Jenis x Warehouse, sama dengan bahan baku).
router.get('/stok/:jenis/pdf', verifyToken, ctrl.stokUmumPdf);
router.get('/reject/stok', verifyToken, ctrl.stokReject);
router.get('/mutasi/:jenis', verifyToken, ctrl.mutasiUmum);
// PDF laporan mutasi (sumber data sama dengan /mutasi/:jenis, format PDF).
router.get('/mutasi/:jenis/pdf', verifyToken, ctrl.mutasiPdf);
router.get('/umur/:jenis', verifyToken, ctrl.umurKategori);
router.get('/produksi/:jenis', verifyToken, ctrl.produksiKategori);
router.get('/rekap/:jenis', verifyToken, ctrl.rekapProduksi);
// PDF rekap produksi (sumber data sama dengan /rekap/:jenis, format PDF).
router.get('/rekap/:jenis/pdf', verifyToken, ctrl.rekapProduksiPdf);
router.get('/rekap-harian', verifyToken, ctrl.rekapHarian);
router.get('/rekap-harian/pdf', verifyToken, ctrl.rekapProduksiPdf);
router.get('/semua-label', verifyToken, ctrl.semuaLabel);
router.get('/dashboard-produktifitas', verifyToken, ctrl.dashboardProduktifitas);
router.get('/hasil-produksi', verifyToken, ctrl.hasilProduksi);
router.get('/produktivitas/:jenis', verifyToken, ctrl.produktivitas);
// Laporan Stok Barang Dagang (SP_LapStokBarangDagang)
router.get('/barang-dagang/stok', verifyToken, ctrl.stokBarangDagang);
router.get('/barang-dagang/stok/pdf', verifyToken, ctrl.stokBarangDagangPdf);

module.exports = router;
