// Helper layout untuk laporan produksi harian (A4 landscape, Puppeteer).
//
// Latar belakang bug: kolom laporan (Pemakaian Bahan / Hasil / Downtime) dulu
// disusun dengan `display: flex`. Saat isi kolom terpotong ke halaman berikutnya,
// Chrome menambah tinggi untuk thead yang diulang dan baris `break-inside: avoid`,
// tapi tinggi flex item TIDAK ikut bertambah. Akibatnya kolom yang panjang
// tumpah menimpa baris total & kotak tanda tangan di halaman terakhir.
// Tabel (termasuk `display: table`) dipotong antar halaman dengan benar, jadi
// kolom-kolom dibungkus sebagai sel tabel lewat CSS di bawah.

// Lebar area cetak A4 landscape (297mm - margin kiri/kanan 8mm) dalam px CSS.
const PRINT_WIDTH_PX = Math.round(((297 - 16) * 96) / 25.4);

// Ditempel di akhir <style> template agar menimpa aturan flex lama.
// Struktur yang diharapkan:
//   .box > .box-cols > .col (x3)          — isi tiap kolom mengalir mandiri
//   .box > .box-foot > .col|.foot (x3)    — baris total, selalu sejajar
const COLUMNS_AS_TABLE_CSS = `
  .page { display: block; min-height: 0; }
  .box { display: block; flex: none; }
  .box-cols, .box-foot { display: table; width: 100%; table-layout: fixed; }
  .box-cols > .col, .box-foot > .col, .box-foot > .foot { display: table-cell; vertical-align: top; }
  .col-body { flex: none; }
  .sign, .rates { break-inside: avoid; }
`;

/**
 * Siapkan page Puppeteer: viewport = lebar area cetak, media print, lalu isi
 * HTML. Untuk laporan yang muat 1 halaman, elemen `stretchSelector`
 * dipanjangkan supaya garis kolom turun sampai kotak tanda tangan (tampilan
 * lama dari `flex: 1`). Laporan multi-halaman dibiarkan mengalir biasa.
 */
async function setReportContent(page, html, { contentHeightMm, stretchSelector }) {
  await page.setViewport({ width: PRINT_WIDTH_PX, height: 1000 });
  await page.emulateMediaType("print");
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  if (!stretchSelector) return;
  await page.evaluate(
    (heightMm, selector) => {
      const pageH = (heightMm * 96) / 25.4;
      const extra = pageH - document.body.scrollHeight - 6;
      const el = document.querySelector(selector);
      if (el && extra > 0) {
        el.style.height = `${el.getBoundingClientRect().height + extra}px`;
      }
    },
    contentHeightMm,
    stretchSelector,
  );
}

module.exports = {
  PRINT_WIDTH_PX,
  COLUMNS_AS_TABLE_CSS,
  setReportContent,
};
