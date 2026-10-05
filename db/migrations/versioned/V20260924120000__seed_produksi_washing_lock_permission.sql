-- ================================================================
-- Migration: Seed permission "produksi_washing:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi washing
--   PATCH /api/production/washing/:noProduksi/complete
--   PATCH /api/production/washing/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_washing:lock', 'Kunci / Buka Kunci Produksi Washing')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
