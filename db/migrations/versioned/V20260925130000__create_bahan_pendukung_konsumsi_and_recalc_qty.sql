-- ================================================================
-- Migration: Tabel log konsumsi BahanPendukung + hitung ulang Qty
-- ================================================================
-- MASALAH pada metode mark-usage sebelumnya:
--   - Konsumsi PARSIAL (bpPartials, qty < sisa) → Qty label dikurangi
--     (sudah benar).
--   - Konsumsi PENUH (DateUsage set) → Qty label TIDAK diubah, sehingga
--     label yang sudah terpakai masih tampil punya stok penuh.
--   - Release/undo input produksi → hanya melepas DateUsage, Qty tidak
--     dikembalikan (jumlah konsumsi per label tidak pernah tersimpan).
--
-- SOLUSI:
--   1. Tabel BahanPendukungKonsumsi_d mencatat qty konsumsi per
--      (NoProduksi, NoBahanPendukung) saat label dipakai oleh produksi.
--   2. Konsumsi PENUH sekarang meng-zero Qty label (sisa = 0); konsumsi
--      parsial tetap menguranginya.
--   3. Release/undo input produksi mengembalikan Qty dari log konsumsi.
--   4. Recalc: label yang sudah terpakai penuh (DateUsage IS NOT NULL)
--      → Qty = 0 di seluruh database.
-- ================================================================

IF OBJECT_ID(N'dbo.BahanPendukungKonsumsi_d', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.BahanPendukungKonsumsi_d (
        NoProduksi        varchar(50)   NOT NULL,
        NoBahanPendukung  varchar(50)   NOT NULL,
        QtyKonsumsi       decimal(18,3) NOT NULL,
        CreateBy          varchar(100)  NULL,
        DateTimeCreate    datetime      NOT NULL CONSTRAINT DF_BahanPendukungKonsumsi_DateTimeCreate DEFAULT SYSDATETIME(),
        CONSTRAINT PK_BahanPendukungKonsumsi_d PRIMARY KEY (NoProduksi, NoBahanPendukung)
    );
END
GO

-- Recalc: label yang sudah dikonsumsi penuh → sisa 0.
UPDATE dbo.BahanPendukung
SET Qty = 0
WHERE DateUsage IS NOT NULL;
GO