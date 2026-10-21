-- ================================================================
-- Migration: Create BJReturBarangDagang_d
-- Detail retur lama (BJRetur_h): ikat NoRetur ke label BarangDagang yang
-- dibuat dari form retur. Sejajar BJReturBarangJadi_d & BJReturFurnitureWIP_d.
-- ================================================================
IF OBJECT_ID('dbo.BJReturBarangDagang_d', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BJReturBarangDagang_d] (
        [NoRetur]         VARCHAR(13) NOT NULL,
        [NoBarangDagang]  VARCHAR(50) NOT NULL,
        CONSTRAINT [PK_BJReturBarangDagang_d]
            PRIMARY KEY CLUSTERED ([NoRetur] ASC, [NoBarangDagang] ASC),
        CONSTRAINT [FK_BJReturBarangDagang_d_BJRetur_h]
            FOREIGN KEY ([NoRetur]) REFERENCES [dbo].[BJRetur_h] ([NoRetur]),
        CONSTRAINT [FK_BJReturBarangDagang_d_BarangDagang]
            FOREIGN KEY ([NoBarangDagang]) REFERENCES [dbo].[BarangDagang] ([NoBarangDagang])
    );
END
GO
