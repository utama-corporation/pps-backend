-- ================================================================
-- Migration: Seed permission "datamasterbloklokasi:*" untuk modul
-- Master Blok & Lokasi (web port dari FrmMstBlokLokasi.vb)
-- ================================================================
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('datamasterbloklokasi:read', 'Lihat Master Blok & Lokasi'),
    ('datamasterbloklokasi:create', 'Tambah Data Master Blok & Lokasi'),
    ('datamasterbloklokasi:update', 'Ubah Data Master Blok & Lokasi'),
    ('datamasterbloklokasi:delete', 'Hapus Data Master Blok & Lokasi')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
