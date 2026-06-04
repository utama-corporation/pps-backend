CREATE TABLE [dbo].[MixerProduksiOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL, -- Menyesuaikan panjang tipe data NoProduksi dari header Mixer
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_MixerProduksiOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_MixerProduksiOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel MixerProduksi_h
    CONSTRAINT [FK_MixerProduksiOperator_MixerProduksi_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[MixerProduksi_h] ([NoProduksi])
);
GO