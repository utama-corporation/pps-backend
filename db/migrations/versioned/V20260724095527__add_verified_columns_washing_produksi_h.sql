-- Status "sudah diverifikasi" ditentukan dari VerifiedAt IS NOT NULL,
-- tidak pakai kolom bit terpisah. VerifiedBy simpan id user saja (tanpa
-- kolom username terdenormalisasi), konsisten dengan pola terbaru di Inject.
ALTER TABLE dbo.WashingProduksi_h ADD
    VerifiedBy int NULL,
    VerifiedAt datetime2 NULL,
    VerifiedNote nvarchar(500) NULL;
GO
