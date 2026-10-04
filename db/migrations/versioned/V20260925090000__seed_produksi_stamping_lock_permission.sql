-- ================================================================
-- Migration: Seed permission "produksi_stamping:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi stamping
--   PATCH /api/production/hot-stamp/:noProduksi/complete
--   PATCH /api/production/hot-stamp/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_stamping:lock', 'Kunci / Buka Kunci Produksi Stamping')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
