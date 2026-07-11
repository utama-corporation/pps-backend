-- QC counter checkpoint per mesin untuk InjectProduksi.
-- Berdiri sendiri: NILAI counter independen dari MstMesinInject.CounterCurrent,
-- tetapi IdMesin WAJIB merujuk ke mesin yang terdaftar di MstMesinInject (FK).
-- Satu baris per IdMesin. CounterCurrent = floor counter QC terakhir mesin tsb;
-- input QC baru hanya boleh disimpan bila counter >= CounterCurrent mesinnya.
-- Bisa di-reset per mesin lewat endpoint khusus.
CREATE TABLE [dbo].[InjectProduksiQcCounter] (
    [IdMesin]        INT         NOT NULL,
    [CounterCurrent] INT         NOT NULL CONSTRAINT [DF_InjectProduksiQcCounter_CounterCurrent] DEFAULT (0),
    [UpdatedBy]      VARCHAR(50) NULL,
    [DateTimeUpdate] DATETIME    NULL,

    CONSTRAINT [PK_InjectProduksiQcCounter] PRIMARY KEY CLUSTERED ([IdMesin] ASC),
    CONSTRAINT [FK_InjectProduksiQcCounter_MstMesinInject]
        FOREIGN KEY ([IdMesin]) REFERENCES [dbo].[MstMesinInject] ([IdMesin]),
    CONSTRAINT [CK_InjectProduksiQcCounter_NonNegative] CHECK ([CounterCurrent] >= 0)
);
GO
