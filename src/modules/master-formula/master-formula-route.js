const express = require('express');
const router = express.Router();

const verifyToken = require('../../core/middleware/verify-token');
const attachPermissions = require('../../core/middleware/attach-permissions');
const requirePermission = require('../../core/middleware/require-permission');
const ctrl = require('./master-formula-controller');

router.get(
  '/kategori',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:read'),
  ctrl.getKategori,
);
router.get(
  '/items',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:read'),
  ctrl.getItems,
);
router.get(
  '/detail',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:read'),
  ctrl.getDetail,
);
router.get(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:read'),
  ctrl.list,
);
router.post(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:create'),
  ctrl.create,
);
router.put(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:update'),
  ctrl.update,
);
router.delete(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('masterformulaproduksi:delete'),
  ctrl.remove,
);

module.exports = router;
