-- ================================================================
-- Migration: Kolom Remark per item pada BJReturV3Item_d
-- Dipakai sebagai AR_SalesReturnTransitDetails.Remarks saat export ke
-- AS_GSU (kosong -> fallback ke KategoriInput).
-- ================================================================
IF COL_LENGTH('dbo.BJReturV3Item_d', 'Remark') IS NULL
BEGIN
    ALTER TABLE [dbo].[BJReturV3Item_d] ADD [Remark] nvarchar(255) NULL;
END
GO
