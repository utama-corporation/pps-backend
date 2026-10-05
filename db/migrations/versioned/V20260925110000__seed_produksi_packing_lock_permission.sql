-- ================================================================
-- Migration: Seed permission "produksi_packing:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi packing
--   PATCH /api/production/packing/:noPacking/complete
--   PATCH /api/production/packing/:noPacking/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('packing:lock', 'Kunci / Buka Kunci Produksi Packing')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
