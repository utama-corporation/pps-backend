-- ================================================================
-- Migration: Bongkar Susun v2 - label Reject (BF.) sebagai input/output
-- ================================================================
-- Menambah tiga tabel pemetaan agar bongkar-susun-v2 bisa memakai dan
-- menerbitkan label reject (dbo.RejectV2, prefix "BF."):
--
--   BongkarSusunInputReject        (NoBongkarSusun, NoReject)
--   BongkarSusunOutputReject       (NoBongkarSusun, NoReject)
--   BongkarSusunInputRejectPartial (NoBongkarSusun, NoRejectPartial)
--
-- BongkarSusunInputReject + BongkarSusunInputRejectPartial meniru pola
-- furnitureWip / barangJadi / mixer: tabel input menyimpan labelnya saja,
-- sedangkan jumlah berat yang benar-benar terpakai siklus ini disimpan di
-- dbo.RejectV2Partial yang ditautkan lewat tabel link. Dengan begitu satu
-- label reject bisa dipecah beberapa kali (oleh bongkar-susun maupun oleh
-- produksi broker/crusher/gilingan) tanpa menimpa berat yang sudah terpakai.
--
--   - label sekali pakai penuh, tidak pernah dipecah -> tanpa baris link,
--     berat terpakai = RejectV2.Berat
--   - label yang sudah pernah dipecah                 -> ada baris link,
--     berat terpakai = SUM(RejectV2Partial.Berat) milik baris itu
--
-- TIDAK ada "berat terjual ganda": satu label = satu baris input.
--
-- Kolom & FK meniru BongkarSusunInputFurnitureWIPPartial / ..MixerPartial
-- persis: NoBongkarSusun varchar(13) -> BongkarSusun_h, dan kolom label
-- varchar(13) -> RejectV2 / RejectV2Partial (BF./BK. + 10 digit = 13).
-- FK ke tabel partial dihapus lebih dulu di service delete, baru baris
-- partialnya, jadi urutannya tidak self-reference.
--
-- Idempotent: guard OBJECT_ID.
-- ================================================================

IF OBJECT_ID('dbo.BongkarSusunInputReject', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BongkarSusunInputReject] (
        [NoBongkarSusun] VARCHAR(13) NOT NULL,
        [NoReject]       VARCHAR(13) NOT NULL,

        CONSTRAINT [PK_BongkarSusunInputReject]
            PRIMARY KEY CLUSTERED ([NoBongkarSusun] ASC, [NoReject] ASC),

        CONSTRAINT [FK_BongkarSusunInputReject_BongkarSusun_h]
            FOREIGN KEY ([NoBongkarSusun])
            REFERENCES [dbo].[BongkarSusun_h] ([NoBongkarSusun]),

        CONSTRAINT [FK_BongkarSusunInputReject_RejectV2]
            FOREIGN KEY ([NoReject])
            REFERENCES [dbo].[RejectV2] ([NoReject])
    );
END
GO

IF OBJECT_ID('dbo.BongkarSusunOutputReject', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BongkarSusunOutputReject] (
        [NoBongkarSusun] VARCHAR(13) NOT NULL,
        [NoReject]       VARCHAR(13) NOT NULL,

        CONSTRAINT [PK_BongkarSusunOutputReject]
            PRIMARY KEY CLUSTERED ([NoBongkarSusun] ASC, [NoReject] ASC),

        CONSTRAINT [FK_BongkarSusunOutputReject_BongkarSusun_h]
            FOREIGN KEY ([NoBongkarSusun])
            REFERENCES [dbo].[BongkarSusun_h] ([NoBongkarSusun]),

        CONSTRAINT [FK_BongkarSusunOutputReject_RejectV2]
            FOREIGN KEY ([NoReject])
            REFERENCES [dbo].[RejectV2] ([NoReject])
    );
END
GO

IF OBJECT_ID('dbo.BongkarSusunInputRejectPartial', 'U') IS NULL
BEGIN
    -- SENGAJA TANPA FK ke RejectV2Partial: tabel itu warisan dan
    -- NoRejectPartial-nya tidak punya PK/unique key, jadi SQL Server menolak
    -- FK ("no primary or candidate keys in the referenced table").
    --_noRejectPartial varchar(13) + index nonclustered sudah cukup untuk lookup
    -- delete, dan integritas dijaga urutan delete di service.
    CREATE TABLE [dbo].[BongkarSusunInputRejectPartial] (
        [NoBongkarSusun]  VARCHAR(13) NOT NULL,
        [NoRejectPartial] VARCHAR(13) NOT NULL,

        CONSTRAINT [PK_BongkarSusunInputRejectPartial]
            PRIMARY KEY CLUSTERED ([NoBongkarSusun] ASC, [NoRejectPartial] ASC),

        CONSTRAINT [FK_BongkarSusunInputRejectPartial_BongkarSusun_h]
            FOREIGN KEY ([NoBongkarSusun])
            REFERENCES [dbo].[BongkarSusun_h] ([NoBongkarSusun])
    );
END
GO

-- Lookup halaman detail / delete / laporan selalu memfilter per
-- NoBongkarSusun lalu join ke tabel label, jadi index label dipakai juga.
IF OBJECT_ID('dbo.BongkarSusunInputReject', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_BongkarSusunInputReject_NoReject'
                     AND object_id = OBJECT_ID('dbo.BongkarSusunInputReject'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_BongkarSusunInputReject_NoReject]
        ON [dbo].[BongkarSusunInputReject] ([NoReject] ASC);
END
GO

IF OBJECT_ID('dbo.BongkarSusunOutputReject', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_BongkarSusunOutputReject_NoReject'
                     AND object_id = OBJECT_ID('dbo.BongkarSusunOutputReject'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_BongkarSusunOutputReject_NoReject]
        ON [dbo].[BongkarSusunOutputReject] ([NoReject] ASC);
END
GO

IF OBJECT_ID('dbo.BongkarSusunInputRejectPartial', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_BongkarSusunInputRejectPartial_NoRejectPartial'
                     AND object_id = OBJECT_ID('dbo.BongkarSusunInputRejectPartial'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_BongkarSusunInputRejectPartial_NoRejectPartial]
        ON [dbo].[BongkarSusunInputRejectPartial] ([NoRejectPartial] ASC);
END
GO