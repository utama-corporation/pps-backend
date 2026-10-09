-- ================================================================
-- Migration: Hapus kolom QtyAwal dari BarangDagang
--
-- QtyAwal sempat ditambahkan di V20260925140000 dengan menyalin pola
-- BahanPendukung, di mana QtyAwal = snapshot kuantitas pembelian
-- sedangkan Qty = stok live. Untuk BarangDagang pola itu tidak pernah
-- terjadi:
--
--   - Tidak ada alur yang memotong Qty label BarangDagang. Satu-satunya
--     UPDATE ke dbo.BarangDagang hanya dari modul label (edit data &
--     increment HasBeenPrinted), dan saat edit Qty selalu diisi dengan
--     nilai QtyAwal itu sendiri.
--   - Tidak ada tabel log konsumsi, berbanding BahanPendukung yang
--     punya dbo.BahanPendukungKonsumsi_d + recalc Qty di
--     V20260925130000.
--   - Audit trigger R__tr_Audit_BarangDagang.sql tidak pernah menulis
--     QtyAwal ke AuditTrail, jadi tidak ada data historis yang hilang.
--
-- Akibatnya guard "sudah dipakai sebagian" (Qty <> QtyAwal) selalu false
-- dan QtyAwal selalu identik dengan Qty, jadi kolomnya dihapus agar
-- tidak menyesatkan.
--
-- CATATAN: QtyAwal di dbo.BahanPendukung SENGAJA TIDAK disentuh — modul
-- itu memang punya konsumsi parsial produksi yang memotong Qty.
-- ================================================================

-- Guard IF COL_LENGTH agar aman dijalankan meski kolom sudah pernah
-- didrop manual.
IF COL_LENGTH('dbo.BarangDagang', 'QtyAwal') IS NOT NULL
    ALTER TABLE dbo.BarangDagang DROP COLUMN QtyAwal;
GO