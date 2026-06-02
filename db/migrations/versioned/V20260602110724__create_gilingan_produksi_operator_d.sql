CREATE TABLE [dbo].[GilinganProduksiOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL, -- Menyesuaikan dengan kolom key dari GilinganProduksi_h
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_GilinganProduksiOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_GilinganProduksiOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel GilinganProduksi_h
    CONSTRAINT [FK_GilinganProduksiOperator_GilinganProduksi_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[GilinganProduksi_h] ([NoProduksi])
);
GO