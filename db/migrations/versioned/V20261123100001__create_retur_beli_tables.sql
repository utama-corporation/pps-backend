-- ================================================================
-- Migration: Retur Beli (retur ke supplier)
-- ================================================================
-- Tahap 1: kategori Bahan Pendukung. KodeKategori disiapkan supaya Barang
-- Dagang (juga berlabel per supplier) bisa menyusul tanpa tabel baru.
--
-- Efek stok TIDAK disimpan di tabel ini: qty label yang diretur dicatat di
-- dbo.BahanPendukungKonsumsi_d (NoProduksi = NoReturBeli), sama dengan
-- konsumsi produksi / sortir reject, supaya stok & laporan tetap satu sumber
-- dan qty bisa dikembalikan persis saat item/dokumen dihapus.
--
-- Idempotent: aman dijalankan ulang (OBJECT_ID guard).
-- ================================================================

IF OBJECT_ID(N'dbo.ReturBeli_h', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReturBeli_h (
        NoReturBeli     varchar(50)   NOT NULL,
        Tanggal         date          NOT NULL,
        IdSupplier      int           NOT NULL,
        Keterangan      nvarchar(500) NULL,
        -- OPEN: item masih bisa diubah; SELESAI: dikunci.
        Status          varchar(20)   NOT NULL
            CONSTRAINT DF_ReturBeli_h_Status DEFAULT ('OPEN'),
        -- Diisi saat diselesaikan: barang diganti supplier (pengganti masuk
        -- lewat Penerimaan) atau dipotong dari tagihan.
        Penyelesaian    varchar(20)   NULL,
        CompletedBy     varchar(100)  NULL,
        CompletedAt     datetime2(0)  NULL,
        CreateBy        varchar(100)  NOT NULL,
        DateTimeCreate  datetime2(0)  NOT NULL
            CONSTRAINT DF_ReturBeli_h_DateTimeCreate DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_ReturBeli_h PRIMARY KEY (NoReturBeli),
        CONSTRAINT FK_ReturBeli_h_MstSupplier
            FOREIGN KEY (IdSupplier) REFERENCES dbo.MstSupplier (IdSupplier),
        CONSTRAINT CK_ReturBeli_h_Status CHECK (Status IN ('OPEN', 'SELESAI')),
        CONSTRAINT CK_ReturBeli_h_Penyelesaian CHECK (
            Penyelesaian IS NULL OR Penyelesaian IN ('DIGANTI', 'POTONG_TAGIHAN')
        ),
        CONSTRAINT CK_ReturBeli_h_Selesai CHECK (
            Status = 'OPEN' OR Penyelesaian IS NOT NULL
        )
    );

    CREATE INDEX IX_ReturBeli_h_Tanggal ON dbo.ReturBeli_h (Tanggal DESC);
    CREATE INDEX IX_ReturBeli_h_IdSupplier ON dbo.ReturBeli_h (IdSupplier);
END
GO

IF OBJECT_ID(N'dbo.ReturBeli_d', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReturBeli_d (
        IdItem          int IDENTITY(1,1) NOT NULL,
        NoReturBeli     varchar(50)   NOT NULL,
        KodeKategori    varchar(20)   NOT NULL
            CONSTRAINT DF_ReturBeli_d_KodeKategori DEFAULT ('bahanpendukung'),
        NoLabel         varchar(50)   NOT NULL,
        Qty             decimal(18,3) NOT NULL,
        Remark          nvarchar(255) NULL,
        CreateBy        varchar(100)  NOT NULL,
        DateTimeCreate  datetime2(0)  NOT NULL
            CONSTRAINT DF_ReturBeli_d_DateTimeCreate DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_ReturBeli_d PRIMARY KEY (IdItem),
        CONSTRAINT FK_ReturBeli_d_ReturBeli_h
            FOREIGN KEY (NoReturBeli) REFERENCES dbo.ReturBeli_h (NoReturBeli),
        CONSTRAINT CK_ReturBeli_d_KodeKategori CHECK (KodeKategori IN ('bahanpendukung')),
        CONSTRAINT CK_ReturBeli_d_Qty CHECK (Qty > 0),
        -- Satu label paling banyak satu baris per dokumen.
        CONSTRAINT UQ_ReturBeli_d_Label UNIQUE (NoReturBeli, NoLabel)
    );

    CREATE INDEX IX_ReturBeli_d_NoLabel ON dbo.ReturBeli_d (NoLabel);
END
GO
