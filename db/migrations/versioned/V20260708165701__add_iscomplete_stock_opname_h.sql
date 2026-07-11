-- Penanda selesai per NoSO, dipicu manual oleh user (bukan otomatis). Sekali true, NoSO
-- dikunci dari perubahan lebih lanjut (lihat assertStockOpnameNotComplete di
-- src/core/shared/stock-opname-lock-guard.js).

ALTER TABLE dbo.StockOpname_h ADD IsComplete BIT NOT NULL DEFAULT 0;
