const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "stock-opname-v2-report-pdf.html");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} ${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatNumber(value, fractionDigits = 2) {
  if (value === null || value === undefined || value === "") return "0";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "0";

  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numberValue);
}

function qtyLabel(row, unit) {
  return "totalWeight" in row
    ? `${formatNumber(row.totalWeight, 2)} kg`
    : `${formatNumber(row.totalPcs, 0)} ${unit === "pcs" ? "pcs" : ""}`.trim();
}

function lokasiLabel(blok, locationId) {
  if (blok === "TIDAK_DIKETAHUI") return "Tidak diketahui";
  return [blok, locationId]
    .filter((value) => value !== null && value !== undefined)
    .join("");
}

// Laporan ini dicetak untuk MERINGKAS HASIL stock opname (biasanya setelah
// selesai) — fokusnya selisih (label tidak ditemukan) & kendala lapangan
// (salah lokasi), bukan progres real-time. Gaya sengaja dibuat tenang/quiet
// (dokumen formal, bukan dashboard): tanpa banner/badge/latar berwarna,
// cuma tipografi tipis (garis rambut, teks) — satu-satunya aksen warna
// adalah MERAH pada angka yang jadi perhatian (selisih/salah lokasi).
function sectionBlock(title, innerHtml) {
  return `
    <section class="section">
      <div class="section-title">${escapeHtml(title)}</div>
      ${innerHtml}
    </section>`;
}

function noData(message) {
  return `<div class="no-data">${escapeHtml(message)}</div>`;
}

function dataTable(theadHtml, tbodyHtml, tfootHtml = "") {
  return `
    <table class="data-table">
      <thead><tr>${theadHtml}</tr></thead>
      <tbody>${tbodyHtml}</tbody>
      ${tfootHtml ? `<tfoot>${tfootHtml}</tfoot>` : ""}
    </table>`;
}

function callout(message) {
  return `<div class="callout">${message}</div>`;
}

// Satu kalimat ringkas di bawah header — pengganti banner besar berwarna,
// cukup dibaca sekilas tanpa perlu kotak/ikon.
function verdictNote(unscannedCount, mismatchCount) {
  if (unscannedCount === 0 && mismatchCount === 0) {
    return `Seluruh label ditemukan sesuai lokasi tercatat — <strong>tidak ada selisih maupun kendala lokasi</strong> pada sesi ini.`;
  }

  const parts = [];
  if (unscannedCount > 0) {
    parts.push(`<span class="tone-red">${formatNumber(unscannedCount, 0)} label selisih</span>`);
  }
  if (mismatchCount > 0) {
    parts.push(`<span class="tone-red">${formatNumber(mismatchCount, 0)} kendala lokasi</span>`);
  }

  return `Ditemukan ${parts.join(" dan ")} — rincian tersedia pada bagian "Label Belum Ditemukan" dan "Scan di Lokasi Berbeda" di bawah.`;
}

// ── Ringkasan ─────────────────────────────────────────────────────────────

function buildSummarySection(summary, unit, scannedMetric, unscannedMetric) {
  const total = summary.total || {};
  const unitLabel = unit === "pcs" ? "pcs" : "kg";
  const metricName = unit === "pcs" ? "Pcs" : "Berat";
  const fractionDigits = unit === "pcs" ? 0 : 2;
  const totalMetric = unit === "pcs" ? total.totalPcs : total.totalWeight;

  const rows = `
    <tr>
      <td>Tercatat (semua label)</td>
      <td class="right">${formatNumber(total.labelCount, 0)}</td>
      <td class="right">${formatNumber(totalMetric, fractionDigits)} ${unitLabel}</td>
    </tr>
    <tr>
      <td>Ditemukan / terscan</td>
      <td class="right">${formatNumber(total.scannedCount, 0)}</td>
      <td class="right">${formatNumber(scannedMetric, fractionDigits)} ${unitLabel}</td>
    </tr>
    <tr>
      <td>Belum ditemukan (Label Belum Ditemukan)</td>
      <td class="right tone-red">${formatNumber(total.unscannedCount, 0)}</td>
      <td class="right tone-red">${formatNumber(unscannedMetric, fractionDigits)} ${unitLabel}</td>
    </tr>`;

  const table = dataTable(
    `<th>Metrik</th><th class="right">Jumlah Label</th><th class="right">${metricName}</th>`,
    rows,
  );

  return sectionBlock("Ringkasan Hasil", table);
}

// ── Selisih — Label Tidak Ditemukan ─────────────────────────────────────

// Batas keras jumlah label yang dicetak — sesi dengan ribuan label belum
// discan (mis. kategori washing/broker yang baru mulai) bisa membuat PDF
// puluhan/ratusan halaman, yang lambat digenerate DAN berat dirender ulang
// sebagai preview di tablet (rasterisasi per halaman pernah bikin OOM).
// Total tetap dilaporkan lewat callout & stat "Tidak Ditemukan" di atas —
// ── Label Belum Ditemukan ─────────────────────────────────────────────────
// Format tabel ringan: inline CSS (bukan class), font 6px, padding 0,
// border-collapse: separate, chunk 300 baris per tabel.

function buildUnscannedLabelsSection(unscannedLabels, unit, unscannedMetric, total) {
  const allRows = unscannedLabels?.data || [];
  const unitLabel = unit === "pcs" ? "pcs" : "kg";
  const labelCount = total?.labelCount || 0;
  const unscannedCount = total?.unscannedCount || 0;
  const missingPct = labelCount > 0 ? Math.round((unscannedCount / labelCount) * 100) : 0;

  if (allRows.length === 0) {
    return sectionBlock(
      "Label Belum Ditemukan",
      callout("Seluruh label ditemukan saat opname — <strong>tidak ada selisih</strong> pada sesi ini."),
    );
  }

  const intro = callout(
    `<strong>${formatNumber(unscannedCount, 0)} dari ${formatNumber(labelCount, 0)} label (${missingPct}%)</strong> tidak ditemukan saat opname, setara dengan <strong>${formatNumber(unscannedMetric, unit === "pcs" ? 0 : 2)} ${unitLabel}</strong>.`,
  );

  const digits = unit === "pcs" ? 0 : 2;
  const metricOf = (r) => (unit === "pcs" ? r.pcs ?? 0 : r.weight ?? 0);
  const totalRowsMetric = allRows.reduce((s, r) => s + metricOf(r), 0);
  const unitHeader = unit === "pcs" ? "Pcs" : "Berat";

  const CHUNK = 300;
  const TH = 'style="background:#1e40af;color:#fff;padding:1px 4px;font-size:6px;font-weight:700;border:1px solid #1e3a8a"';
  const TD = 'style="padding:0 3px;font-size:6px;border-bottom:1px solid #e2e8f0"';
  const TD_R = TD + ';text-align:right"';
  const TD_C = TD + ';text-align:center"';
  const TF_TL = 'style="background:#eef2ff;padding:2px 3px;font-size:6px;font-weight:700;border-top:2px solid #1e40af"';
  const TF_R = TF_TL + ';text-align:right"';

  const tables = [];
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const isLast = (i + CHUNK) >= allRows.length;

    const body = chunk.map((row) => {
      const lok = row.blok === "TIDAK_DIKETAHUI"
        ? "Tidak diketahui"
        : lokasiLabel(row.blok, row.locationId);
      const dt = row.labelDate ? ` <span style="color:#94a3b8">${escapeHtml(formatDate(row.labelDate))}</span>` : "";
      return `<tr>
        <td ${TD}>${escapeHtml(row.labelNo)}${dt}</td>
        <td ${TD}>${escapeHtml(row.typeName ?? "-")}</td>
        <td ${TD_C}>${escapeHtml(lok)}</td>
        <td ${TD_R}>${formatNumber(metricOf(row), digits)}</td>
      </tr>`;
    }).join("");

    const tfoot = isLast ? `<tfoot><tr>
      <td ${TF_TL}>TOTAL (${formatNumber(allRows.length, 0)} label)</td>
      <td ${TF_TL}></td><td ${TF_TL}></td>
      <td ${TF_R}>${formatNumber(totalRowsMetric, digits)}</td>
    </tr></tfoot>` : "";

    tables.push(
      `<table style="width:100%;border-collapse:separate;border-spacing:0;">
        <thead><tr>
          <th ${TH}>No. Label</th>
          <th ${TH}>Jenis</th>
          <th ${TH} style="text-align:center">Lokasi</th>
          <th ${TH} style="text-align:right">${unitHeader}</th>
        </tr></thead>
        <tbody>${body}</tbody>${tfoot}
      </table>`
    );
  }

  return sectionBlock("Label Belum Ditemukan", `${intro}${tables.join("")}`);
}

// ── Kendala Lokasi — Salah Lokasi Scan ───────────────────────────────────

// Batas jumlah baris salah-lokasi yang dicetak rinci — kalau kejadian salah
// lokasi sedang banyak-banyaknya (mis. baru pindah gudang), daftar
// per-label bisa sangat panjang. Total tetap akurat lewat callout di atas
// tabel, cuma rinciannya yang dipotong.
const MAX_MISMATCH_ROWS_PRINTED = 300;

function buildLocationMatchSection(locationMatch, unit) {
  const matchCount = locationMatch?.matchCount ?? 0;
  const allMismatches = locationMatch?.mismatches || [];

  if (allMismatches.length === 0) {
    return sectionBlock(
      "Scan di Lokasi Berbeda",
      callout(
        "Seluruh label discan sesuai lokasi tercatat di sistem — <strong>tidak ada kendala lokasi</strong> pada sesi ini.",
      ),
    );
  }

  const intro = callout(
    `<strong>${formatNumber(allMismatches.length, 0)} label</strong> ditemukan discan di lokasi yang berbeda dari catatan sistem (dari ${formatNumber(matchCount + allMismatches.length, 0)} label yang discan).`,
  );

  const truncated = allMismatches.length > MAX_MISMATCH_ROWS_PRINTED;
  const rows = truncated
    ? allMismatches.slice(0, MAX_MISMATCH_ROWS_PRINTED)
    : allMismatches;

  const body = rows
    .map(
      (m) => `
        <tr>
          <td class="label-list">${escapeHtml(m.labelNo)}${
            m.labelDate
              ? `<div class="tone-muted" style="font-size:7px;">${escapeHtml(formatDate(m.labelDate))}</div>`
              : ""
          }</td>
          <td>${escapeHtml(m.typeName ?? "-")}</td>
          <td class="center">${escapeHtml(lokasiLabel(m.referenceBlok, m.referenceLocationId))}</td>
          <td class="center tone-red">${escapeHtml(lokasiLabel(m.scannedBlok, m.scannedLocationId))}</td>
          <td>${escapeHtml(m.fullName || m.username || "-")}</td>
          <td class="center">${escapeHtml(formatDateTime(m.scannedAt))}</td>
          <td class="right">${formatNumber(
            unit === "pcs" ? (m.pcs ?? 0) : (m.weight ?? 0),
            unit === "pcs" ? 0 : 2,
          )}</td>
        </tr>`,
    )
    .join("");

  const table = dataTable(
    `<th>No. Label</th><th>Jenis</th><th class="center">Lokasi Tercatat</th><th class="center">Lokasi Discan</th><th>User</th><th class="center">Waktu Scan</th><th class="right">${unit === "pcs" ? "Pcs" : "Berat"}</th>`,
    body,
  );

  const truncNote = truncated
    ? `<div class="note-banner">Menampilkan ${formatNumber(MAX_MISMATCH_ROWS_PRINTED, 0)} dari ${formatNumber(allMismatches.length, 0)} label salah lokasi.</div>`
    : "";

  return sectionBlock(
    "Scan di Lokasi Berbeda",
    `${intro}${table}${truncNote}`,
  );
}

// ── Rincian per Jenis ─────────────────────────────────────────────────────

function buildJenisSection(perJenis, unit, categoryName) {
  // Barang Jadi: urutkan berdasarkan nama Jenis (ASC).
  if (perJenis && /barang\s*jadi/i.test(categoryName || "")) {
    perJenis = [...perJenis].sort((a, b) =>
      String(a.typeName ?? "").localeCompare(String(b.typeName ?? ""), "id", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }

  if (!perJenis || perJenis.length === 0) {
    return sectionBlock("Rekap per Jenis", noData("Belum ada data jenis."));
  }

  const rows = perJenis
    .map((row) => {
      const belum = row.unscannedCount || 0;
      return `
        <tr>
          <td>${escapeHtml(row.typeName ?? `Jenis #${row.typeId ?? "-"}`)}</td>
          <td class="center">${formatNumber(row.labelCount, 0)}</td>
          <td class="center">${formatNumber(row.scannedCount, 0)}</td>
          <td class="center ${belum > 0 ? "tone-red" : "tone-muted"}">${formatNumber(belum, 0)}</td>
          <td class="right">${qtyLabel(row, unit)}</td>
        </tr>`;
    })
    .join("");

  const table = dataTable(
    `<th>Jenis</th><th class="center">Label</th><th class="center">Ditemukan</th><th class="center">Selisih</th><th class="right">${unit === "pcs" ? "Pcs" : "Berat"}</th>`,
    rows,
  );

  return sectionBlock("Rekap per Jenis", table);
}

// ── Rincian per Blok ──────────────────────────────────────────────────────

function buildBlokSection(perBlok, unit) {
  if (!perBlok || perBlok.length === 0) {
    return sectionBlock("Rekap per Blok", noData("Belum ada data blok."));
  }

  const rows = perBlok
    .map((row) => {
      const isUnknown = row.blok === "TIDAK_DIKETAHUI";
      const belum = row.unscannedCount || 0;
      return `
        <tr>
          <td>${isUnknown ? "Tanpa Blok" : `Blok ${escapeHtml(row.blok)}`}</td>
          <td class="center">${formatNumber(row.locationCount, 0)}</td>
          <td class="center">${formatNumber(row.labelCount, 0)}</td>
          <td class="center">${formatNumber(row.scannedCount, 0)}</td>
          <td class="center ${belum > 0 ? "tone-red" : "tone-muted"}">${formatNumber(belum, 0)}</td>
          <td class="right">${qtyLabel(row, unit)}</td>
        </tr>`;
    })
    .join("");

  const table = dataTable(
    `<th>Blok</th><th class="center">Lokasi</th><th class="center">Label</th><th class="center">Ditemukan</th><th class="center">Selisih</th><th class="right">${unit === "pcs" ? "Pcs" : "Berat"}</th>`,
    rows,
  );

  return sectionBlock("Rekap per Blok", table);
}

// ── Rincian per User Scan ─────────────────────────────────────────────────

function buildScanUserSection(scanSummary, unit) {
  const rows = scanSummary?.data || [];
  if (rows.length === 0) {
    return sectionBlock("Aktivitas User", noData("Belum ada user yang melakukan scan."));
  }

  const body = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.fullName || row.username)}</td>
          <td class="center">${formatNumber(row.labelCount, 0)}</td>
          <td class="right">${qtyLabel(row, unit)}</td>
          <td class="center">${escapeHtml(formatDateTime(row.firstScanAt))}</td>
          <td class="center">${escapeHtml(formatDateTime(row.lastScanAt))}</td>
        </tr>`,
    )
    .join("");

  const table = dataTable(
    `<th>User</th><th class="center">Label</th><th class="right">${unit === "pcs" ? "Pcs" : "Berat"}</th><th class="center">Scan Pertama</th><th class="center">Scan Terakhir</th>`,
    body,
  );

  return sectionBlock("Aktivitas User", table);
}

// ── Assembly ──────────────────────────────────────────────────────────────

function buildStockOpnameV2ReportHtml({
  summary,
  scanSummary,
  unscannedLabels,
  locationMatch,
}) {
  const templateHtml = fs.readFileSync(templatePath, "utf8");
  const unit = summary.categoryCode === "furniturewip" ? "pcs" : "kg";

  // "Terscan" = total dikurangi bagian tidak ditemukan (dihitung dari
  // getUnscannedLabels, bukan dari hasil scan langsung) — supaya kedua
  // angka selalu berjumlah persis sama dengan total, termasuk untuk label
  // "Lokasi Tidak Diketahui" yang tetap ikut terhitung di total.
  const totalMetric =
    unit === "pcs" ? (summary.total?.totalPcs ?? 0) : (summary.total?.totalWeight ?? 0);
  const unscannedMetric =
    unit === "pcs"
      ? (unscannedLabels?.totalUnscannedPcs ?? 0)
      : (unscannedLabels?.totalUnscannedWeight ?? 0);
  const scannedMetric =
    unit === "pcs"
      ? totalMetric - unscannedMetric
      : Math.round((totalMetric - unscannedMetric) * 100) / 100;

  const unscannedCount = summary.total?.unscannedCount || 0;
  const mismatchCount = locationMatch?.mismatches?.length || 0;

  const content = [
    buildSummarySection(summary, unit, scannedMetric, unscannedMetric),
    buildUnscannedLabelsSection(unscannedLabels, unit, unscannedMetric, summary.total),
    buildLocationMatchSection(locationMatch, unit),
    buildJenisSection(summary.perJenis, unit, summary.categoryName),
    buildBlokSection(summary.perBlok, unit),
    buildScanUserSection(scanSummary, unit),
  ].join("");

  return templateHtml
    .replace(/\{\{noso\}\}/g, escapeHtml(summary.stockOpnameNo))
    .replace("{{categoryName}}", escapeHtml(summary.categoryName))
    .replace("{{tanggalMulai}}", escapeHtml(formatDate(summary.date)))
    .replace(
      "{{tanggalSelesai}}",
      summary.completedAt ? escapeHtml(formatDate(summary.completedAt)) : "—",
    )
    .replace(
      "{{statusLabel}}",
      summary.isComplete
        ? `Selesai${summary.completedAt ? ` · ${formatDate(summary.completedAt)}` : ""}`
        : "Sedang Berjalan",
    )
    .replace("{{verdictNote}}", verdictNote(unscannedCount, mismatchCount))
    .replace("{{content}}", content)
    .replace("{{printedAt}}", formatDateTime(new Date()));
}

module.exports = { buildStockOpnameV2ReportHtml };
