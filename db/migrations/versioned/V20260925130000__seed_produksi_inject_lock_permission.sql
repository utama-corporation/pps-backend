-- ================================================================
-- Migration: Seed permission "produksi_inject:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi inject
--   PATCH /api/production/inject/:noProduksi/complete
--   PATCH /api/production/inject/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('injectproduksi:lock', 'Kunci / Buka Kunci Produksi Inject')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
