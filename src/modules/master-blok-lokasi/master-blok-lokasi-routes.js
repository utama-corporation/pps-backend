// master-blok-lokasi-routes.js
const express = require('express');
const router = express.Router();
const verifyToken = require('../../core/middleware/verify-token');
const attachPermissions = require('../../core/middleware/attach-permissions');
const requirePermission = require('../../core/middleware/require-permission');
const ctrl = require('./master-blok-lokasi-controller');

const readPerm = [
  verifyToken,
  attachPermissions,
  requirePermission('datamasterbloklokasi:read'),
];
const createPerm = [
  verifyToken,
  attachPermissions,
  requirePermission('datamasterbloklokasi:create'),
];
const updatePerm = [
  verifyToken,
  attachPermissions,
  requirePermission('datamasterbloklokasi:update'),
];
const deletePerm = [
  verifyToken,
  attachPermissions,
  requirePermission('datamasterbloklokasi:delete'),
];

// Master combobox (warehouse + kategori)
router.get('/master', readPerm, ctrl.getMaster);

// Blok
router.get('/blok', readPerm, ctrl.listBlok);
router.post('/blok', createPerm, ctrl.createBlok);
router.put('/blok/:blok', updatePerm, ctrl.updateBlok);
router.delete('/blok/:blok', deletePerm, ctrl.removeBlok);

// Lokasi
router.get('/lokasi', readPerm, ctrl.listLokasi);
router.get('/lokasi/next-id', readPerm, ctrl.nextLokasiId);
router.post('/lokasi', createPerm, ctrl.createLokasi);
router.put('/lokasi/:blok/:idLokasi', updatePerm, ctrl.updateLokasi);
router.delete('/lokasi/:blok/:idLokasi', deletePerm, ctrl.removeLokasi);

// Jenis (dynamic per kategori)
router.get('/jenis', readPerm, ctrl.listJenis);

// Relasi lokasi <-> jenis
router.get('/lokasi-jenis', readPerm, ctrl.listLokasiJenis);
router.post('/lokasi-jenis', createPerm, ctrl.addLokasiJenis);
router.delete(
  '/lokasi-jenis/:blok/:idLokasi/:idKategori/:idJenis',
  deletePerm,
  ctrl.removeLokasiJenis,
);

module.exports = router;
