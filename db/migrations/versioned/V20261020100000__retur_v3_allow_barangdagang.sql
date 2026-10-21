-- ================================================================
-- Migration: Izinkan KodeKategori 'barangdagang' pada BJReturV3Item_d
-- ================================================================
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_BJReturV3Item_d_KodeKategori'
      AND parent_object_id = OBJECT_ID('dbo.BJReturV3Item_d')
)
BEGIN
    ALTER TABLE [dbo].[BJReturV3Item_d] DROP CONSTRAINT [CK_BJReturV3Item_d_KodeKategori];
END
GO

ALTER TABLE [dbo].[BJReturV3Item_d] WITH CHECK
    ADD CONSTRAINT [CK_BJReturV3Item_d_KodeKategori]
    CHECK ([KodeKategori] IN ('barangjadi', 'furniturewip', 'barangdagang'));
GO
