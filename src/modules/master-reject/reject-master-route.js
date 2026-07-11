// src/modules/master/reject-master-route.js
const express = require('express');
const router = express.Router();

const verifyToken = require('../../core/middleware/verify-token');
const attachPermissions = require('../../core/middleware/attach-permissions');
const requirePermission = require('../../core/middleware/require-permission');
const ctrl = require('./reject-master-controller');

router.use(verifyToken, attachPermissions);

router.get(
  '/stok',
  requirePermission('penerimaanbahanbaku:read'),
  ctrl.getStokProses,
);

router.get(
  '/:idreject/label',
  requirePermission('penerimaanbahanbaku:read'),
  ctrl.getLabelByIdReject,
);

// GET only active Reject master (MstReject where Enable = 1)
router.get('/', ctrl.getAllActive);

module.exports = router;
