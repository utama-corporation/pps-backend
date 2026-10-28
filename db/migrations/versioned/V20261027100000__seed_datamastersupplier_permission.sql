-- ================================================================
-- Migration: Seed permission "datamastersupplier:*" untuk modul
-- Master Supplier (web port dari FrmMstSupplier.vb)
-- ================================================================
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('datamastersupplier:read', 'Lihat Master Supplier'),
    ('datamastersupplier:create', 'Tambah Data Master Supplier'),
    ('datamastersupplier:update', 'Ubah Data Master Supplier'),
    ('datamastersupplier:delete', 'Hapus Data Master Supplier')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
