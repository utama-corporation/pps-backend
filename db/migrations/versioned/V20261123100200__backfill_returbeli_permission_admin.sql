-- ================================================================
-- Migration: Backfill permission "returbeli:*" untuk IdUGroup 1 (Admin)
-- ================================================================
-- Permission sudah terdaftar di MstPermissionList (lihat
-- V20261123100100__seed_returbeli_permission.sql).
-- Grant ke grup Admin agar modul Retur Beli langsung bisa dipakai;
-- assignment ke grup lain lewat UI Role (System > Role).
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard). Hanya berjalan
-- bila grup IdUGroup 1 memang ada.
-- ================================================================
INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
SELECT 1, v.NoPermission, 1
FROM (VALUES
    ('returbeli:read'),
    ('returbeli:create'),
    ('returbeli:update'),
    ('returbeli:delete')
) AS v(NoPermission)
WHERE EXISTS (SELECT 1 FROM dbo.MstUserGroup g WHERE g.IdUGroup = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM dbo.MstUserGroupPermission existing
    WHERE existing.IdUGroup = 1
      AND existing.NoPermission = v.NoPermission
);
GO
