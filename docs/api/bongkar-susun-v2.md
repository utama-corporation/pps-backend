# Bongkar Susun V2

Dokumentasi ringkas untuk endpoint `bongkar-susun-v2`.

## Base Endpoint

- `GET /api/bongkar-susun-v2`
- `GET /api/bongkar-susun-v2/:noBongkarSusun`
- `GET /api/bongkar-susun-v2/label/:labelCode`
- `POST /api/bongkar-susun-v2`
- `DELETE /api/bongkar-susun-v2/:noBongkarSusun`

## Prefix Label

| Prefix | Kategori       |
| ------ | -------------- |
| `A.`   | `bahanBaku`    |
| `B.`   | `washing`      |
| `D.`   | `broker`       |
| `F.`   | `crusher`      |
| `V.`   | `gilingan`     |
| `H.`   | `mixer`        |
| `BB.`  | `furnitureWip` |
| `BA.`  | `barangJadi`   |
| `M.`   | `bonggolan`    |
| `BF.`  | `reject`       |

## POST ` /api/bongkar-susun-v2`

Format umum:

```json
{
  "note": "opsional",
  "inputs": ["..."],
  "outputs": [{ "...": "..." }]
}
```

Kategori **barangJadi, furnitureWip, mixer, dan reject** mendukung field
opsional `inputsPartial` untuk memilih **sebagian** qty dari sisa label (pcs
untuk barangJadi/furnitureWip, kg untuk mixer dan reject):

```json
{
  "note": "opsional",
  "inputs": ["BA.0000040338"],
  "inputsPartial": [{ "labelCode": "BA.0000040338", "qty": 10 }],
  "outputs": [{ "...": "..." }]
}
```

| Field                   | Format                           | Keterangan                                            |
| ----------------------- | -------------------------------- | ----------------------------------------------------- |
| `inputs`                | array kode label                 | **Semua** label input — termasuk yang di-override     |
| `inputsPartial`         | `[{ labelCode, qty }]`, opsional | Override qty terpakai per label (≤ sisa label)        |
| `inputsPartial[].qty`    | number > 0                       | qty terpakai (pcs / kg); sisanya (`sisa - qty`) hidup |

Label yang `qty`-nya kurang dari sisa **tidak** ditandai `DateUsage` —
sisanya masih bisa dipakai transaksi berikutnya. Label tanpa override
tetap memakai seluruh sisa seperti biasa.

> `inputsPartial` ditolak dengan `400` untuk kategori selain barangJadi,
> furnitureWip, dan mixer.

### 1) Bahan Baku

| Field                    | Format               | Keterangan                                            |
| ------------------------ | -------------------- | ----------------------------------------------------- |
| `inputs`                 | `["A.0000002509-1"]` | Label bahan baku, format `A.<NoBahanBaku>-<NoPallet>` |
| `outputs[].idJenis`      | number               | Harus sama dengan `IdJenisPlastik` input              |
| `outputs[].saks`         | array                | Daftar sak output                                     |
| `outputs[].saks[].noSak` | number               | Nomor sak                                             |
| `outputs[].saks[].berat` | number               | Berat per sak                                         |
| Balance             | berat              | Berdasarkan total berat       |

### 10) Reject (`BF.`)

Label reject disimpan di `dbo.RejectV2` dan tidak ber-sak: satu output = satu
nomor `BF.` dengan satu berat. `idJenis` pada output adalah `RejectV2.IdReject`
(nama jenis dari `MstReject.NamaReject`).

| Field               | Format                  | Keterangan                          |
| ------------------- | ----------------------- | ----------------------------------- |
| `inputs`            | `["BF.0000001234"]`     | Label reject                         |
| `outputs[].idJenis` | number                  | `MstReject.IdReject`                 |
| `outputs[].berat`   | number                  | Berat output                         |
| `inputsPartial`     | `[{ labelCode, qty }]`  | Opsional, qty = kg yang dipakai       |
| Balance             | berat                   | Berdasarkan berat terpakai per jenis |

Partial reject pada bongkar susun:

- Label yang **sudah pernah di-partial** (punya baris di
  `dbo.RejectV2Partial`, mis. dipakai sebagian di produksi broker/gilingan)
  tetap boleh dipakai. Berat yang boleh dipakai = sisa berat label
  (`Berat - SUM(RejectV2Partial.Berat)`).
- Kalau operator memakai **sebagian** sisa berat lewat `inputsPartial`,
  backend membuat baris baru di `dbo.RejectV2Partial` (prefix `BK.`) berisi
  berat yang dipakai dan menautkannya lewat
  `dbo.BongkarSusunInputRejectPartial`. Sisa berat label tetap hidup untuk
  diproses berikutnya.
- Label dianggap habis (di-`DateUsage`) hanya kalau sisa beratnya sudah `<= 0`
  setelah semua partial terhitung, termasuk partial milik transaksi ini.
- `DELETE` transaksi mengembalikan `DateUsage` input ke `NULL`, menghapus
  `RejectV2Partial` milik transaksi ini saja (partial modul lain tetap utuh),
  lalu menghitung ulang `RejectV2.IsPartial`.

Contoh:

```json
{
  "note": "opsional",
  "inputs": ["A.0000002509-1"],
  "outputs": [
    {
      "idJenis": 137,
      "saks": [
        { "noSak": 1, "berat": 1000 },
        { "noSak": 2, "berat": 1000 }
      ]
    }
  ]
}
```

### 2) Washing

| Field                    | Format             | Keterangan                    |
| ------------------------ | ------------------ | ----------------------------- |
| `inputs`                 | `["B.0000013157"]` | Label washing                 |
| `outputs[].idJenis`      | number             | Harus sama dengan jenis input |
| `outputs[].saks`         | array              | Daftar sak output             |
| `outputs[].saks[].noSak` | number             | Nomor sak                     |
| `outputs[].saks[].berat` | number             | Berat per sak                 |
| Balance                  | berat              | Berdasarkan total berat       |

### 3) Broker

| Field                    | Format             | Keterangan                    |
| ------------------------ | ------------------ | ----------------------------- |
| `inputs`                 | `["D.0000001234"]` | Label broker                  |
| `outputs[].idJenis`      | number             | Harus sama dengan jenis input |
| `outputs[].saks`         | array              | Daftar sak output             |
| `outputs[].saks[].noSak` | number             | Nomor sak                     |
| `outputs[].saks[].berat` | number             | Berat per sak                 |
| Balance                  | berat              | Berdasarkan total berat       |

### 4) Crusher

| Field               | Format             | Keterangan                    |
| ------------------- | ------------------ | ----------------------------- |
| `inputs`            | `["F.0000005811"]` | Label crusher                 |
| `outputs[].idJenis` | number             | Harus sama dengan jenis input |
| `outputs[].berat`   | number             | Berat output                  |
| Balance             | berat              | Berdasarkan total berat       |

### 5) Gilingan

| Field               | Format             | Keterangan                    |
| ------------------- | ------------------ | ----------------------------- |
| `inputs`            | `["V.0000001234"]` | Label gilingan                |
| `outputs[].idJenis` | number             | Harus sama dengan jenis input |
| `outputs[].berat`   | number             | Berat output                  |
| Balance             | berat              | Berdasarkan total berat       |

### 6) Mixer

| Field                    | Format                              | Keterangan                                            |
| ------------------------ | ----------------------------------- | ----------------------------------------------------- |
| `inputs`                 | `["H.0000025312"]`                  | Label mixer                                           |
| `inputsPartial`          | `[{ labelCode, qty }]`, opsional    | Override berat terpakai per label (kg, ≤ sisa)        |
| `outputs[].idJenis`      | number                              | Harus sama dengan jenis input                         |
| `outputs[].saks`         | array                               | Daftar sak output                                     |
| `outputs[].saks[].noSak` | number                              | Nomor sak                                             |
| `outputs[].saks[].berat` | number                              | Berat per sak                                         |
| Balance                  | berat                               | Berdasarkan total berat                               |

Dengan `inputsPartial`, berat terpakai dialokasikan first-fit ke sak-sak
label berurutan `NoSak`: sak yang habis dialokasi penuh ditandai
`DateUsage`, sak terakhir yang dialokasi sebagian dicatat baris
`MixerPartial` (berisi kg terpakai, backlink
`BongkarSusunInputMixerPartial`), dan sisanya tetap hidup.

### 7) Furniture WIP

| Field               | Format                              | Keterangan                         |
| ------------------- | ----------------------------------- | ---------------------------------- |
| `inputs`            | `["BB.0000044552"]`                 | Label furniture WIP                |
| `inputsPartial`     | `[{ labelCode, qty }]`, opsional    | Override pcs terpakai per label    |
| `outputs[].idJenis` | number                              | Harus sama dengan jenis input      |
| `outputs[].pcs`     | number                              | Jumlah pcs output                  |
| Balance             | pcs                                 | Berdasarkan total pcs              |

### 8) Barang Jadi

| Field               | Format              | Keterangan                    |
| ------------------- | ------------------- | ----------------------------- |
| `inputs`            | `["BA.0000040338"]` | Label barang jadi             |
| `outputs[].idJenis` | number              | Harus sama dengan jenis input |
| `outputs[].pcs`     | number              | Jumlah pcs output             |
| Balance             | pcs                 | Berdasarkan total pcs         |

#### Label yang sudah pernah di-partial

Label barang jadi yang sebelumnya sudah dipecah oleh modul lain
(penjualan / retur-v3) **boleh** dipakai sebagai input, dan tidak lagi
ditolak dengan `409`. Yang dipakai adalah seluruh **sisa** pcs label tsb:

```
sisaPcs = BarangJadi.Pcs - SUM(BarangJadiPartial.Pcs)
```

`GET /label/:labelCode` mengembalikan nilai `sisaPcs` itu di field `pcs`,
plus flag `isPartial`. Client cukup memakai `pcs` apa adanya — tidak perlu
menghitung sendiri.

Secara default seluruh sisa pcs input dipakai, jadi `totalPcsInput` =
`totalPcsOutput`. Untuk memakai **sebagian** sisa saja, client mengirim
`inputsPartial` (lihat format umum): label tetap ada di `inputs`, hanya
jumlah pcs-nya yang di-override. Label dengan sisa tersisa tidak
di-`DateUsage` sehingga masih bisa dipakai lagi.

#### Pencatatan partial pada input

Untuk label yang **sudah pernah dipecah** sebelumnya (`IsPartial = 1`),
pcs yang dipakai siklus ini dicatat sebagai baris baru di
`dbo.BarangJadiPartial` (prefix `BL.`). Gunanya: pcs tersebut punya jejak
"dipakai oleh bongkar susun" sendiri, terpisah dari baris partial milik
penjualan / retur-v3.

Kode partial-nya dicatat di **tabel link**, persis seperti kategori
furnitureWip (`BongkarSusunInputFurnitureWIPPartial`):

```
BongkarSusunInputBarangjadi            (NoBongkarSusun, NoBJ)
+ BongkarSusunInputBarangJadiPartial (NoBongkarSusun, NoBJPartial)
```

`BongkarSusunInputBarangjadi` hanya menyimpan labelnya. Pcs yang terpakai
dibaca dari `BarangJadiPartial.Pcs` milik baris link tsb:

| Kondisi label input   | Baris di tabel link | Sumber `pcs` |
| --------------------- | ------------------- | ------------ |
| Utuh, dipakai penuh | tidak ada | `BarangJadi.Pcs` |
| Utuh, dipakai sebagian (`inputsPartial`) | ada (`BL.xxxxxxxx`) | `BarangJadiPartial.Pcs` |
| Sudah pernah di-partial | ada (`BL.xxxxxxxx`) | `BarangJadiPartial.Pcs` |

Hapus transaksi membersihkan link ini lebih dulu (ada FK
`BongkarSusunInputBarangJadiPartial.NoBJPartial` →
`BarangJadiPartial.NoBJPartial`) sebelum baris partial-nya dihapus.

Hapus bongkar-susun memakai baris link tersebut sebagai backlink: baris
`BarangJadiPartial` yang dibuat transaksi itu dihapus, `DateUsage` di-reset
`NULL`, dan `IsPartial` diturunkan ke `0` kalau tidak ada partial lain
tersisa untuk label tersebut. Partial dari penjualan / retur-v3 tidak ikut
terhapus - pcs-nya tetap terpakai dan sisa pcs parent tetap benar.

Tabel link dibuat di
`V20261005093716__create_bongkarsusun_input_barangjadi_partial.sql`, yang
sekaligus memindahkan isi lama kolom `NoPartial` / `Pcs` (dari
`V20261003120000`) lalu membuang kedua kolom itu.

> Catatan: `PK_BongkarSusunInputBarangjadi` ada pada `NoBJ` saja, jadi satu
> label barang jadi hanya boleh tercatat sebagai input di SATU transaksi
> bongkar-susun. Karena setelah dipakai label selalu selesai
> (`DateUsage` terisi) dan tidak bisa di-scan lagi, ini tidak menjadi
> masalah pada alur normal — delete transaksi melepas barisnya.

Label dengan sisa 0 pcs ditolak (`400`) karena tidak ada yang bisa dibongkar.

### 9) Bonggolan

| Field               | Format             | Keterangan                    |
| ------------------- | ------------------ | ----------------------------- |
| `inputs`            | `["M.0000011729"]` | Label bonggolan               |
| `outputs[].idJenis` | number             | Harus sama dengan jenis input |
| `outputs[].berat`   | number             | Berat output                  |
| Balance             | berat              | Berdasarkan total berat       |

## POST Response

Response umum:

```json
{
  "success": true,
  "data": {
    "noBongkarSusun": "BG.0000002279",
    "tanggal": "2026-04-24",
    "category": "bahanBaku",
    "totalBeratInput": 2000,
    "totalBeratOutput": 2000,
    "inputs": [],
    "outputs": [],
    "audit": {
      "actorId": 109,
      "requestId": "..."
    }
  }
}
```

Catatan:

- Untuk kategori berbasis berat, field total memakai `totalBeratInput` dan `totalBeratOutput`.
- Untuk kategori berbasis pcs, field total memakai `totalPcsInput` dan `totalPcsOutput`.
- Format `outputs` mengikuti kategori masing-masing.

## GET Label Info ` /api/bongkar-susun-v2/label/:labelCode`

### Bahan Baku

Format label:

- `A.<NoBahanBaku>-<NoPallet>`

Contoh:

- `A.0000002509-1`

Response:

```json
{
  "labelCode": "A.0000002509-1",
  "category": "bahanBaku",
  "noPallet": 1,
  "idJenis": 137,
  "namaJenis": "NAMA JENIS",
  "idWarehouse": 1,
  "namaWarehouse": "NAMA WAREHOUSE",
  "keterangan": null,
  "idStatus": 1,
  "statusText": "PASS",
  "moisture": null,
  "meltingIndex": null,
  "elasticity": null,
  "tenggelam": null,
  "density": null,
  "density2": null,
  "density3": null,
  "hasBeenPrinted": 0,
  "blok": "BSS",
  "idLokasi": 1,
  "sakActual": 10,
  "beratActual": 2010.07,
  "sakSisa": 4,
  "beratSisa": 1000,
  "isEmpty": false,
  "details": []
}
```

Jika semua sak pada pallet tersebut sudah memiliki `DateUsage`, label dianggap sudah terpakai.

### Washing

```json
{
  "labelCode": "B.0000013157",
  "category": "washing",
  "dateCreate": "2026-04-24T00:00:00.000Z",
  "idJenis": 46,
  "namaJenis": "PP GIL HITAM (CUCI)",
  "jumlahSak": 30,
  "totalBerat": 750,
  "hasBeenPrinted": 0,
  "createBy": "x",
  "mesin": "BG.0000002258",
  "shift": 1,
  "idWarehouse": 1,
  "namaWarehouse": "INJECT",
  "idStatus": 1,
  "statusText": "PASS"
}
```

### Broker

```json
{
  "labelCode": "D.0000001234",
  "category": "broker",
  "dateCreate": "2026-04-24T00:00:00.000Z",
  "idJenis": 18,
  "namaJenis": "NAMA BROKER",
  "jumlahSak": 10,
  "totalBerat": 999,
  "saks": [],
  "hasBeenPrinted": 0,
  "createBy": "x",
  "mesin": "MESIN A",
  "shift": 1,
  "idWarehouse": 1,
  "namaWarehouse": "WAREHOUSE A",
  "idStatus": 1,
  "statusText": "PASS"
}
```

### Crusher

```json
{
  "labelCode": "F.0000005811",
  "category": "crusher",
  "dateCreate": "2026-04-22T00:00:00.000Z",
  "idJenis": 28,
  "namaJenis": "BONGGOLAN CRUSHER HIJAU BROKER",
  "dateUsage": null,
  "berat": 500,
  "mesin": "BG.0000002252",
  "createBy": "x",
  "namaWarehouse": "INJECT",
  "shift": 0,
  "hasBeenPrinted": 0
}
```

### Gilingan

```json
{
  "labelCode": "V.0000001234",
  "category": "gilingan",
  "dateCreate": "2026-04-24T00:00:00.000Z",
  "idJenis": 12,
  "namaJenis": "NAMA GILINGAN",
  "totalBerat": 250,
  "dateUsage": null,
  "mesin": "MESIN A",
  "createBy": "x",
  "namaWarehouse": "WAREHOUSE A",
  "shift": 1,
  "hasBeenPrinted": 0
}
```

### Mixer

```json
{
  "labelCode": "H.0000025312",
  "category": "mixer",
  "dateCreate": "2026-04-24T00:00:00.000Z",
  "idJenis": 25,
  "namaJenis": "PP MIX CREAM LEMARI",
  "jumlahSak": 5,
  "totalBerat": 75,
  "saks": [],
  "dateUsage": null,
  "mesin": "MESIN A",
  "createBy": "x",
  "namaWarehouse": "WAREHOUSE A",
  "shift": 1,
  "hasBeenPrinted": 0
}
```

### Furniture WIP

```json
{
  "labelCode": "BB.0000044552",
  "category": "furnitureWip",
  "dateCreate": "2026-04-23T00:00:00.000Z",
  "idJenis": 177,
  "namaJenis": "CUP PANEL HITAM (MS 2802)",
  "pcs": 30,
  "hasBeenPrinted": 0,
  "createBy": "x",
  "mesin": "BG.0000002258",
  "shift": null
}
```

### Barang Jadi

```json
{
  "labelCode": "BA.0000040338",
  "category": "barangJadi",
  "dateCreate": "2025-11-11T00:00:00.000Z",
  "idJenis": 284,
  "namaJenis": "GRANDE PLASTIK KABINET PK 3003 3TX6P AVNGR (LP 008)",
  "pcs": 3,
  "hasBeenPrinted": 0,
  "createBy": "x",
  "mesin": "PACKING LEMARI",
  "shift": 1
}
```

### Bonggolan

```json
{
  "labelCode": "M.0000011729",
  "category": "bonggolan",
  "idJenis": 18,
  "namaJenis": "NAMA BONGGOLAN",
  "idWarehouse": null,
  "idStatus": true,
  "totalBerat": 999
}
```

### Reject

```json
{
  "labelCode": "BF.0000001234",
  "category": "reject",
  "dateCreate": "2026-10-08",
  "idJenis": 3,
  "namaJenis": "REJECT PARTAI",
  "idWarehouse": 1,
  "totalBerat": 50,
  "totalPartialBerat": 12.5,
  "beratSisa": 37.5,
  "berat": 37.5,
  "isPartial": true,
  "jam": "08:00",
  "hasBeenPrinted": 0,
  "createBy": "operator",
  "blok": "BSS",
  "idLokasi": 1
}
```

`totalBerat` = berat bruto label, `totalPartialBerat` = berat yang sudah
tercatat sebagai partial, `beratSisa`/`berat` = sisa berat yang boleh dipakai
sebagai input (0 / label habis → HTTP 409).

## GET List ` /api/bongkar-susun-v2`

Response list sekarang memuat:

| Field              | Keterangan          |
| ------------------ | ------------------- |
| `NoBongkarSusun`   | Nomor transaksi     |
| `Tanggal`          | Tanggal transaksi   |
| `IdUsername`       | ID user pembuat     |
| `Username`         | Username pembuat    |
| `Note`             | Catatan             |
| `category`         | Kategori transaksi  |
| `inputLabelCount`  | Jumlah label input  |
| `outputLabelCount` | Jumlah label output |
| `balance`          | Status balance      |

Catatan:

- `bahanBaku` dihitung balance berdasarkan **berat**
- kategori lain mengikuti logika masing-masing

## GET Detail ` /api/bongkar-susun-v2/:noBongkarSusun`

Response detail:

```json
{
  "header": {},
  "inputs": [],
  "outputs": []
}
```

Catatan:

- `bahanBaku` detail dikelompokkan per `NoBahanBaku` + `NoPallet`
- `washing`, `broker`, dan `mixer` menampilkan detail sak
- kategori berbasis `pcs` tetap memakai `pcs`

## DELETE ` /api/bongkar-susun-v2/:noBongkarSusun`

Hapus transaksi bongkar susun, dengan guard agar tidak menghapus transaksi yang sudah menghasilkan output terpakai di proses lain.
