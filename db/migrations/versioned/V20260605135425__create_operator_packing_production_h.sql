CREATE TABLE [dbo].[PackingProduksiOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoPacking] VARCHAR(13) NOT NULL, -- Menyesuaikan nama dan panjang tipe data dari header Packing
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_PackingProduksiOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_PackingProduksiOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel PackingProduksi_h
    CONSTRAINT [FK_PackingProduksiOperator_PackingProduksi_h] 
        FOREIGN KEY ([NoPacking]) REFERENCES [dbo].[PackingProduksi_h] ([NoPacking])
);
GO