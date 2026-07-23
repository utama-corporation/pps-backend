-- Menyimpan defisit pcs label terakhir (partial) per kombinasi mesin+jenis
-- output inject, lintas NoProduksi. Dipakai supaya saat NoProduksi baru dibuka
-- di mesin+jenis yang sama, target pcs-per-label awal mulai dari sisa defisit
-- (bukan langsung pcsPerLabel standar), sampai defisit itu "dipakai" (consumed).
-- Satu baris per (IdMesin, IdJenis, OutputCategory) — upsert, bukan history.
CREATE TABLE [dbo].[InjectPcsPerLabelPending] (
    [IdMesin]              INT          NOT NULL,
    [IdJenis]              INT          NOT NULL,
    [OutputCategory]       VARCHAR(20)  NOT NULL,
    [PcsPending]           INT          NOT NULL,
    [SourceNoProduksi]     VARCHAR(50)  NOT NULL,
    [IsConsumed]           BIT          NOT NULL CONSTRAINT [DF_InjectPcsPerLabelPending_IsConsumed] DEFAULT (0),
    [ConsumedByNoProduksi] VARCHAR(50)  NULL,
    [DateTimeCreate]       DATETIME     NOT NULL,
    [DateTimeConsumed]     DATETIME     NULL,

    CONSTRAINT [PK_InjectPcsPerLabelPending]
        PRIMARY KEY CLUSTERED ([IdMesin] ASC, [IdJenis] ASC, [OutputCategory] ASC),
    CONSTRAINT [FK_InjectPcsPerLabelPending_MstMesinInject]
        FOREIGN KEY ([IdMesin]) REFERENCES [dbo].[MstMesinInject] ([IdMesin]),
    CONSTRAINT [CK_InjectPcsPerLabelPending_OutputCategory]
        CHECK ([OutputCategory] IN ('furnitureWip', 'barangjadi')),
    CONSTRAINT [CK_InjectPcsPerLabelPending_PcsPending_Positive]
        CHECK ([PcsPending] > 0)
);
GO
