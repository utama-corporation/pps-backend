-- Kategori bahanbaku (prefix A.) dan bahanbakupakai (prefix AB.) memakai tabel produksi/snapshot
-- yang sama (BahanBakuPallet_h / StockOpnameBahanBaku), tapi dipilih & ditandai sebagai kategori
-- terpisah saat generate stock-opname. StockOpname_h butuh flag tersendiri untuk bahanbakupakai.

ALTER TABLE dbo.StockOpname_h ADD IsBahanBakuPakai BIT NULL;
