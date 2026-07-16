-- ================================================================
-- Migration: Create MstLokasiJenis (child table for multiple IdKategori + IdJenis)
-- ================================================================
-- Before: MstLokasi.IdKategori INT NULL + IdJenis INT NULL (single values)
-- After:  MstLokasiJenis(Blok, IdLokasi, IdKategori, IdJenis) — one row per kategori-jenis pair

-- 1. Create child table
CREATE TABLE [dbo].[MstLokasiJenis] (
    Blok       VARCHAR(100) NOT NULL,
    IdLokasi   INT          NOT NULL,
    IdKategori INT          NOT NULL,
    IdJenis    INT          NOT NULL,
    CONSTRAINT PK_MstLokasiJenis PRIMARY KEY CLUSTERED (Blok, IdLokasi, IdKategori, IdJenis)
);
GO

-- 2. Migrate existing data
INSERT INTO [dbo].[MstLokasiJenis] (Blok, IdLokasi, IdKategori, IdJenis)
SELECT Blok, IdLokasi, IdKategori, IdJenis
FROM [dbo].[MstLokasi]
WHERE IdKategori IS NOT NULL AND IdJenis IS NOT NULL;
GO

-- 3. Drop old single-value columns
ALTER TABLE [dbo].[MstLokasi] DROP COLUMN IdKategori;
ALTER TABLE [dbo].[MstLokasi] DROP COLUMN IdJenis;
GO
