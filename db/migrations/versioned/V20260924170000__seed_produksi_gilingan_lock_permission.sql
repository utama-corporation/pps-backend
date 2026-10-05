-- ================================================================
-- Migration: Seed permission "produksi_gilingan:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi gilingan
--   PATCH /api/production/gilingan/:noProduksi/complete
--   PATCH /api/production/gilingan/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_gilingan:lock', 'Kunci / Buka Kunci Produksi Gilingan')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
