-- Penjualan kini menerima label Barang Dagang (BD.) — KodeKategori
-- 'barangdagang' ikut dicatat di BJJualScanLabel_d saat scan.
-- CHECK constraint lama hanya mengizinkan 'barangjadi' / 'furniturewip',
-- jadi di-drop dan dibuat ulang dengan 'barangdagang' ditambahkan.

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_BJJualScanLabel_d_KodeKategori'
    AND parent_object_id = OBJECT_ID('dbo.BJJualScanLabel_d')
)
  ALTER TABLE [dbo].[BJJualScanLabel_d]
  DROP CONSTRAINT [CK_BJJualScanLabel_d_KodeKategori];

ALTER TABLE [dbo].[BJJualScanLabel_d] WITH CHECK
  ADD CONSTRAINT [CK_BJJualScanLabel_d_KodeKategori]
  CHECK (
    [KodeKategori] = 'barangjadi'
    OR [KodeKategori] = 'furniturewip'
    OR [KodeKategori] = 'barangdagang'
  );
