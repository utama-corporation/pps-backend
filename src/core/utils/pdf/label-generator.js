const QRCode = require('qrcode');
const { getBrowser, acquirePageSlot, releasePageSlot } = require('./browser');

/**
 * Generate PDF label dari data + template function
 * @param {object} data         - data label, akan di-pass ke templateFn
 * @param {Function} templateFn - function(data) => HTML string
 * @param {object} options
 * @param {string} options.width  - lebar halaman (default: '80mm')
 * @param {string} options.height - tinggi halaman fix (mis. '40mm'). Jika di-set,
 *                                  ukuran halaman dikunci dan tinggi konten TIDAK diukur dinamis.
 * @returns {Buffer} PDF buffer
 */
const MM_TO_PX = 96 / 25.4; // 1mm @ 96dpi

function mmToPx(value) {
  const num = parseFloat(String(value));
  return Math.ceil(num * MM_TO_PX);
}

async function generateLabelPdf(data, templateFn, options = {}) {
  const width = options.width || '80mm';
  const fixedHeight = options.height || null;

  // 1. Generate QR code sebagai base64
  const qrValue = data.noLabel || data.kode || 'NO-CODE';
  const qrBase64 = await QRCode.toDataURL(qrValue, {
    width: 200,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  // 2. Render HTML via template function
  const html = templateFn({ ...data, qrBase64 });

  // 3. Launch browser (reuse jika sudah ada), dibatasi jumlah page paralel
  // supaya batch print (banyak label sekaligus) tidak membuat semua page
  // rebutan CPU sampai navigation timeout.
  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // HTML label tidak memuat resource eksternal (gambar QR sudah base64
    // inline), jadi 'domcontentloaded' cukup — tidak perlu menunggu
    // 'networkidle0' yang rawan molor saat banyak page render bersamaan.
    // Ukuran halaman fix (lebar x tinggi dikunci) — dipakai untuk label thermal berukuran tetap
    if (fixedHeight) {
      await page.setViewport({ width: mmToPx(width), height: mmToPx(fixedHeight) });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const pdf = await page.pdf({
        width,
        height: fixedHeight,
        printBackground: true,
        pageRanges: '1',
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });

      return pdf;
    }

    // Set viewport lebar dulu, tinggi sementara (besar agar konten tidak terpotong)
    await page.setViewport({ width: 302, height: 3000 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Baca tinggi konten aktual dari elemen .label (lebih akurat dari body.scrollHeight pada flex layout)
    const contentHeight = await page.evaluate(() => {
      const el = document.querySelector('.label');
      if (el) return Math.ceil(el.getBoundingClientRect().height) + 2;
      return Math.ceil(document.documentElement.offsetHeight) + 2;
    });

    // Set viewport ulang sesuai tinggi konten agar tidak ada blank space
    await page.setViewport({ width: 302, height: contentHeight });

    const pdf = await page.pdf({
      width,
      height: `${contentHeight}px`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return pdf;
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = { generateLabelPdf };
