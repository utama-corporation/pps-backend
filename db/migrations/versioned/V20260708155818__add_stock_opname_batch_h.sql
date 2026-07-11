-- Header batch bulanan untuk stock-opname-v2: menaungi banyak NoSO (yang sekarang masing-masing
-- hanya mencakup 1 kategori) dalam satu periode (bulan) yang sama. Dibuat otomatis oleh service
-- saat kategori pertama di bulan tersebut di-generate.

CREATE TABLE dbo.StockOpnameBatch_h (
    NoBatch VARCHAR(20) NOT NULL PRIMARY KEY,
    Periode VARCHAR(7) NOT NULL,
    Tanggal DATE NOT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    CreatedBy VARCHAR(128) NULL,
    CONSTRAINT UQ_StockOpnameBatch_h_Periode UNIQUE (Periode)
);

-- Nullable: baris StockOpname_h lama (dari v1, sebelum konsep batch ada) tidak punya batch.
ALTER TABLE dbo.StockOpname_h ADD NoBatch VARCHAR(20) NULL;
