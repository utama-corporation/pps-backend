-- Flow completion approval hanya mengenal approve (validasi atasan), tidak ada
-- reject formal, jadi CompleteRejectReason tidak pernah terisi.
-- Guard IF COL_LENGTH agar aman dijalankan meski kolom sudah pernah didrop manual.

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteRejectReason') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteRejectReason;
