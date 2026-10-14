-- Tabel partial label Barang Dagang — prefix kode partial BO. (meniru
-- BarangJadiPartial/BL. dan FurnitureWIPPartial/BC.). Parent Qty TIDAK
-- pernah dikurangi: sisa stok = Qty - SUM(Qty di tabel ini).
-- Catatan: tabel bisa sudah ada dengan schema berikut (kolom Qty, PK
-- komposit) — migration no-op kalau sudah ada.

IF OBJECT_ID('dbo.BarangDagangPartial', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[BarangDagangPartial] (
    [NoBarangDagangPartial] VARCHAR(13) NOT NULL,
    [NoBarangDagang]        VARCHAR(50) NOT NULL,
    [Qty]                   DECIMAL(18,2) NOT NULL,
    CONSTRAINT [PK_BarangDagangPartial] PRIMARY KEY CLUSTERED (
      [NoBarangDagangPartial] ASC,
      [NoBarangDagang] ASC
    ),
    CONSTRAINT [FK_BarangDagangPartial_BarangDagang] FOREIGN KEY ([NoBarangDagang])
      REFERENCES [dbo].[BarangDagang] ([NoBarangDagang])
  );
END;
