-- ================================================================
-- Migration: Seed permission "produksi_pasangkunci:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi pasang kunci (key fitting)
--   PATCH /api/production/key-fitting/:noProduksi/complete
--   PATCH /api/production/key-fitting/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_pasangkunci:lock', 'Kunci / Buka Kunci Produksi Pasang Kunci')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
