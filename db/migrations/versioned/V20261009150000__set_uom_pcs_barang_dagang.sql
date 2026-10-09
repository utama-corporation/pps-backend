-- ================================================================
-- Migration: Set UOM Barang Dagang ke PCS di MstKategori
--
-- Master barang (MstBarangDagang) tidak punya nilai IdUOM yang
-- terisi, jadi UOM label barang dagang diambil dari level kategori
-- (MstKategori.IdUOM -> MstUOM.NamaUOM). Row kategori Barang Dagang
-- ada dengan IdUOM = 2 (KG), padahal barang dagang dihitung PCS.
--
-- Dampaknya di modul mapping (mapping-service.js):
--   const uom = String(jenisList[0]?.NamaUOM || "").toLowerCase();
--   TotalQty:   uom === "kg"  ? 0 : agg.TotalQty,
--   TotalBerat: uom === "pcs" ? 0 : agg.TotalBerat,
--
-- Dengan KG, begitu sebuah lokasi didaftarkan berisi jenis barang
-- dagang, TotalQty di layar mapping dikembalikan 0 dan yang tampil
-- TotalBerat — padahal dbo.BarangDagang tidak punya kolom Berat
-- sama sekali, jadi angkanya selalu 0. Efeknya lokasi barang dagang
-- terlihat kosong padahal isinya ada.
--
-- IdUOM = 5 = PCS (lihat dbo.MstUOM).
--
-- CATATAN: dbo.BahanPendukung (IdUOM = 2) SENGAJA TIDAK disentuh
-- di migration ini — outside of scope, perlu keputusan terpisah.
-- ================================================================
UPDATE dbo.MstKategori
SET IdUOM = 5   -- PCS
WHERE KodeKategori = N'barangadagang'
  AND ISNULL(IdUOM, 0) <> 5;
GO