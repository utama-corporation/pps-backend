-- ================================================================
-- Migration: Tambah kolom QtyAwal ke BarangDagang
-- Mirror V20260925110000__add_qty_awal_to_bahan_pendukung.sql.
-- QtyAwal = snapshot kuantitas awal pada saat label diterima (created),
-- tidak pernah berubah setelahnya; Qty = stok live yang berkurang saat
-- label dipakai / dikonsumsi di proses lain.
-- ================================================================
IF COL_LENGTH('dbo.BarangDagang', 'QtyAwal') IS NULL
BEGIN
    ALTER TABLE [dbo].[BarangDagang]
        ADD [QtyAwal] DECIMAL(18,3) NULL;
END
GO

-- Backfill: kuantitas awal untuk data lama = Qty saat ini (karena belum
-- pernah ada pemakaian yang mengubah Qty untuk BarangDagang).
UPDATE dbo.BarangDagang
SET QtyAwal = Qty
WHERE QtyAwal IS NULL;
GO