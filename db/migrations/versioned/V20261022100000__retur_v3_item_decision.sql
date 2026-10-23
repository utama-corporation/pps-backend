-- ================================================================
-- Migration: Keputusan per item pada BJReturV3Item_d
-- Decision: DIGANTI / TIDAK_DIGANTI (NULL = belum diputuskan).
-- Header StatusRetur tetap 3 nilai; diturunkan dari keputusan item.
-- ================================================================
IF COL_LENGTH('dbo.BJReturV3Item_d', 'Decision') IS NULL
BEGIN
    ALTER TABLE [dbo].[BJReturV3Item_d] ADD [Decision] varchar(20) NULL;
END
GO

IF COL_LENGTH('dbo.BJReturV3Item_d', 'DecisionAt') IS NULL
BEGIN
    ALTER TABLE [dbo].[BJReturV3Item_d] ADD [DecisionAt] datetime2(3) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_BJReturV3Item_d_Decision'
      AND parent_object_id = OBJECT_ID('dbo.BJReturV3Item_d')
)
BEGIN
    ALTER TABLE [dbo].[BJReturV3Item_d] WITH CHECK
        ADD CONSTRAINT [CK_BJReturV3Item_d_Decision]
        CHECK ([Decision] IS NULL OR [Decision] IN ('DIGANTI', 'TIDAK_DIGANTI'));
END
GO

-- Backfill: retur yang sudah diputuskan di model lama (satu keputusan per header)
-- diwariskan ke semua itemnya.
UPDATE it
SET it.Decision = h.StatusRetur,
    it.DecisionAt = h.DecisionAt
FROM [dbo].[BJReturV3Item_d] it
INNER JOIN [dbo].[BJReturV3_h] h ON h.NoRetur = it.NoRetur
WHERE it.Decision IS NULL
  AND h.StatusRetur IN ('DIGANTI', 'TIDAK_DIGANTI');
GO
