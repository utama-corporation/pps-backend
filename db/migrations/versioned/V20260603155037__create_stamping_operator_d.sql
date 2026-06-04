CREATE TABLE [dbo].[HotStampingOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL, -- Menyesuaikan panjang tipe data NoProduksi dari header HotStamping
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_HotStampingOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_HotStampingOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel HotStamping_h
    CONSTRAINT [FK_HotStampingOperator_HotStamping_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[HotStamping_h] ([NoProduksi])
);
GO