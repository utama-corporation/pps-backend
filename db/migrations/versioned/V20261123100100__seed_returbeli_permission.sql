-- ================================================================
-- Migration: Seed permission "returbeli:*" untuk modul Retur Beli
-- (retur ke supplier). Belum diberikan ke grup mana pun: admin memberi
-- akses lewat menu Role.
-- ================================================================
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('returbeli:read', 'Lihat Retur Beli'),
    ('returbeli:create', 'Tambah Retur Beli'),
    ('returbeli:update', 'Ubah Retur Beli (item & penyelesaian)'),
    ('returbeli:delete', 'Hapus Retur Beli')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
