-- ================================================================
-- Migration: Bongkar Susun v2 - Barang Jadi input pakai tabel partial
-- ================================================================
-- BongkarSusunInputBarangjadi sebelumnya menyimpan NoPartial + Pcs
-- (ditambahkan di V20261003120000) untuk label input yang sudah pernah
-- dipecah. Dua kolom itu sekarang dipindah ke TABEL LINK, persis seperti
-- kategori furnitureWip (BongkarSusunInputFurnitureWIPPartial):
--
--   BongkarSusunInputBarangjadi       (NoBongkarSusun, NoBJ)
--   + BongkarSusunInputBarangJadiPartial (NoBongkarSusun, NoBJPartial)
--
-- Struktur BongkarSusunInputBarangJadiPartial meniru
-- BongkarSusunInputFurnitureWIPPartial: PK komposit (NoBongkarSusun,
-- NoBJPartial) + FK ke BongkarSusun_h dan BarangJadiPartial.
--
-- Konsekuensinya tabel input kembali menyimpan labelnya saja:
--   - label utuh yang sekali pakai penuh  -> tanpa baris di tabel link,
--     pcs terpakai = BarangJadi.Pcs
--   - label yang sudah pernah dipecah     -> ada baris di tabel link,
--     pcs terpakai = BarangJadiPartial.Pcs milik baris itu
-- Tidak ada "pcs terjual ganda": satu label = satu baris input.
--
-- Baris lama dimigrasikan dulu dari kolom NoPartial yang masih ada, baru
-- kolomnya dibuang (join ke BarangJadiPartial dipakai sebagai filter supaya
-- kode partial yang tidak ada induknya tidak ikut pindah).
--
-- GERBANG: kalau setelah backfill masih ada baris input yang NoPartial-nya
-- belum punya baris link, script berhenti dengan error dan kolom TIDAK
-- dibuang. Pindahkan baris-baris itu manual, lalu jalankan ulang.
--
-- Idempotent: guard OBJECT_ID / COL_LENGTH. Semua pernyataan yang menyebut
-- NoPartial/Pcs dibungkus EXEC() karena SQL Server men-compile seluruh batch
-- SEBELUM jalan - guarded IF biasa tetap gagal dengan "Invalid column name"
-- kalau kolomnya sudah tidak ada.
-- ================================================================

-- Trigger audit lama masih membaca kolom NoPartial/Pcs. Lepas dulu supaya
-- DROP COLUMN di bawah tidak tertahan referensi. Flyway menjalankan
-- repeatable SETELAH versioned, jadi trigger ini dibuat ulang dari
-- R__tr_Audit_BongkarSusunInputBarangjadi.sql di akhir run yang sama.
IF OBJECT_ID('dbo.tr_Audit_BongkarSusunInputBarangjadi', 'TR') IS NOT NULL
    DROP TRIGGER [dbo].[tr_Audit_BongkarSusunInputBarangjadi];
GO

IF OBJECT_ID('dbo.BongkarSusunInputBarangJadiPartial', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BongkarSusunInputBarangJadiPartial] (
        [NoBongkarSusun] VARCHAR(13) NOT NULL,
        [NoBJPartial]     VARCHAR(13) NOT NULL,

        CONSTRAINT [PK_BongkarSusunInputBarangJadiPartial]
            PRIMARY KEY CLUSTERED ([NoBongkarSusun] ASC, [NoBJPartial] ASC),

        CONSTRAINT [FK_BongkarSusunInputBarangJadiPartial_BongkarSusun_h]
            FOREIGN KEY ([NoBongkarSusun])
            REFERENCES [dbo].[BongkarSusun_h] ([NoBongkarSusun]),

        -- FK ke BarangJadiPartial dibuat (kategori furnitureWip juga begitu).
        -- Urutan delete di service yang menjaga integritas: baris di
        -- BarangJadiPartial dihapus duluan, baru baris link ini.
        CONSTRAINT [FK_BongkarSusunInputBarangJadiPartial_BarangJadiPartial]
            FOREIGN KEY ([NoBJPartial])
            REFERENCES [dbo].[BarangJadiPartial] ([NoBJPartial])
    );
END
GO

-- Backfill baris link dari kolom NoPartial yang masih ada di tabel input.
-- Hanya baris yang punya kode partial yang dipindah; label utuh yang sekali
-- pakai penuh tidak punya jejak partial.
IF COL_LENGTH('dbo.BongkarSusunInputBarangjadi', 'NoPartial') IS NOT NULL
BEGIN
    EXEC('
        INSERT INTO dbo.BongkarSusunInputBarangJadiPartial (NoBongkarSusun, NoBJPartial)
        SELECT DISTINCT ibj.NoBongkarSusun, ibj.NoPartial
        FROM dbo.BongkarSusunInputBarangjadi ibj
        INNER JOIN dbo.BongkarSusun_h bsh
            ON bsh.NoBongkarSusun = ibj.NoBongkarSusun
        INNER JOIN dbo.BarangJadiPartial bjp
            ON bjp.NoBJPartial = ibj.NoPartial
        WHERE ibj.NoPartial IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM dbo.BongkarSusunInputBarangJadiPartial t
              WHERE t.NoBongkarSusun = ibj.NoBongkarSusun
                AND t.NoBJPartial = ibj.NoPartial
          );
    ');
END
GO

-- GERBANG: berhenti di sini, jangan drop kolom, kalau masih ada baris input
-- yang NoPartial-nya belum punya baris link. Berarti backfill di atas tidak
-- bisa memindahkannya (mis. NoBongkarSusun tidak ada di header, atau kodenya
-- tidak ada di BarangJadiPartial) dan pcs-nya akan hilang begitu kolomnya
-- dibuang. Selesaikan dulu baris-baris itu, lalu jalankan ulang.
IF COL_LENGTH('dbo.BongkarSusunInputBarangjadi', 'NoPartial') IS NOT NULL
BEGIN
    EXEC('
        IF EXISTS (
            SELECT 1
            FROM dbo.BongkarSusunInputBarangjadi ibj
            LEFT JOIN dbo.BongkarSusunInputBarangJadiPartial l
                ON l.NoBongkarSusun = ibj.NoBongkarSusun
               AND l.NoBJPartial = ibj.NoPartial
            WHERE ibj.NoPartial IS NOT NULL
              AND l.NoBJPartial IS NULL
        )
            THROW 50001, ''Migrasi dibatalkan: masih ada baris input yang NoPartial-nya belum punya baris di BongkarSusunInputBarangJadiPartial. Pindahkan manual, lalu jalankan ulang.'', 1;
    ');
END
GO

-- Pcs tidak pindah ke tabel link: pcs yang dipakai siklus ini sudah tersimpan
-- di BarangJadiPartial.Pcs (kolom itu yang jadi sumbernya), sama seperti
-- FurnitureWIPPartial.Pcs pada kategori furnitureWip.
IF COL_LENGTH('dbo.BongkarSusunInputBarangjadi', 'NoPartial') IS NOT NULL
    EXEC('ALTER TABLE dbo.BongkarSusunInputBarangjadi DROP COLUMN NoPartial;');
GO

IF COL_LENGTH('dbo.BongkarSusunInputBarangjadi', 'Pcs') IS NOT NULL
    EXEC('ALTER TABLE dbo.BongkarSusunInputBarangjadi DROP COLUMN Pcs;');
GO