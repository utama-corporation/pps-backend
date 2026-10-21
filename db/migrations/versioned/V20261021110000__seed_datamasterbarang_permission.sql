-- ================================================================
-- Migration: Seed permission "datamasterbarang:*" untuk modul
-- Master Barang (web port dari FrmMstBahanBaku, FrmMstBarangJadi,
-- FrmMstBarangDagang, FrmMstBonggolan, FrmMstBroker, FrmMstCabinetWIP,
-- FrmMstCabinetMaterial, FrmMstCrusher, FrmMstGilingan, FrmMstMixer,
-- FrmMstWashing)
-- ================================================================
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Grant ke IdUGroup 50 agar modul langsung bisa dipakai; assignment
-- ke group lain lewat UI Role (Master > Role).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('datamasterbarang:read', 'Lihat Master Barang'),
    ('datamasterbarang:create', 'Tambah Data Master Barang'),
    ('datamasterbarang:update', 'Ubah Data Master Barang'),
    ('datamasterbarang:delete', 'Nonaktifkan Data Master Barang')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO

INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
SELECT 50, v.NoPermission, 1
FROM (VALUES
    ('datamasterbarang:read'),
    ('datamasterbarang:create'),
    ('datamasterbarang:update'),
    ('datamasterbarang:delete')
) AS v(NoPermission)
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.MstUserGroupPermission existing
    WHERE existing.IdUGroup = 50
      AND existing.NoPermission = v.NoPermission
);
GO
