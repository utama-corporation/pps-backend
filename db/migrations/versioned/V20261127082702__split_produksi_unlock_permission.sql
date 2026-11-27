-- ================================================================
-- Migration: Pisahkan permission Kunci dan Buka Kunci produksi
-- ================================================================
--   *:lock   -> PATCH /api/production/<proses>/:noProduksi/complete
--   *:unlock -> PATCH /api/production/<proses>/:noProduksi/uncomplete
--
-- Akses awal *:unlock hanya grup Admin (IdUGroup 1). Grup lain
-- diatur lewat UI Master Permission Group.
-- Idempotent: aman dijalankan ulang (NOT EXISTS guard).
-- ================================================================

-- 1) Daftarkan permission unlock
INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('produksi_washing:unlock',  'Buka Kunci Produksi Washing'),
    ('produksi_broker:unlock',   'Buka Kunci Produksi Broker'),
    ('produksi_crusher:unlock',  'Buka Kunci Produksi Crusher'),
    ('produksi_gilingan:unlock', 'Buka Kunci Produksi Gilingan'),
    ('produksi_mixer:unlock',    'Buka Kunci Produksi Mixer'),
    ('injectproduksi:unlock',    'Buka Kunci Produksi Inject'),
    ('hotstamping:unlock',       'Buka Kunci Produksi Stamping'),
    ('pasangkunci:unlock',       'Buka Kunci Produksi Pasang Kunci'),
    ('spanner:unlock',           'Buka Kunci Produksi Spanner'),
    ('packing:unlock',           'Buka Kunci Produksi Packing')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO

-- 2) Permission lock sekarang hanya untuk mengunci
UPDATE p
SET p.Permission = v.Permission
FROM dbo.MstPermissionList p
INNER JOIN (VALUES
    ('produksi_washing:lock',  'Kunci Produksi Washing'),
    ('produksi_broker:lock',   'Kunci Produksi Broker'),
    ('produksi_crusher:lock',  'Kunci Produksi Crusher'),
    ('produksi_gilingan:lock', 'Kunci Produksi Gilingan'),
    ('produksi_mixer:lock',    'Kunci Produksi Mixer'),
    ('injectproduksi:lock',    'Kunci Produksi Inject'),
    ('hotstamping:lock',       'Kunci Produksi Stamping'),
    ('pasangkunci:lock',       'Kunci Produksi Pasang Kunci'),
    ('spanner:lock',           'Kunci Produksi Spanner'),
    ('packing:lock',           'Kunci Produksi Packing')
) AS v(NoPermission, Permission)
    ON v.NoPermission = p.NoPermission;
GO

-- 3) Beri unlock ke grup Admin (hanya bila grup IdUGroup 1 ada)
INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
SELECT 1, v.NoPermission, 1
FROM (VALUES
    ('produksi_washing:unlock'),
    ('produksi_broker:unlock'),
    ('produksi_crusher:unlock'),
    ('produksi_gilingan:unlock'),
    ('produksi_mixer:unlock'),
    ('injectproduksi:unlock'),
    ('hotstamping:unlock'),
    ('pasangkunci:unlock'),
    ('spanner:unlock'),
    ('packing:unlock')
) AS v(NoPermission)
WHERE EXISTS (SELECT 1 FROM dbo.MstUserGroup g WHERE g.IdUGroup = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM dbo.MstUserGroupPermission existing
    WHERE existing.IdUGroup = 1
      AND existing.NoPermission = v.NoPermission
);
GO
