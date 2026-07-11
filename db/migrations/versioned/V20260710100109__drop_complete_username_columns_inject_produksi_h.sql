-- CompleteRequestedBy/CompleteDecisionBy (IdUsername) sudah cukup untuk identifikasi
-- actor; kolom *ByUsername redundant dan dihapus.
-- Guard IF COL_LENGTH agar aman dijalankan meski kolom sudah pernah didrop manual.

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteRequestedByUsername') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteRequestedByUsername;

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteDecisionByUsername') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteDecisionByUsername;
