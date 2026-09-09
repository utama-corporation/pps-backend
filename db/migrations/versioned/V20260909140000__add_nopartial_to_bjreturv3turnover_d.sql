-- ================================================================
-- Migration: Tambah NoPartial ke dbo.BJReturV3Turnover_d
-- ================================================================
-- Retur-v3 turnover scan sekarang mendukung "partial consumption" label
-- (paritas dengan modul penjualan): kalau pcs label melebihi sisa target
-- BJReturV3TurnoverTarget_d, backend memecah label jadi baris partial di
-- dbo.BarangJadiPartial (prefix BL.) / dbo.FurnitureWIPPartial (prefix
-- BC.) sejumlah sisa kebutuhan, set parent IsPartial = 1. Sisa terakhir
-- label yang SUDAH pernah dipecah juga dicatat sebagai baris partial.
--
-- LabelCode di BJReturV3Turnover_d TETAP kode label FISIK asli yang discan
-- operator (audit trail). NoPartial adalah fakta TAMBAHAN di sampingnya:
--   NoPartial IS NULL     -> konsumsi 1x-penuh atas label yang belum pernah
--                            dipecah (scan ini yang men-stamp DateUsage).
--   NoPartial IS NOT NULL -> baris *Partial dibuat oleh scan ini; nilainya =
--                            BarangJadiPartial.NoBJPartial /
--                            FurnitureWIPPartial.NoFurnitureWIPPartial.
--
-- Dipakai oleh undoScan untuk mengurai partial dengan benar (hapus baris
-- *Partial, hitung ulang IsPartial parent).
--
-- Tanpa FK: target polymorphic per KodeKategori (via BJReturV3TurnoverTarget_d),
-- sama seperti LabelCode. Kolom TIDAK masuk perhitungan turnover apa pun
-- (SUM(Pcs) tetap sumber progres); NoPartial murni informasional + untuk undo.
--
-- Baris lama dibiarkan NULL.
-- Idempotent: guard COL_LENGTH + cek sys.indexes.
-- ================================================================

IF COL_LENGTH('dbo.BJReturV3Turnover_d', 'NoPartial') IS NULL
    ALTER TABLE dbo.BJReturV3Turnover_d ADD NoPartial VARCHAR(50) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_BJReturV3Turnover_d_NoPartial'
      AND object_id = OBJECT_ID('dbo.BJReturV3Turnover_d')
)
    CREATE INDEX IX_BJReturV3Turnover_d_NoPartial
        ON dbo.BJReturV3Turnover_d (NoPartial)
        WHERE NoPartial IS NOT NULL;
GO
