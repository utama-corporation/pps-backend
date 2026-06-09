CREATE TABLE [dbo].[SpannerOperator_d] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [NoProduksi] VARCHAR(13) NOT NULL, -- Menyesuaikan panjang tipe data NoProduksi dari header Spanner
    [IdOperator] INT NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [DF_SpannerOperator_CreatedAt] DEFAULT (GETDATE()),
    
    -- Primary Key
    CONSTRAINT [PK_SpannerOperator_d] PRIMARY KEY CLUSTERED ([Id] ASC),
    
    -- Foreign Key ke tabel Spanner_h
    CONSTRAINT [FK_SpannerOperator_Spanner_h] 
        FOREIGN KEY ([NoProduksi]) REFERENCES [dbo].[Spanner_h] ([NoProduksi])
);
GO