-- ================================================================
-- Migration: Tambah NoPartial ke dbo.BJJualScanLabel_d
-- ================================================================
-- Saat label yang discan pcs-nya melebihi sisa kebutuhan baris
-- BJJualItem_d, handler scan (src/modules/penjualan/handlers/
-- scan-label.handler.js) memecah label jadi partial: INSERT ke
-- dbo.BarangJadiPartial (prefix BL.) / dbo.FurnitureWIPPartial
-- (prefix BC.), set parent IsPartial = 1, parent DateUsage tetap NULL.
-- Sisa terakhir sebuah label yang SUDAH pernah dipecah juga dicatat
-- sebagai baris partial (lihat handler).
--
-- Sebelum ini kode partial (partialCode) cuma dikembalikan di response
-- HTTP, TIDAK pernah disimpan. NoLabel di BJJualScanLabel_d selalu kode
-- label FISIK asli (audit trail harus match dengan yang discan operator).
-- Akibatnya, kalau label fisik yang sama dipecah lebih dari sekali
-- (lintas BJJual / baris berbeda), ada beberapa baris BJJualScanLabel_d
-- dengan NoLabel identik dan tidak ada yang mencatat baris mana
-- menghasilkan partial BL./BC. yang mana — link partial<->scan hilang.
--
-- Kolom ini menutup gap tsb TANPA mengubah model "satu baris per scan".
-- NoPartial adalah fakta TAMBAHAN di samping NoLabel, bukan alternatifnya:
--   NoLabel   -> barcode fisik yang discan operator (selalu terisi).
--   NoPartial -> IS NULL     : konsumsi 1x-penuh atas label yang belum
--                              pernah dipecah (consumed = Pcs parent utuh).
--                IS NOT NULL : semua kasus lain; nilainya =
--                              BarangJadiPartial.NoBJPartial /
--                              FurnitureWIPPartial.NoFurnitureWIPPartial.
--
-- Tanpa FK: target polymorphic per KodeKategori, sama seperti NoLabel
-- sekarang — integritas dijaga di level aplikasi, konsisten dengan modul.
-- Kolom TIDAK masuk perhitungan turnover apa pun (SUM(Pcs)/COUNT tetap
-- pakai NoBJJual+KodeKategori+IdJenis).
--
-- Baris lama dibiarkan NULL: informasi partial-nya memang tidak pernah
-- ditangkap dan tidak bisa direkonstruksi tanpa ambiguitas.
--
-- Idempotent: guard COL_LENGTH + cek sys.indexes.
-- ================================================================

IF COL_LENGTH('dbo.BJJualScanLabel_d', 'NoPartial') IS NULL
    ALTER TABLE dbo.BJJualScanLabel_d ADD NoPartial VARCHAR(50) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_BJJualScanLabel_d_NoPartial'
      AND object_id = OBJECT_ID('dbo.BJJualScanLabel_d')
)
    CREATE INDEX IX_BJJualScanLabel_d_NoPartial
        ON dbo.BJJualScanLabel_d (NoPartial)
        WHERE NoPartial IS NOT NULL;
GO
