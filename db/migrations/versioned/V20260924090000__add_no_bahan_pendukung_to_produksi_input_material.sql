-- Tambah kolom NoBahanPendukung (daftar label Bahan Pendukung BP. yang dipakai
-- material kabinet, dipisah koma / dedup) ke 5 tabel input material produksi.
--
-- Tujuan: NoBP tersimpan per baris input sehingga GET inputs mengembalikannya
-- & UI tablet menampilkan hasil inputan material lengkap dengan label BP-nya.
-- Dipakai oleh:
--   * SQL generator upsert inputs (produksi-upsert-sql.generator.js)
--   * fetch inputs masing-masing modul (hasil inputan)
-- Nilai NULL bila material diinput tanpa scan label (manual).

SET XACT_ABORT ON;
BEGIN TRAN;

IF COL_LENGTH('dbo.InjectProduksiInputCabinetMaterial', 'NoBahanPendukung') IS NULL
    ALTER TABLE dbo.InjectProduksiInputCabinetMaterial
        ADD NoBahanPendukung nvarchar(MAX) NULL;

IF COL_LENGTH('dbo.HotStampingInputMaterial', 'NoBahanPendukung') IS NULL
    ALTER TABLE dbo.HotStampingInputMaterial
        ADD NoBahanPendukung nvarchar(MAX) NULL;

IF COL_LENGTH('dbo.PasangKunciInputMaterial', 'NoBahanPendukung') IS NULL
    ALTER TABLE dbo.PasangKunciInputMaterial
        ADD NoBahanPendukung nvarchar(MAX) NULL;

IF COL_LENGTH('dbo.SpannerInputMaterial', 'NoBahanPendukung') IS NULL
    ALTER TABLE dbo.SpannerInputMaterial
        ADD NoBahanPendukung nvarchar(MAX) NULL;

IF COL_LENGTH('dbo.PackingProduksiInputMaterial', 'NoBahanPendukung') IS NULL
    ALTER TABLE dbo.PackingProduksiInputMaterial
        ADD NoBahanPendukung nvarchar(MAX) NULL;

COMMIT;