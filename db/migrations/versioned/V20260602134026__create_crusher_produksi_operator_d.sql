CREATE TABLE [dbo].[CrusherProduksiOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoCrusherProduksi] VARCHAR(13) NOT NULL, -- Menyesuaikan panjang tipe data NoCrusherProduksi dari header
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_CrusherProduksiOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_CrusherProduksiOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel CrusherProduksi_h (Opsional, tapi sangat disarankan untuk menjaga integritas data)
    CONSTRAINT [FK_CrusherProduksiOperator_CrusherProduksi_h] 
        FOREIGN KEY ([NoCrusherProduksi]) REFERENCES [dbo].[CrusherProduksi_h] ([NoCrusherProduksi])
);
GO