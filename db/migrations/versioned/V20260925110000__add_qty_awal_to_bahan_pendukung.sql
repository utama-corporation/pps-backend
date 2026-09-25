-- ================================================================
-- Migration: Tambah QtyAwal di dbo.BahanPendukung
-- ================================================================
-- Qty di dbo.BahanPendukung adalah stok LIVE: dikurangi setiap kali
-- proses produksi mengkonsumsi bahan pendukung secara parsial
-- (SET b.Qty = b.Qty - a.ConQty di produksi-upsert-sql.generator.js,
-- bagian _generatePartialMarkUsageSection).
--
-- Akibatnya, riwayat penerimaan bahan pendukung (GET
-- /api/penerimaan-bahan-pendukung/:noPenerimaan) yang membaca bp.Qty
-- ikut berkurang mengikuti sisa stok — bukan kuantitas asli saat
-- penerimaan.
--
-- Solusi: tambah QtyAwal — snapshot kuantitas asli saat penerimaan,
-- diisi SEKALI saat insert (addItems fase 2) dan TIDAK pernah
-- disentuh oleh konsumsi parsial produksi. Layar penerimaan memakai
-- QtyAwal, sementara stok di proses produksi tetap memakai Qty (live).
-- ================================================================

IF COL_LENGTH('dbo.BahanPendukung', 'QtyAwal') IS NULL
BEGIN
    ALTER TABLE dbo.BahanPendukung
        ADD QtyAwal DECIMAL(18, 3) NULL;
END
GO

-- Backfill: untuk penerimaan lama, jadikan Qty saat ini sebagai QtyAwal
-- (nilai asli riwayat lama yang sudah terlanjur terpotong tidak bisa
-- direkonstruksi lagi).
UPDATE dbo.BahanPendukung
SET QtyAwal = Qty
WHERE QtyAwal IS NULL;
GO