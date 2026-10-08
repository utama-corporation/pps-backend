const express = require('express');
const router = express.Router();

const verifyToken = require('../../core/middleware/verify-token');
const attachPermissions = require('../../core/middleware/attach-permissions');
const requirePermission = require('../../core/middleware/require-permission');
const ctrl = require('./mst-user-controller');

router.get(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:read'),
  ctrl.list,
);
router.get(
  '/groups',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:read'),
  ctrl.getGroups,
);
router.get(
  '/employees',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:read'),
  ctrl.getEmployees,
);
router.get(
  '/:idUsername/group',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:read'),
  ctrl.getUserGroups,
);
router.post(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:create'),
  ctrl.create,
);
router.put(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:update'),
  ctrl.update,
);
router.delete(
  '/',
  verifyToken,
  attachPermissions,
  requirePermission('datamasteruser:delete'),
  ctrl.remove,
);

module.exports = router;
