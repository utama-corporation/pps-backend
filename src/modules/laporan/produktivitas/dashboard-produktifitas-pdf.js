// src/modules/laporan/produktivitas/dashboard-produktifitas-pdf.js
// PDF Laporan Dashboard Produktifitas (meniru dashboardproduktifitas.pdf versi Crystal Report).
// Sumber: sp_LapDashboardProduktifitas -> baris panjang (Date, tipe, Grup, Total).
// Dipivot jadi: baris = tanggal, kolom = Grup (Gilingan, Mixer, Hasil Mixer, ...) x tipe/mesin.
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");

// Urutan grup seperti di PDF contoh. Grup lain (jika ada) ditaruh di akhir.
const GROUP_ORDER = [
  "Gilingan",
  "Mixer",
  "Hasil Mixer",
  "Hasil Inject",
  "Reject Inject",
  "Hot Stamping",
  "Packing",
  "Pasang Kunci",
];

// Grup yang kolomnya INPUT lalu OUTPUT (bukan nama mesin).
const IO_GROUPS = new Set(["Gilingan", "Mixer"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Format Indonesia: 46.703,94
function fmt2(value) {
  return Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dayOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(d.getTime())) return String(d.getUTCDate()).padStart(2, "0");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? m[3] : String(value);
}

function dateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

const collator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });

function pivot(rows) {
  const data = Array.isArray(rows) ? rows : [];

  // --- kolom ---
  const colMap = new Map(); // grup -> Set(tipe)
  for (const r of data) {
    const g = String(r.Grup ?? "").trim();
    const t = String(r.tipe ?? "").trim();
    if (!colMap.has(g)) colMap.set(g, new Set());
    colMap.get(g).add(t);
  }
  const groups = [
    ...GROUP_ORDER.filter((g) => colMap.has(g)),
    ...[...colMap.keys()].filter((g) => !GROUP_ORDER.includes(g)).sort(collator.compare),
  ].map((g) => {
    const tipes = [...colMap.get(g)];
    if (IO_GROUPS.has(g)) {
      tipes.sort((a, b) => (a === "INPUT" ? -1 : b === "INPUT" ? 1 : 0));
    } else {
      tipes.sort(collator.compare);
    }
    return { name: g, tipes };
  });

  // --- baris (tanggal) ---
  const dateKeys = [...new Set(data.map((r) => dateKey(r.Date)))].sort();
  const dayLabel = new Map();
  for (const r of data) dayLabel.set(dateKey(r.Date), dayOf(r.Date));

  // --- sel ---
  const cell = new Map(); // `${date}|${grup}|${tipe}` -> total
  for (const r of data) {
    if (r.Total == null) continue;
    const k = `${dateKey(r.Date)}|${String(r.Grup ?? "").trim()}|${String(r.tipe ?? "").trim()}`;
    cell.set(k, (cell.get(k) || 0) + Number(r.Total));
  }

  return { groups, dateKeys, dayLabel, cell };
}

function buildDashboardProduktifitasHtml({ rows }) {
  const { groups, dateKeys, dayLabel, cell } = pivot(rows);

  const cols = [];
  for (const g of groups) for (const t of g.tipes) cols.push({ g: g.name, t });

  // teks tiap sel + total per kolom (dihitung dulu supaya lebar kolom bisa
  // disesuaikan dengan isi terpanjang sehingga angka tidak saling menimpa)
  const colTotals = cols.map(() => 0);
  const colHas = cols.map(() => false);
  const texts = dateKeys.map((dk) =>
    cols.map((c, i) => {
      const v = cell.get(`${dk}|${c.g}|${c.t}`);
      if (v == null) return "";
      colTotals[i] += v;
      colHas[i] = true;
      return fmt2(v);
    }),
  );
  const totalTexts = cols.map((_, i) => (colHas[i] ? fmt2(colTotals[i]) : ""));

  // karakter terpanjang per kolom: isi angka (termasuk Total) atau kata terpanjang
  // di judul kolom (judul boleh turun baris, jadi yang dihitung per kata, bold = lebih lebar)
  const maxChars = cols.map((c, i) => {
    const dataLen = Math.max(totalTexts[i].length, ...texts.map((row) => row[i].length));
    const headLen = Math.max(...c.t.split(/\s+/).map((w) => w.length)) * 1.1;
    return Math.max(dataLen * 1.06, headLen); // total & kolom angka bold: sedikit lebih lebar
  });
  const dayChars = Math.max(5, ...[...dayLabel.values()].map((s) => s.length)) * 1.1;

  // pilih ukuran huruf terbesar yang masih membuat semua kolom muat di halaman
  const AVAIL_PX = 1490; // A3 landscape (420mm) - margin 16mm ~ 1527px, sisakan ruang aman
  const CHAR_RATIO = 0.5; // lebar rata-rata 1 karakter / ukuran huruf (cadangan untuk font pengganti)
  const PAD_PX = 8; // padding kiri-kanan + garis
  const needPx = (fontPx) => [
    dayChars * fontPx * CHAR_RATIO + PAD_PX,
    ...maxChars.map((n) => n * fontPx * CHAR_RATIO + PAD_PX),
  ];
  let fontPx = 10;
  while (fontPx > 4 && needPx(fontPx).reduce((s, n) => s + n, 0) > AVAIL_PX) fontPx -= 0.25;
  const need = needPx(fontPx);
  const sumNeed = need.reduce((s, n) => s + n, 0);
  const colgroup = need.map((n) => `<col style="width:${((n / sumNeed) * 100).toFixed(3)}%" />`).join("");

  const headGroups =
    `<th class="blank"></th>` +
    groups
      .map((g) => `<th class="grp" colspan="${g.tipes.length}">${escapeHtml(g.name)}</th>`)
      .join("");
  const headCols =
    `<th class="blank"></th>` +
    cols.map((c) => `<th class="col">${escapeHtml(c.t)}</th>`).join("");

  const body = dateKeys
    .map(
      (dk, r) =>
        `<tr><td class="d">${escapeHtml(dayLabel.get(dk))}</td>${texts[r]
          .map((t) => `<td class="n">${t}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  const totalRow = dateKeys.length
    ? `<tr class="total"><td class="d">Total</td>${totalTexts
        .map((t) => `<td class="n">${t}</td>`)
        .join("")}</tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: ${fontPx}px; color: #000; }
  .title { text-align: center; font-size: 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #000; overflow: hidden; }
  thead th { font-weight: 700; text-align: center; vertical-align: middle; }
  th.blank { border-top: none; border-left: none; border-bottom: none; }
  thead tr.g th.grp { height: 38px; font-size: ${fontPx + 1}px; }
  thead tr.c th.col { height: ${Math.round(fontPx * 5.6)}px; font-size: ${fontPx}px; padding: 0 2px; line-height: 1.25; }
  thead tr.c th.blank { border-bottom: none; }
  tbody td { height: ${Math.round(fontPx * 2.4)}px; padding: 0 3px; }
  tbody td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tbody td.d { text-align: center; white-space: nowrap; border-left: 1px solid #000; padding: 0 2px; }
  tr.total td { font-weight: 700; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="title">Laporan Dashboard Produktifitas</div>
  <table>
    <colgroup>${colgroup}</colgroup>
    <thead>
      <tr class="g">${headGroups}</tr>
      <tr class="c">${headCols}</tr>
    </thead>
    <tbody>${body}${totalRow}</tbody>
  </table>
</body>
</html>`;
}

async function renderDashboardProduktifitasPdf({ html }) {
  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Lebar layar = lebar area cetak A3 landscape, supaya pengukuran sama dengan hasil PDF.
    await page.setViewport({ width: 1490, height: 900 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    // Pengaman: font di server bisa berbeda dari perkiraan lebar karakter. Jika ada
    // sel yang isinya lebih lebar dari selnya, perkecil huruf bertahap sampai tidak ada.
    await page.evaluate(() => {
      const hasOverflow = () => {
        for (const el of document.querySelectorAll("td.n, td.d, th.col")) {
          if (el.scrollWidth > el.clientWidth + 1) return true;
          if (el.tagName === "TD") {
            const range = document.createRange();
            range.selectNodeContents(el);
            const cs = getComputedStyle(el);
            const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            if (range.getBoundingClientRect().width > inner + 0.5) return true;
          }
        }
        return false;
      };
      const style = document.createElement("style");
      document.head.appendChild(style);
      let size = parseFloat(getComputedStyle(document.body).fontSize);
      for (let i = 0; i < 14 && size > 3.5 && hasOverflow(); i++) {
        size *= 0.94;
        style.textContent = `td, th { font-size: ${size.toFixed(2)}px !important; }`;
      }
    });

    return Buffer.from(
      await page.pdf({
        // 41 kolom: A3 landscape agar semua kolom muat dalam satu halaman.
        format: "A3",
        landscape: true,
        printBackground: true,
        margin: { top: "12mm", right: "8mm", bottom: "10mm", left: "8mm" },
      }),
    );
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildDashboardProduktifitasHtml,
  renderDashboardProduktifitasPdf,
};
