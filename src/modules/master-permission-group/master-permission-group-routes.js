const express = require("express");
const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const {
  getListHandler,
  getPermissionListHandler,
  createPermissionHandler,
  updatePermissionHandler,
  deletePermissionHandler,
  getDetailHandler,
  saveNewHandler,
  saveUpdateHandler,
  removeHandler,
} = require("./master-permission-group-controller");

const router = express.Router();

const readPerm = [verifyToken, attachPermissions, requirePermission("datamasterpermissiongroup:read")];
const createPerm = [verifyToken, attachPermissions, requirePermission("datamasterpermissiongroup:create")];
const updatePerm = [verifyToken, attachPermissions, requirePermission("datamasterpermissiongroup:update")];
const deletePerm = [verifyToken, attachPermissions, requirePermission("datamasterpermissiongroup:delete")];

// =========================
// MASTER DATA (WAJIB sebelum :idUGroup)
// =========================
router.get("/permissions", ...readPerm, getPermissionListHandler);
router.post("/permissions", ...createPerm, createPermissionHandler);
router.put("/permissions/:noPermission", ...updatePerm, updatePermissionHandler);
router.delete("/permissions/:noPermission", ...deletePerm, deletePermissionHandler);

// =========================
// CRUD
// =========================
router.get("/", ...readPerm, getListHandler);
router.get("/:idUGroup", ...readPerm, getDetailHandler);

router.post("/", ...createPerm, saveNewHandler);
router.put("/:idUGroup", ...updatePerm, saveUpdateHandler);
router.delete("/:idUGroup", ...deletePerm, removeHandler);

module.exports = router;
