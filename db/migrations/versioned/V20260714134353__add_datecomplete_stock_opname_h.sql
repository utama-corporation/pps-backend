-- stock-opname-v2: catat KAPAN sesi opname ditandai selesai, bukan cuma statusnya
-- (IsComplete). Diisi bareng saat IsComplete di-set 1 di completeStockOpname,
-- tetap NULL selama sesi masih berjalan.

ALTER TABLE dbo.StockOpname_h ADD DateComplete DATETIME NULL;
