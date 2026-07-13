# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Backend API untuk **Plastic Production System (PPS)** — Node.js + Express + SQL Server (via `mssql`, no ORM). Melacak alur produksi plastik: label bahan (bahan-baku, washing, broker, crusher, gilingan, mixer, bonggolan, furniture-wip, reject, packing) yang jadi input/output tahap produksi (washing, broker, crusher, gilingan, mixer, inject, hot-stamp, key-fitting, spanner, packing, sortir-reject, return), plus bongkar-susun (repack) dan bj-jual (penjualan barang jadi).

## Commands

```bash
npm run dev            # nodemon server.js (development)
npm start              # node server.js
npm test               # jest (semua test)
npx jest path/to/file.test.js          # jalankan satu test file
npx jest -t "nama test case"            # jalankan test by name
npm run it:bongkar-susun                # integration test (butuh DB live, bukan jest)
npm run it:bongkar-susun-delete

# Migrasi (Flyway, dijalankan manual — lihat db/MIGRATIONS.md)
npm run make:migration -- create_nama_tabel      # scaffold file V<timestamp>__...sql
flyway -configFiles="db\flyway.conf" info        # cek status
flyway -configFiles="db\flyway.conf" migrate     # apply
```

Butuh file `.env` (lihat README untuk variabel: `DB_*`, `SECRET_KEY`, `PORT`, `UPDATE*`). Server default port 7500, health check di `GET /health`.

## Struktur & konvensi module

Entry: `server.js` (HTTP + Socket.IO) → `src/app.js` (semua route didaftarkan di sini). Setiap module di `src/modules/<nama>/` mengikuti pola **route → controller → service**:

- **route** (`*-routes.js` / `*-route.js`): definisi endpoint, pasang `verifyToken` per-route (bukan global). Semua di-mount di `src/app.js`.
- **controller**: parsing/normalisasi payload (pakai helper dari `src/core/utils/parse.js`), ambil actor dari token, panggil service, format response `{ success, message, data }`.
- **service**: semua akses DB + business logic. Import `{ sql, poolPromise }` dari `src/core/config/db`.

Menambah module baru = buat folder + 3 file, lalu daftarkan route-nya di `src/app.js`. **Urutan route penting**: rute statis/spesifik harus didaftarkan sebelum rute berparameter (`:noProduksi`, dll) agar tidak tertangkap — lihat komentar `⚠️` di `inject-production-routes.js`.

`label/` = pembuatan/manajemen label stok. `production/` = proses yang mengkonsumsi label sebagai input dan menghasilkan output. `master-*` / `master/` = data master (CRUD). Beberapa module punya versi `-v2` (mis. `bongkar-susun-v2`, `sortir-reject-v2`) — versi lama tetap ada untuk backward-compat.

## Konsep lintas-cutting yang wajib dipahami

Ini pola yang tersebar di banyak file dan tidak terlihat dari satu file saja:

### 1. Transaksi + audit context (SQL Server SESSION_CONTEXT)

Operasi tulis dibungkus `sql.Transaction`. Untuk audit, service membuat `new sql.Request(tx)` lalu memanggil `applyAuditContext(req, { actorId, actorUsername, requestId })` (`src/core/utils/db-audit-context.js`) di awal transaksi — ini men-set `actor_id`/`actor`/`request_id` via `sp_set_session_context`. Trigger DB (di `db/migrations/repeatable/R__tr_Audit_*.sql`) membaca session context untuk menulis audit trail. **Actor selalu berasal dari JWT** (`req.idUsername`, `req.username`), di-extract lewat `src/core/utils/http-context.js`; jangan percaya actor dari body.

### 2. Tutup transaksi (period lock)

`src/core/shared/tutup-transaksi-guard.js` mencegah insert/update/delete pada tanggal yang periodenya sudah ditutup (`MstTutupTransaksiHarian.Lock=1`). Sebelum menulis transaksi bertanggal, panggil `assertNotLocked({ date, runner, action })` — throw error `statusCode 423 / code TUTUP_TRANSAKSI_LOCKED`. Semua perbandingan tanggal dilakukan **UTC date-only** (lihat `toDateOnly`/`formatYMD`); ikuti konvensi ini, jangan pakai timezone lokal. Sumber tanggal dokumen dikonfigurasi di `src/core/config/tutup-transaksi-config.js` dan diambil generik via `loadDocDateOnlyFromConfig`.

### 3. Auth & permission

`verifyToken` (`src/core/middleware/verify-token.js`) memverifikasi JWT dan mengisi `req.idUsername`/`req.username`. Untuk otorisasi granular: `attachPermissions` mengisi `req.userPermissions` (Set), lalu `requirePermission("kode")` memeriksanya (wildcard `"*"` = super admin). Terapkan sebagai middleware per-route.

### 4. Config-driven produksi input mapping

`src/core/config/produksi-input-mapping.config.js` adalah **single source of truth** untuk struktur tabel input produksi, partial (sak pecahan), dan relasinya. SQL untuk attach/upsert/delete input **di-generate** dari config ini oleh `src/core/utils/produksi-*-sql.generator.js` dan dipakai lewat `src/core/shared/produksi-input.service.js`. Untuk menambah jenis input/partial baru, ubah config-nya — jangan tulis SQL manual di service module.

### 5. Kode dokumen & prefix

Nomor dokumen dihasilkan `src/core/utils/sequence-code-helper.js` (`generateNextCode`). Tiap entitas punya prefix (mis. `B.` washing, `Q.` broker partial, `P.` bahan-baku partial; lihat prefix di config). Master mesin & lokasi diselesaikan lewat `src/core/shared/mesin-location-helper.js`.

## Database & migrasi

- SQL Server, koneksi pool tunggal di `src/core/config/db.js` (`poolPromise`). Selalu pakai parameterized query (`req.input(...)`) — nama tabel/kolom yang dinamis harus berasal dari config internal, bukan input user.
- Migrasi dikelola **Flyway**, dijalankan manual (bukan otomatis saat start). `db/migrations/versioned/` = `V<timestamp>__nama.sql` (CREATE/ALTER/INDEX/CONSTRAINT); `db/migrations/repeatable/` = `R__nama.sql` (TRIGGER/VIEW/FUNCTION/PROCEDURE — banyak trigger audit di sini).
- **Jangan edit file `V` yang sudah ada** — buat file `V` baru untuk perubahan. File `R` boleh diedit ulang.

## Testing

Jest (`*.test.js` di `__tests__/`). Unit test memakai DB **yang dimock** — `jest.mock('../../../core/config/db')` menyediakan mock `sql.Request`/`sql.Transaction` dengan `input()` chainable + `query()` (lihat `src/modules/bongkar-susun/__tests__/`). Integration test (`__tests__/integration/*.js`) berjalan sebagai script Node biasa terhadap DB live via `npm run it:*`, bukan lewat jest.

## Deployment

Push ke branch `main` = development. Merge ke branch `production` = trigger auto-deploy via GitHub Actions self-hosted runner (`git pull` + `docker compose up -d --build`). Detail di README.md.
