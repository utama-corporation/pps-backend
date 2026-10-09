-- ================================================================
-- Migration: Set UOM Bahan Pendukung ke PCS + kapitalisasi nama tabel
--
-- Ikut V20261009150000 (barang dagang). Bahaya yang sama:
-- mapping-service.js memakai UOM kategori untuk memutuskan kolom mana
-- yang ditampilkan:
--
--   const uom = String(jenisList[0]?.NamaUOM || "").toLowerCase();
--   TotalQty:   uom === "kg"  ? 0 : agg.TotalQty,
--   TotalBerat: uom === "pcs" ? 0 : agg.TotalBerat,
--
-- dbo.BahanPendukung tidak punya kolom Berat (sudah dihapus di
-- V20260821180000__drop_idwarna_berat_bahan_pendukung.sql), jadi begitu
-- lokasi BP didaftarkan, TotalQty dikali 0 dan TotalBerat juga 0 -
-- lokasi terlihat kosong padahal isinya ada.
--
-- Bahan Pendukung dihitung PCS, bukan KG:
--   - konsumsi produksi dicatat di dbo.BahanPendukungKonsumsi_d
--     (V20260925130000) kolom QtyKonsumsi, satuan PCS
--   - label-service.js "bahanpendukung" mengembalikan ISNULL(t.Qty, 0)
--     sebagai Qty dan 0 sebagai Berat
--   - app membaca sisa stok BP lewat QtySisa dengan satuan PCS
--
-- Sekalian: NamaTableLabel tersimpan sebagai 'Bahanpendukung' (p kecil)
-- sedangkan tabelnya dbo.BahanPendukung. Sekarang tidak masalah karena
-- collation DB case-insensitive, tapi kapitalisasi supaya konsisten dengan
-- nama tabel sebenarnya dan aman kalau collation-nya berubah.
--
-- IdUOM = 5 = PCS (lihat dbo.MstUOM).
-- ================================================================
UPDATE dbo.MstKategori
SET IdUOM = 5   -- PCS
WHERE KodeKategori = N'bahanpendukung'
  AND ISNULL(IdUOM, 0) <> 5;
GO

UPDATE dbo.MstKategori
SET NamaTableLabel = N'BahanPendukung'
WHERE KodeKategori = N'bahanpendukung'
  AND NamaTableLabel = N'Bahanpendukung';
GO