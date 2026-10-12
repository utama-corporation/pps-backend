-- ================================================================
-- Migration: BJSortirRejectInputLabelBahanPendukung untuk Sortir Reject
-- ================================================================
-- Sortir Reject v2 menerima 4 kategori input: barangJadi (BA.),
-- furnitureWip (BB.), reject, dan bahanPendukung (BP.). Dua kategori
-- pertama punya tabel link input masing-masing dan sudah ada di semua
-- DB. Kategori bahanPendukung membutuhkan:
--
--   dbo.BJSortirRejectInputLabelBahanPendukung (NoBJSortir, NoBahanPendukung)
--
-- Tabel ini dipakai sortir-reject-v2-service.js di 4 tempat, semuanya
-- dengan nama Fully Qualified "dbo.":
--
--   - exports.getAll     -> EXISTS di whereClause (dipakai list + dashboard)
--   - exports.getDetail  -> EXISTS di whereClause header + SELECT inputs
--   - handlers/create-reject.handler.js -> INSERT saat firstCategory
--                                          = "bahanPendukung" (prefix BP.)
--
-- Kalau tabel tidak ada, keempat query itu 500 dengan pesan
-- "Invalid object name 'dbo.BJSortirRejectInputLabelBahanPendukung'."
-- dan seluruh modul Sortir Reject v2 mati - bukan cuma kategori BP.
--
-- Tabel ini dibuat manual di DB development (PPS_TEST6) tanpa migration,
-- jadi tidak pernah ikut ter-deploy ke DB production (PPS). File
-- R__tr_Audit_BJSortirRejectInputLabelBahanPendukung.sql sudah ada
-- (repeatable) tapi Flyway menjalankan repeatable SETELAH versioned, jadi
-- trigger-nya juga gagal apply karena tabelnya belum ada.
--
-- Struktur meniru dbo.BJSortirRejectInputLabelBarangJadi (kategori lain
-- yang PK-nya hanya kolom label):
--
--   NoBJSortir       VARCHAR(13) NULL
--   NoBahanPendukung VARCHAR(50) NOT NULL
--   PK clustered  -> NoBahanPendukung (satu label BP hanya bisa dipakai
--                   satu kali; pemakaian ditandai lewat
--                   BahanPendukung.DateUsage)
--   FK NoBahanPendukung -> BahanPendukung(NoBahanPendukung)
--   FK NoBJSortir       -> BJSortirReject_h(NoBJSortir)
--
-- PK sengaja hanya NoBahanPendukung, sama seperti
-- BJSortirRejectInputLabelBarangJadi (PK hanya NoBJ). Kalau dipakai
-- komposit (NoBJSortir, NoBahanPendukung) satu label bisa masuk ke dua
-- sortir berbeda karena pemakaiannya tidak lagi dijaga PK.
--
-- Urutan delete di service.deleteSortirReject sudah aman: baris input
-- dihapus (dan BahanPendukung.DateUsage di-NULL-kan) sebelum header
-- dbo.BJSortirReject_h dihapus, jadi FK tidak menahan.
--
-- Idempotent: guard OBJECT_ID. Aman dijalankan ulang.
-- ================================================================

IF OBJECT_ID('dbo.BJSortirRejectInputLabelBahanPendukung', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BJSortirRejectInputLabelBahanPendukung] (
        [NoBJSortir]       VARCHAR(13) NULL,
        [NoBahanPendukung] VARCHAR(50) NOT NULL,

        CONSTRAINT [PK_BJSortirRejectInputLabelBahanPendukung]
            PRIMARY KEY CLUSTERED ([NoBahanPendukung] ASC),

        CONSTRAINT [FK_BJSortirRejectInputLabelBahanPendukung_BahanPendukung]
            FOREIGN KEY ([NoBahanPendukung])
            REFERENCES [dbo].[BahanPendukung] ([NoBahanPendukung]),

        CONSTRAINT [FK_BJSortirRejectInputLabelBahanPendukung_BJSortirReject_h]
            FOREIGN KEY ([NoBJSortir])
            REFERENCES [dbo].[BJSortirReject_h] ([NoBJSortir])
    );
END
GO