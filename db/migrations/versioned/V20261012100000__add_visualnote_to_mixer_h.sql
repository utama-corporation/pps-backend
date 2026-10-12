-- Tambah kolom VisualNote untuk catatan QC visual pada header label mixer.
-- Tipe & panjang disamakan dengan Broker_h.VisualNote (varchar(150) NULL)
-- supaya konsisten dengan dialog QC broker yang sudah ada.
IF COL_LENGTH('dbo.Mixer_h', 'VisualNote') IS NULL
BEGIN
    ALTER TABLE dbo.Mixer_h ADD VisualNote varchar(150) NULL;
END
GO