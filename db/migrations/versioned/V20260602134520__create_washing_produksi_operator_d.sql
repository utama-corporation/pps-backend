CREATE TABLE [dbo].[WashingProduksiOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL,
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_WashingProduksiOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_WashingProduksiOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel WashingProduksi_h
    CONSTRAINT [FK_WashingProduksiOperator_WashingProduksi_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[WashingProduksi_h] ([NoProduksi])
);
GO