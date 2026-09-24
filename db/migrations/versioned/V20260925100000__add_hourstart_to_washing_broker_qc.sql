-- Tambah kolom HourStart untuk QC tiap jam (window per bucket jam produksi)
-- pada catatan downtime washing & broker — pola sama dengan InjectProduksi_QC.
IF COL_LENGTH('dbo.WashingProduksiQc', 'HourStart') IS NULL
BEGIN
    ALTER TABLE dbo.WashingProduksiQc ADD HourStart varchar(5) NULL;
END
GO

IF COL_LENGTH('dbo.BrokerProduksiQc', 'HourStart') IS NULL
BEGIN
    ALTER TABLE dbo.BrokerProduksiQc ADD HourStart varchar(5) NULL;
END
GO