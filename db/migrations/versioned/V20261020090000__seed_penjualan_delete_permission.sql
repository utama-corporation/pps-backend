-- ================================================================
-- Migration: Seed permission "penjualan:delete" (hapus DO + label scan)
-- ================================================================
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard). Assignment ke
-- user group dilakukan lewat UI admin permission yang sudah ada.

INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('penjualan:delete', 'Hapus Penjualan')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
