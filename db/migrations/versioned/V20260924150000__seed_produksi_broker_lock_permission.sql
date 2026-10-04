-- ================================================================
-- Migration: Seed permission "produksi_broker:lock"
-- ================================================================
-- Mengunci / membuka kunci produksi broker
--   PATCH /api/production/broker/:noProduksi/complete
--   PATCH /api/production/broker/:noProduksi/uncomplete
--
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- Assignment ke user group lewat UI Master Permission / migration
-- backfill terpisah (MstUserGroupPermission).
-- ================================================================
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_broker:lock', 'Kunci / Buka Kunci Produksi Broker')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO
