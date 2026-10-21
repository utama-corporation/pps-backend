-- ================================================================
-- Migration: Seed permission "retur_old:*" untuk modul Retur Old
-- ================================================================
-- Retur versi lama (BJRetur_h) di web: hanya buat header + label output.
-- retur_old:read   — lihat daftar/detail retur & label.
-- retur_old:create — tambah label output.
-- retur_old:delete — hapus label output.
--
-- Backfill ke IdUGroup 50 (pola label_barangdagang:*).
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('retur_old:read', 'Lihat Retur Old'),
    ('retur_old:create', 'Buat Retur Old (tambah label output)'),
    ('retur_old:delete', 'Hapus Retur Old (hapus label output)')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO

INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
SELECT 50, v.NoPermission, 1
FROM (VALUES
    ('retur_old:read'),
    ('retur_old:create'),
    ('retur_old:delete')
) AS v(NoPermission)
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.MstUserGroupPermission existing
    WHERE existing.IdUGroup = 50
      AND existing.NoPermission = v.NoPermission
);
GO
