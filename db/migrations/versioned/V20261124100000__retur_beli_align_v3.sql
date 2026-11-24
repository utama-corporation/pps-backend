-- ================================================================
-- Migration: Selaraskan interface Retur Beli dengan konvensi Retur V3
-- ================================================================
-- 1. Kolom keputusan (paritas BJReturV3_h): DecisionBy / DecisionAt /
--    IsComplete. Penyelesaian sudah ada di V20261123100000.
-- 2. Permission baru `returbeli:decide` (wewenang terpisah, seperti
--    `retur:decide` pada retur-v3) + backfill grup Admin.
--
-- Idempotent: aman dijalankan ulang.
-- ================================================================

IF COL_LENGTH(N'dbo.ReturBeli_h', N'DecisionBy') IS NULL
BEGIN
    ALTER TABLE dbo.ReturBeli_h ADD DecisionBy varchar(100) NULL;
END
GO

IF COL_LENGTH(N'dbo.ReturBeli_h', N'DecisionAt') IS NULL
BEGIN
    ALTER TABLE dbo.ReturBeli_h ADD DecisionAt datetime2(0) NULL;
END
GO

IF COL_LENGTH(N'dbo.ReturBeli_h', N'IsComplete') IS NULL
BEGIN
    ALTER TABLE dbo.ReturBeli_h
        ADD IsComplete bit NOT NULL
            CONSTRAINT DF_ReturBeli_h_IsComplete DEFAULT (0);
END
GO

-- Backfill barang yang sudah SELESAI: sesuai konvensi retur-v3, dokumen
-- selesai ditandai IsComplete = 1.
UPDATE dbo.ReturBeli_h
SET IsComplete = 1
WHERE Status = 'SELESAI' AND IsComplete = 0;
GO

INSERT INTO dbo.MstPermissionList (NoPermission, Permission)
SELECT v.NoPermission, v.Permission
FROM (VALUES
    ('returbeli:decide', 'Putuskan Penyelesaian Retur Beli')
) AS v(NoPermission, Permission)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.MstPermissionList p WHERE p.NoPermission = v.NoPermission
);
GO

INSERT INTO dbo.MstUserGroupPermission (IdUGroup, NoPermission, Allow)
SELECT 1, 'returbeli:decide', 1
WHERE EXISTS (SELECT 1 FROM dbo.MstUserGroup g WHERE g.IdUGroup = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM dbo.MstUserGroupPermission existing
    WHERE existing.IdUGroup = 1
      AND existing.NoPermission = 'returbeli:decide'
  );
GO
