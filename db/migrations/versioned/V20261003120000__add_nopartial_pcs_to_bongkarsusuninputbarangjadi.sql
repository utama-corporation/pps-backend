-- ================================================================
-- Migration: Tambah NoPartial + Pcs ke dbo.BongkarSusunInputBarangjadi
-- ================================================================
-- Bongkar Susun v2 boleh memakai label barang jadi yang SUDAH pernah
-- dipecah (IsPartial = 1) sebagai input. Sisa pcs-nya dipakai seluruhnya
-- dan dicatat sebagai baris BarangJadiPartial baru (prefix BL.) supaya
-- pcs tersebut punya jejak sendiri — konvensi yang sama dipakai modul
-- penjualan (penjualan/handlers/scan-label.handler.js) dan retur-v3.
--
-- Masalahnya: tanpa kolom pemilik, baris partial yang dibuat bongkar-susun
-- tidak bisa dibedakan dari baris milik penjualan/retur-v3 pada tabel yang
-- sama. Akibatnya hapus bongkar-susun TIDAK bisa mengembalikan pcs yang
-- sudah disisakan: parent di-reset DateUsage = NULL tapi
-- SUM(BarangJadiPartial.Pcs) tetap mengurangi sisa pcs parent selamanya —
-- label fisik yang masih ada di gudang jadi hilang dari stok.
--
-- Dua kolom ini menutup gap itu:
--   NoPartial -> BarangJadiPartial.NoBJPartial yang dibuat transaksi ini,
--                NULL kalau label input tidak pernah dipecah sebelumnya
--                (konsumsi penuh atas label utuh).
--   Pcs       -> pcs yang benar-benar dipakai siklus ini untuk label tsb.
--                Untuk label yang sudah partial ini = seluruh sisa pcs-nya,
--                jadi nilainya bisa saja < BarangJadi.Pcs.
--
-- Kenapa tidak menaruh kepemilikan di BarangJadiPartial?
-- Tabel itu dipakai bersama penjualan & retur-v3. BongkarSusunInputBarang-
-- Jadi milik modul bongkar-susun sendiri, jadi menambah kolom di sini
-- tidak menyentuh tabel bersama dan tidak memaksa modul lain ikut menulis
-- kolom baru.
--
-- Baris lama dibiarkan NULL: label yang sudah pernah masuk bongkar-susun
-- sebelum kolom ini ada tidak bisa direkonstruksi tanpa ambiguitas.
--
-- Idempotent: guard COL_LENGTH.
-- ================================================================

IF COL_LENGTH('dbo.BongkarSusunInputBarangjadi', 'NoPartial') IS NULL
    ALTER TABLE dbo.BongkarSusunInputBarangjadi ADD NoPartial VARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.BongkarSusunInputBarangjadi', 'Pcs') IS NULL
    ALTER TABLE dbo.BongkarSusunInputBarangjadi ADD Pcs INT NULL;
GO