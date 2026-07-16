# Mapping

Dokumentasi endpoint mapping blok, lokasi, dan layout warehouse.

## Base URL

```
/api/mapping
```

## Endpoints

| Method | Path                      | Auth          | Keterangan                     |
| ------ | ------------------------- | ------------- | ------------------------------ |
| GET    | `/blok`                   | `verifyToken` | Mapping blok ↔ warehouse       |
| GET    | `/lokasi?blok=:blok`      | `verifyToken` | Daftar lokasi + jenis per blok |
| POST   | `/lokasi/:blok`           | `verifyToken` | Buat lokasi baru               |
| PUT    | `/lokasi/:blok/:idLokasi` | `verifyToken` | Update lokasi                  |
| GET    | `/layout/:blok`           | `verifyToken` | Layout grid blok               |
| POST   | `/layout/:blok`           | `verifyToken` | Simpan layout grid blok        |

---

## POST `/api/mapping/lokasi/:blok`

Buat lokasi baru beserta daftar jenis per kategori.

### Path Parameter

| Parameter | Tipe   | Keterangan |
| --------- | ------ | ---------- |
| `blok`    | string | Kode blok  |

### Request Body

```json
{
  "IdLokasi": 1,
  "JenisList": [
    { "IdKategori": 1, "IdJenis": 5 },
    { "IdKategori": 2, "IdJenis": 3 }
  ],
  "Description": "Rak A1",
  "Enable": true
}
```

| Field                    | Tipe    | Required | Keterangan                                      |
| ------------------------ | ------- | -------- | ----------------------------------------------- |
| `IdLokasi`               | integer | ✅       | Nomor urut lokasi di dalam blok, > 0            |
| `JenisList`              | array   | ✅       | Daftar pasangan kategori-jenis (minimal 1)      |
| `JenisList[].IdKategori` | integer | ✅\*     | ID kategori, > 0 (\*wajib ada di tiap entry)    |
| `JenisList[].IdJenis`    | integer | ✅\*     | ID jenis (FK ke tabel sesuai kategori), > 0     |
| `Description`            | string  | ❌       | Deskripsi lokasi                                |
| `Enable`                 | boolean | ❌       | Status aktif, default `true`                    |

### Response `201 Created`

```json
{
  "success": true,
  "message": "Data lokasi berhasil ditambahkan"
}
```

### Error Response `400`

```json
{
  "success": false,
  "message": "Field 'IdLokasi' wajib berupa integer valid"
}
```

### Contoh Flow — Lokasi dengan 2 kategori berbeda

```json
POST /api/mapping/lokasi/A
{
  "IdLokasi": 10,
  "JenisList": [
    { "IdKategori": 1, "IdJenis": 5 },
    { "IdKategori": 3, "IdJenis": 12 }
  ],
  "Description": "Rak campuran",
  "Enable": true
}
```

Proses:

1. Insert row ke `MstLokasi` → `(Blok='A', IdLokasi=10, Description='Rak campuran', Enable=1)`
2. Insert 2 row ke `MstLokasiJenis`:
   - `(Blok='A', IdLokasi=10, IdKategori=1, IdJenis=5)`
   - `(Blok='A', IdLokasi=10, IdKategori=3, IdJenis=12)`
3. Commit transaction (rollback otomatis jika salah satu gagal).

---

## GET `/api/mapping/lokasi?blok=:blok`

Daftar semua lokasi aktif berikut jenis-jenisnya di suatu blok.

### Query Parameter

| Parameter | Tipe   | Required | Keterangan |
| --------- | ------ | -------- | ---------- |
| `blok`    | string | ✅       | Kode blok  |

### Response `200`

```json
{
  "success": true,
  "message": "Data lokasi berdasarkan blok berhasil diambil",
  "data": [
    {
      "IdLokasi": 1,
      "Blok": "A",
      "Description": "Rak A1",
      "Enable": true,
      "JenisList": [
        {
          "IdKategori": 1,
          "IdJenis": 5,
          "KodeKategori": "BB",
          "NamaKategori": "Bahan Baku",
          "NamaJenis": "PP",
          "IdUOM": 1,
          "NamaUOM": "kg"
        },
        {
          "IdKategori": 2,
          "IdJenis": 3,
          "KodeKategori": "WAS",
          "NamaKategori": "Washing",
          "NamaJenis": "HD",
          "IdUOM": 2,
          "NamaUOM": "pcs"
        }
      ],
      "TotalLabel": 0,
      "TotalQty": 0,
      "TotalBerat": 0
    }
  ],
  "totalData": 1
}
```

| Field                      | Tipe    | Keterangan                                      |
| -------------------------- | ------- | ----------------------------------------------- |
| `IdLokasi`                 | integer | Nomor lokasi                                    |
| `Blok`                     | string  | Kode blok                                       |
| `Description`              | string  | Deskripsi lokasi                                |
| `Enable`                   | boolean | Status aktif                                    |
| `JenisList`                | array   | Daftar jenis per kategori di lokasi ini         |
| `JenisList[].IdKategori`   | integer | ID kategori                                     |
| `JenisList[].IdJenis`      | integer | ID jenis                                        |
| `JenisList[].KodeKategori` | string  | Kode kategori (misal `BB`, `WAS`)               |
| `JenisList[].NamaKategori` | string  | Nama kategori                                   |
| `JenisList[].NamaJenis`    | string  | Nama jenis (resolve dinamis dari tabel terkait) |
| `JenisList[].IdUOM`        | integer | ID satuan                                       |
| `JenisList[].NamaUOM`      | string  | Nama satuan (`kg` / `pcs`)                      |
| `TotalLabel`               | integer | Total label aktif di lokasi                     |
| `TotalQty`                 | number  | Total kuantitas (0 jika UOM kg)                 |
| `TotalBerat`               | number  | Total berat (0 jika UOM pcs)                    |

---

## PUT `/api/mapping/lokasi/:blok/:idLokasi`

Update data lokasi dan replace seluruh jenis.

### Path Parameter

| Parameter  | Tipe   | Keterangan |
| ---------- | ------ | ---------- |
| `blok`     | string | Kode blok  |
| `idLokasi` | int    | ID lokasi  |

### Request Body

```json
{
  "JenisList": [{ "IdKategori": 1, "IdJenis": 8 }],
  "Description": "Rak A1 Updated",
  "Enable": false
}
```

### Response `200`

```json
{
  "success": true,
  "message": "Data lokasi berhasil diperbarui"
}
```

### Error `404`

```json
{
  "success": false,
  "message": "Data lokasi tidak ditemukan"
}
```

Proses update:

1. Update `MstLokasi` set `Description`, `Enable` where `Blok` + `IdLokasi`
2. `DELETE` semua row `MstLokasiJenis` untuk lokasi tersebut
3. `INSERT` ulang berdasarkan `JenisList`
4. Commit transaction

---

## GET `/api/mapping/blok`

Mapping blok ↔ warehouse beserta total lokasi dan jenis.

### Response `200`

```json
{
  "success": true,
  "message": "Data mapping blok-warehouse berhasil diambil",
  "data": [
    {
      "Blok": "A",
      "IdWarehouse": 1,
      "NamaWarehouse": "Gudang Utama",
      "TotalLokasi": 10,
      "TotalJenis": 5
    }
  ],
  "totalData": 1
}
```

| Field           | Tipe    | Keterangan                             |
| --------------- | ------- | -------------------------------------- |
| `Blok`          | string  | Kode blok                              |
| `IdWarehouse`   | integer | ID warehouse                           |
| `NamaWarehouse` | string  | Nama warehouse                         |
| `TotalLokasi`   | integer | Jumlah lokasi aktif                    |
| `TotalJenis`    | integer | Jumlah row di `MstLokasiJenis` (aktif) |

---

## Catatan Implementasi

- Semua operasi tulis (`POST`, `PUT`) menggunakan **SQL Transaction** — rollback jika salah satu langkah gagal.
- `IdKategori` tidak lagi disimpan di `MstLokasi`. Semua data kategori+jenis ada di `MstLokasiJenis`.
- Nama jenis di-resolve secara dinamis dari tabel yang ditentukan oleh `MstKategori.NamaTableJenis`, `MstKategori.NamaKolomIdJenis`, dan `MstKategori.NamaKolomNamaJenis`.
