CREATE TABLE [dbo].[PasangKunciOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL, -- Menyesuaikan panjang tipe data NoProduksi dari header PasangKunci
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_PasangKunciOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_PasangKunciOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel PasangKunci_h
    CONSTRAINT [FK_PasangKunciOperator_PasangKunci_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[PasangKunci_h] ([NoProduksi])
);
GO