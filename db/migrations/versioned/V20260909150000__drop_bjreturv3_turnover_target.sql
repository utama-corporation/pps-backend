-- ================================================================
-- Migration: Hapus layer BJReturV3TurnoverTarget_d (revert V20260821090000)
-- ================================================================
-- Turnover retur-v3 ("Item yang Dipickup", path DIGANTI) sekarang
-- dicocokkan LANGSUNG ke dbo.BJReturV3Item_d — like-for-like pada
-- KodeKategori + IdJenis, target pcs = it.Pcs, satu target implisit per
-- item retur. Tabel target pengganti manual tidak dipakai lagi (auto-seed
-- like-for-like, tidak ada UI target di tablet, endpoint CRUD-nya mati).
--
-- Baris scan lama di BJReturV3Turnover_d di-invalidasi (unlock label yang
-- dipakai + hapus partial yang sempat dipecah + kosongkan tabel) — sama
-- pola dengan blok invalidasi di V20260821090000. Kolom NoPartial +
-- IX_BJReturV3Turnover_d_NoPartial (dari V20260909140000) dipertahankan.
--
-- Idempotent: semua langkah ber-guard.
-- ================================================================

-- 1. Invalidasi scan turnover lama: unlock label + hapus partial-nya, lalu kosongkan.
IF COL_LENGTH('dbo.BJReturV3Turnover_d', 'IdTarget') IS NOT NULL
BEGIN
    UPDATE bj SET bj.DateUsage = NULL
    FROM dbo.BarangJadi bj
    INNER JOIN dbo.BJReturV3Turnover_d tv ON tv.LabelCode = bj.NoBJ;

    UPDATE fw SET fw.DateUsage = NULL
    FROM dbo.FurnitureWIP fw
    INNER JOIN dbo.BJReturV3Turnover_d tv ON tv.LabelCode = fw.NoFurnitureWIP;

    DELETE bp FROM dbo.BarangJadiPartial bp
      INNER JOIN dbo.BJReturV3Turnover_d tv ON tv.NoPartial = bp.NoBJPartial;
    DELETE fp FROM dbo.FurnitureWIPPartial fp
      INNER JOIN dbo.BJReturV3Turnover_d tv ON tv.NoPartial = fp.NoFurnitureWIPPartial;

    DELETE FROM dbo.BJReturV3Turnover_d;
END
GO

-- 2. Ganti FK IdTarget -> IdItem.
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BJReturV3Turnover_d_BJReturV3TurnoverTarget_d')
    ALTER TABLE dbo.BJReturV3Turnover_d DROP CONSTRAINT FK_BJReturV3Turnover_d_BJReturV3TurnoverTarget_d;
GO

IF COL_LENGTH('dbo.BJReturV3Turnover_d', 'IdTarget') IS NOT NULL
    ALTER TABLE dbo.BJReturV3Turnover_d DROP COLUMN IdTarget;
GO

IF COL_LENGTH('dbo.BJReturV3Turnover_d', 'IdItem') IS NULL
    ALTER TABLE dbo.BJReturV3Turnover_d ADD IdItem INT NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BJReturV3Turnover_d_BJReturV3Item_d')
    ALTER TABLE dbo.BJReturV3Turnover_d
        ADD CONSTRAINT FK_BJReturV3Turnover_d_BJReturV3Item_d
        FOREIGN KEY (IdItem) REFERENCES dbo.BJReturV3Item_d (IdItem);
GO

-- 3. Drop tabel target + audit trigger-nya.
IF OBJECT_ID('dbo.tr_Audit_BJReturV3TurnoverTarget_d', 'TR') IS NOT NULL
    DROP TRIGGER dbo.tr_Audit_BJReturV3TurnoverTarget_d;
GO

IF OBJECT_ID('dbo.BJReturV3TurnoverTarget_d', 'U') IS NOT NULL
    DROP TABLE dbo.BJReturV3TurnoverTarget_d;
GO
