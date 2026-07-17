# Stock Opname V2

Dokumentasi endpoint `stock-opname-v2`. Semua route memerlukan header
`Authorization: Bearer <token>` (middleware `verifyToken`).

> **Perubahan path (revisi terbaru):** segment `no-stock-opname` diganti
> menjadi `transaksi` di seluruh endpoint transaksi stock opname. FE wajib
> mengganti semua base URL lama `/api/stock-opname-v2/no-stock-opname...`
> menjadi `/api/stock-opname-v2/transaksi...`. Path param (`:stockOpnameNo`,
> `:categoryId`, dst) dan seluruh format request/response **tidak berubah**.

> **Kategori `furniturewip` dihitung per pcs, bukan berat.** Di **semua**
> endpoint transaksi yang menampilkan angka satuan (jenis, blok, lokasi,
> label, hasil scan), field `Berat`/`totalWeight`/`weight` **tidak muncul**
> untuk kategori ini — digantikan `totalPcs` (atau `pieceCount` untuk
> endpoint hasil scan yang memang sudah ada). Kategori lain tidak berubah.

## Daftar Endpoint

| Method | Path                                                                                | Keterangan                                    |
| ------ | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| GET    | `/api/stock-opname-v2/kategori`                                                     | List kategori + status stock opname           |
| GET    | `/api/stock-opname-v2/kategori/:categoryId/jenis`                                   | List jenis dalam satu kategori                |
| GET    | `/api/stock-opname-v2/kategori/:categoryId/riwayat`                                 | Riwayat stock opname per kategori             |
| GET    | `/api/stock-opname-v2/transaksi/preview`                                            | Preview jumlah label sebelum generate         |
| POST   | `/api/stock-opname-v2/transaksi`                                                    | Generate stock opname baru (snapshot label)   |
| PATCH  | `/api/stock-opname-v2/transaksi/:stockOpnameNo/complete`                            | Tandai stock opname selesai                   |
| DELETE | `/api/stock-opname-v2/transaksi/:stockOpnameNo`                                     | Hapus stock opname                            |
| GET    | `/api/stock-opname-v2/transaksi/:stockOpnameNo/jenis`                               | List jenis label ter-snapshot dalam satu SO   |
| GET    | `/api/stock-opname-v2/transaksi/:stockOpnameNo/jenis/:typeId/label`                 | List label snapshot per jenis                 |
| POST   | `/api/stock-opname-v2/transaksi/:stockOpnameNo/hasil`                               | Input hasil scan (catat label sudah diopname) |
| GET    | `/api/stock-opname-v2/transaksi/:stockOpnameNo/blok`                                | List blok yang ada pada satu SO               |
| GET    | `/api/stock-opname-v2/transaksi/:stockOpnameNo/blok/:blok/lokasi`                   | List lokasi dalam satu blok                   |
| GET    | `/api/stock-opname-v2/transaksi/:stockOpnameNo/blok/:blok/lokasi/:locationId/label` | List label snapshot per lokasi                |

**~~Path lama (deprecated)~~**: `no-stock-opname` — sudah dihapus, ganti dengan `transaksi`.

---

## GET `/kategori`

Query: `year` (opsional), `month` (opsional) — filter status generate per periode.

Response `200`:

```json
{
  "success": true,
  "message": "Data kategori berhasil diambil",
  "data": [
    /* kategori + status */
  ],
  "totalRecords": 0
}
```

`404` jika data kosong.

## GET `/kategori/:categoryId/jenis`

`categoryId` — integer, wajib > 0 (400 jika tidak valid).

Response `200`:

```json
{
  "success": true,
  "message": "Data jenis <namaKategori> berhasil diambil",
  "category": { "...": "..." },
  "data": [
    /* jenis */
  ],
  "totalRecords": 0
}
```

## GET `/kategori/:categoryId/riwayat`

Query: `year`, `month`, `page`, `pageSize` (semua opsional, untuk pagination riwayat).

Response `200`:

```json
{
  "success": true,
  "message": "Riwayat stock opname <categoryName> berhasil diambil",
  "data": {
    "categoryName": "...",
    "data": [
      /* riwayat */
    ]
  }
}
```

## GET `/transaksi/preview`

Query: `categoryId` (wajib).

Response `200`:

```json
{
  "success": true,
  "message": "Terdapat <labelCount> label <categoryName> per tanggal <date> yang akan digenerate",
  "data": { "labelCount": 0, "categoryName": "...", "date": "..." }
}
```

## POST `/transaksi`

Body:

```json
{ "categoryId": 1 }
```

Actor diambil dari JWT (bukan dari body). Response `201`:

```json
{
  "success": true,
  "message": "Stock opname <stockOpnameNo> berhasil dibuat",
  "data": { "stockOpnameNo": "..." }
}
```

`401` jika token tidak valid/`idUsername` tidak ada.

## PATCH `/transaksi/:stockOpnameNo/complete`

Tidak ada body. Response `200`:

```json
{
  "success": true,
  "message": "Stock opname <stockOpnameNo> berhasil ditandai selesai",
  "data": { "stockOpnameNo": "..." }
}
```

## DELETE `/transaksi/:stockOpnameNo`

Response `200`:

```json
{
  "success": true,
  "message": "Stock opname <stockOpnameNo> berhasil dihapus",
  "data": { "stockOpnameNo": "..." }
}
```

## GET `/transaksi/:stockOpnameNo/jenis`

Response `200` (`404` jika belum ada label ter-snapshot):

```json
{
  "success": true,
  "message": "Data jenis <stockOpnameNo> berhasil diambil",
  "data": {
    "stockOpnameNo": "...",
    "data": [
      /* jenis */
    ]
  }
}
```

## GET `/transaksi/:stockOpnameNo/jenis/:typeId/label`

Sama handler dengan endpoint lokasi di bawah (`getSnapshotHandler`).

Query: `page`, `pageSize`, `search` (opsional).

Label di-**group per jenis** (`typeId`/`typeName` di-join dari master jenis
kategori terkait, mis. `MstBonggolan` untuk kategori bonggolan, lewat
`getJenisByKategori`). Untuk endpoint ini `typeId` biasanya sudah difilter
oleh path param, jadi hasilnya cuma 1 group — grouping lebih berguna di
endpoint lokasi di bawah yang tidak difilter per jenis.

> **Catatan pagination:** `page`/`pageSize` tetap bekerja di level label
> (bukan level group) — kalau ada banyak jenis, group bisa terpotong antar
> halaman.

Response `200` (`404` jika kosong):

```json
{
  "success": true,
  "message": "Data snapshot <stockOpnameNo> berhasil diambil",
  "data": {
    "stockOpnameNo": "...",
    "data": [
      {
        "typeId": 18,
        "typeName": "PP BONGGOL BIRU KURSI",
        "labelCount": 1,
        "totalWeight": 2.41,
        "labels": [
          {
            "NoSO": "SO.0000000002",
            "NoBonggolan": "M.0000012890",
            "Berat": 2.41,
            "Blok": "K",
            "IdLokasi": 7,
            "IdBonggolan": 18,
            "isScanned": 0,
            "ScannedBlok": null,
            "ScannedIdLokasi": null,
            "isLocationMismatch": false
          }
        ]
      }
    ],
    "currentPage": 1,
    "pageSize": 20,
    "totalRecords": 0,
    "totalPages": 0,
    "totalWeight": 0,
    "totalScanned": 0
  }
}
```

## POST `/transaksi/:stockOpnameNo/hasil`

Body:

```json
{
  "labelNo": "B.0000013157",
  "palletNo": "1",
  "blok": "A",
  "locationId": 12
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Label <labelNo> berhasil dicatat",
  "data": {
    "labelNo": "...",
    "sackCount": 0,
    "pieceCount": 0,
    "weight": 0
  }
}
```

`weight` tidak muncul (`undefined`, di-drop dari JSON) kalau kategorinya `furniturewip` — pakai `pieceCount` saja untuk kategori ini.

## GET `/transaksi/:stockOpnameNo/blok`

`stockOpnameNo` wajib (path param — 400 dari service jika kosong/invalid).

Setiap item sudah menyertakan `locationCount` (jumlah lokasi berbeda dalam
blok tersebut) supaya FE tidak perlu hit endpoint `blok/:blok/lokasi` hanya
untuk mengetahui jumlah lokasinya.

Daftar blok dan `locationCount` dihitung langsung dari tabel snapshot/acuan
stock opname. Data historis tidak difilter berdasarkan `MstLokasi.Enable`
atau mapping `MstLokasiJenis`.

Response `200` (`404` jika kosong):

```json
{
  "success": true,
  "message": "Data blok berhasil diambil",
  "data": [
    {
      "blok": "A",
      "locationCount": 5,
      "labelCount": 42,
      "scannedCount": 10,
      "totalWeight": 1234.5
    },
    {
      "blok": "TIDAK_DIKETAHUI",
      "locationCount": 1,
      "labelCount": 3,
      "scannedCount": 0,
      "totalWeight": 50
    }
  ],
  "totalRecords": 0
}
```

## GET `/transaksi/:stockOpnameNo/blok/:blok/lokasi`

Lokasi dikelompokkan berdasarkan `Blok` dan `IdLokasi` yang tersimpan di tabel
snapshot. `MstLokasi` hanya di-`LEFT JOIN` untuk mengambil deskripsi, sehingga
lokasi snapshot tetap ditampilkan walaupun master atau mapping kategori berubah.

Response `200` (`404` jika belum ada lokasi):

```json
{
  "success": true,
  "message": "Data lokasi blok <blok> berhasil diambil",
  "data": { "...": "..." }
}
```

## GET `/transaksi/:stockOpnameNo/blok/:blok/lokasi/:locationId/label`

Sama handler `getSnapshotHandler` seperti di atas (jenis/typeId/label), dengan
tambahan filter `locationId` dari path param. Endpoint ini tidak difilter per
jenis, jadi ini tempat yang paling berguna untuk lihat hasil grouping —
lihat contoh response `data` (array group per jenis) di bagian
`jenis/:typeId/label` di atas.

Query: `page`, `pageSize`, `search` (opsional).

---

## Format error umum

Semua handler pakai format error yang sama:

```json
{
  "success": false,
  "message": "...",
  "code": "..." // opsional, mis. TUTUP_TRANSAKSI_LOCKED
}
```

Status code mengikuti `error.statusCode` dari service (400 = validasi, 401 =
unauthorized, 404 = not found, 423 = periode tutup transaksi terkunci, 500 =
internal error).
