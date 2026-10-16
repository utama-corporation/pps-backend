-- ================================================================
-- Migration: Tabel link input Crusher untuk Inject Produksi (F.)
-- ================================================================
-- InjectProduksi(IP) menerima label crusher F. sebagai kategori input baru,
-- sejajar dengan gilingan (V.) yang sudah ada di
-- dbo.InjectProduksiInputGilingan:
--
--   dbo.InjectProduksiInputCrusher (NoProduksi, NoCrusher)
--
-- Tabel ini dipakai oleh:
--   - src/core/config/produksi-input-mapping.config.js
--       INPUT_CONFIGS.injectProduksi.crusher  (sourceTable Crusher,
--       keys [NoCrusher], mappingTable tabel ini, dateUsageColumn DateUsage)
--       -> memberi attach input, set/reset dbo.Crusher.DateUsage, delete
--          input, dan guard update/delete header (getReferencedTables)
--   - src/modules/production/inject/inject-production-service.js
--       fetchInputs()                 -> UNION ALL Src='crusher'
--       updateInjectProduksiTanggal() -> cascade DateUsage label
--       getInjectInputCategoryCodeByPrefix("F.") -> "crusher" (formula match)
--       validateLabel()               -> case "F." baca dbo.Crusher
--   - src/core/config/audit-module-config.js
--       crusher.inputTables + inject_produksi.inputTables
--
-- Tidak ada tabel partial crusher: dbo.CrusherPartial tidak pernah ada,
-- jadi crusher selalu full — sama seperti perlakuan di proses Gilingan
-- (PrefixType.crusher.isFullOnlyInput di sisi tablet).
--
-- Bentuk tabel mengikuti sibling-nya persis:
--   dbo.InjectProduksiInputGilingan  -> (NoProduksi varchar(13) NOT NULL,
--                                        NoGilingan varchar(13) NOT NULL,
--                                        PK (NoGilingan))
--   dbo.GilinganProduksiInputCrusher -> (NoProduksi, NoCrusher, DatetimeInput,
--                                        PK (NoCrusher))
-- PK disusun dari KOLOM LABEL SAJA (bukan digabung NoProduksi): satu label
-- hanya boleh dipakai satu proses produksi. Label crusher yang sudah terpakai
-- juga otomatis tersaring karena dbo.Crusher.DateUsage != NULL (lihat
-- validateLabel case "F."), jadi PK ini tetap konsisten dengan aturan
-- "satu label satu proses".
-- Inject tidak butuh kolom DatetimeInput (berbeda dengan link table modul lain).
--
-- Idempotent: dilindungi guard OBJECT_ID, aman di-re-run.
-- ================================================================

IF OBJECT_ID('dbo.InjectProduksiInputCrusher', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[InjectProduksiInputCrusher] (
        [NoProduksi] VARCHAR(13) NOT NULL,
        [NoCrusher]  VARCHAR(13) NOT NULL,

        CONSTRAINT [PK_InjectProduksiInputCrusher]
            PRIMARY KEY CLUSTERED ([NoCrusher] ASC),

        CONSTRAINT [FK_InjectProduksiInputCrusher_InjectProduksi_h]
            FOREIGN KEY ([NoProduksi])
            REFERENCES [dbo].[InjectProduksi_h] ([NoProduksi]),

        CONSTRAINT [FK_InjectProduksiInputCrusher_Crusher]
            FOREIGN KEY ([NoCrusher])
            REFERENCES [dbo].[Crusher] ([NoCrusher])
    );
END
GO

-- Index tambahan untuk lookup "label ini sudah dipakai di produksi mana saja"
-- (dipakai audit crusher & deteksi label dobel antar proses).
IF OBJECT_ID('dbo.InjectProduksiInputCrusher', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE name = 'IX_InjectProduksiInputCrusher_NoProduksi'
         AND object_id = OBJECT_ID('dbo.InjectProduksiInputCrusher')
   )
BEGIN
    CREATE NONCLUSTERED INDEX [IX_InjectProduksiInputCrusher_NoProduksi]
        ON [dbo].[InjectProduksiInputCrusher] ([NoProduksi] ASC);
END
GO