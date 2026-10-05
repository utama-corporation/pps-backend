-- ================================================================
-- Migration: Seed permission "produksi_spanner:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi packing spanner
--   PATCH /api/production/spanner/:noProduksi/complete
--   PATCH /api/production/spanner/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('spanner:lock', 'Kunci / Buka Kunci Produksi Packing Spanner')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
