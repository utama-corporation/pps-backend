-- ================================================================
-- Migration: Backfill permission "datamasterbloklokasi:*" untuk IdUGroup 50
-- ================================================================
-- Permission sudah terdaftar di MstPermissionList (lihat
-- V20261008100000__seed_datamasterbloklokasi_permission.sql).
-- Grant ke IdUGroup 50 agar modul langsung bisa dipakai; assignment
-- ke group lain lewat UI Role (Master > Role).
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- ================================================================
INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
SELECT 50, v.NoPermission, 1
FROM (VALUES
    ('datamasterbloklokasi:read'),
    ('datamasterbloklokasi:create'),
    ('datamasterbloklokasi:update'),
    ('datamasterbloklokasi:delete')
) AS v(NoPermission)
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.MstUserGroupPermission existing
    WHERE existing.IdUGroup = 50
      AND existing.NoPermission = v.NoPermission
);
GO
