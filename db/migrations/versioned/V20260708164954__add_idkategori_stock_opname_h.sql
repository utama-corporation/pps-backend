-- Sejak stock-opname-v2, 1 NoSO selalu mencakup 1 kategori saja. IdKategori jadi sumber
-- kebenaran kategori per NoSO (join langsung ke MstKategori), menggantikan kebutuhan membaca
-- 10+ kolom Is{Kategori} satu-satu. Kolom Is{Kategori} tetap dipertahankan agar endpoint v1
-- yang sudah ada tidak perlu diubah.

ALTER TABLE dbo.StockOpname_h ADD IdKategori INT NULL;
