CREATE TABLE [dbo].[BrokerProduksiOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL,
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_BrokerProduksiOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_BrokerProduksiOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel BrokerProduksi_h
    CONSTRAINT [FK_BrokerProduksiOperator_BrokerProduksi_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[BrokerProduksi_h] ([NoProduksi])
);
GO