const { poolPromise } = require("../../core/config/db");

/**
 * Tempel blok/lokasi (Lokasi = gabungan Blok+IdLokasi label yang masih
 * sisa, dipisah koma) ke daftar item stok.
 *
 * Dipakai untuk menggantikan subquery korélasi `STUFF(...FOR XML PATH)`
 * pada getStok: subquery tersebut dijalankan sekali PER BARIS MASTER dan
 * pada tabel/CTE besar (BahanBaku_d, Washing_d, PartialSum, dll) bisa
 * menyebabkan timeout. Helper ini mengeksekusi satu query GROUP BY yang
 * ringkas (sekali scan, memakai index), lalu merge hasilnya di JS.
 *
 * @param {Array<object>} items  Hasil map getStok.
 * @param {object} opts
 * @param {string} opts.sql  Query mengembalikan kolom `IdKey, Blok, IdLokasi`,
 *                           `Blok` boleh NULL/kosong (diabaikan).
 * @param {(item: object) => number} opts.idOf Fungsi menghitung id item stok.
 * @returns {Promise<Array<object>>} items yang sama (dimutasi langsung).
 */
async function attachLokasiToStok(items, { sql, idOf }) {
  if (!items.length) return items;

  const pool = await poolPromise;
  const result = await pool.request().query(sql);

  /** @type {Map<number, string[]>} */
  const byKey = new Map();
  for (const row of result.recordset || []) {
    const blok = row.Blok;
    if (blok == null || (typeof blok === "string" && !blok.trim())) continue;
    const value = `${blok}${row.IdLokasi ?? ""}`;
    const key = row.IdKey;
    const list = byKey.get(key);
    if (list) {
      if (!list.includes(value)) list.push(value);
    } else {
      byKey.set(key, [value]);
    }
  }

  for (const item of items) {
    const key = idOf(item);
    const list = byKey.get(key);
    if (list && list.length) {
      item.Lokasi = list.join(", ");
    }
  }

  return items;
}

module.exports = { attachLokasiToStok };