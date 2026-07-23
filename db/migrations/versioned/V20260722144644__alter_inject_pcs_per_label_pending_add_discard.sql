-- Operator bisa memilih abaikan target awal (pending) dan langsung pakai
-- pcsPerLabel standar. Beda dari "consumed" (target awal benar-benar
-- terpenuhi dan jadi label) — discard membatalkan defisit itu permanen,
-- tidak akan ditawarkan lagi ke sesi manapun berikutnya.
ALTER TABLE [dbo].[InjectPcsPerLabelPending]
    ADD [IsDiscarded]           BIT         NOT NULL CONSTRAINT [DF_InjectPcsPerLabelPending_IsDiscarded] DEFAULT (0),
        [DiscardedByNoProduksi] VARCHAR(50) NULL,
        [DateTimeDiscarded]     DATETIME    NULL;
GO
