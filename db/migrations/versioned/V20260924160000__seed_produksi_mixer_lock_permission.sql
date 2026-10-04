-- ================================================================
-- Migration: Seed permission "produksi_mixer:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi mixer
--   PATCH /api/production/mixer/:noProduksi/complete
--   PATCH /api/production/mixer/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_mixer:lock', 'Kunci / Buka Kunci Produksi Mixer')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
