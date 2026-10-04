-- ================================================================
-- Migration: Seed permission "produksi_crusher:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi crusher
--   PATCH /api/production/crusher/:noCrusherProduksi/complete
--   PATCH /api/production/crusher/:noCrusherProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_crusher:lock', 'Kunci / Buka Kunci Produksi Crusher')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
