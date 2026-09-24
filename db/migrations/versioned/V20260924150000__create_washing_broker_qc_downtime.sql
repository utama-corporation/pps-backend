IF OBJECT_ID('dbo.WashingProduksiQc', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.WashingProduksiQc (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WashingProduksiQc PRIMARY KEY,
        NoProduksi nvarchar(50) NOT NULL,
        IdMesin int NULL,
        Keterangan nvarchar(500) NOT NULL,
        DateTimeCreate datetime NOT NULL CONSTRAINT DF_WashingProduksiQc_DateTimeCreate DEFAULT (GETDATE()),
    );
    CREATE INDEX IX_WashingProduksiQc_NoProduksi ON dbo.WashingProduksiQc (NoProduksi);
END
GO

IF OBJECT_ID('dbo.BrokerProduksiQc', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BrokerProduksiQc (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BrokerProduksiQc PRIMARY KEY,
        NoProduksi nvarchar(50) NOT NULL,
        IdMesin int NULL,
        Keterangan nvarchar(500) NOT NULL,
        DateTimeCreate datetime NOT NULL CONSTRAINT DF_BrokerProduksiQc_DateTimeCreate DEFAULT (GETDATE()),
    );
    CREATE INDEX IX_BrokerProduksiQc_NoProduksi ON dbo.BrokerProduksiQc (NoProduksi);
END
GO