# Database Migration Guide

## Buat file migration baru

Jalankan dari root project:

```powershell
npm.cmd run make:migration -- create_nama_tabel
```

Contoh:

```powershell
npm.cmd run make:migration -- create_gilingan_produksi_operator_d
```

Setelah file terbentuk, isi query SQL di folder `db/migrations/versioned`.

## Lihat kondisi migration

```powershell
flyway -configFiles="db\flyway.conf" info
```

## Jalankan migration

```powershell
flyway -configFiles="db\flyway.conf" migrate
```

## Cek ulang setelah migrate

```powershell
flyway -configFiles="db\flyway.conf" info
```

## Catatan singkat

- `V` untuk `CREATE TABLE`, `ALTER TABLE`, `INDEX`, `CONSTRAINT`
- `R` untuk `TRIGGER`, `VIEW`, `FUNCTION`, `PROCEDURE`
- File `V` lama jangan diedit, kalau ada perubahan buat file `V` baru
