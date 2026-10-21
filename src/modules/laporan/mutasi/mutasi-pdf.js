// src/modules/laporan/mutasi/mutasi-pdf.js
// Builder + renderer PDF untuk Laporan Mutasi Produksi.
// Semua SP mutasi (washing, broker, bonggolan, crusher, gilingan, mixer,
// furniture-wip, barang-jadi, reject) punya pola kolom yang sama:
// 1 kolom nama + kolom nilai utama (Awal/Masuk/Keluar/Akhir) + kolom rincian.
const {
  getBrowser,
  acquirePageSlot,
  releasePageSlot,
} = require("../../../core/utils/pdf/browser");

// Konfigurasi per jenis: judul, kolom nama, kolom nilai utama, satuan, dan
// daftar kolom SP (dipakai sebagai fallback saat hasil kosong).
const MUTASI_JENIS = {
  washing: {
    title: "Mutasi Washing",
    name: "Jenis",
    core: ["BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
    unit: "Kg",
    columns: [
      "Jenis", "BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir",
      "BeratADJKeluar", "BeratBSUKeluar", "BeratBROKKeluar", "BeratWASHKeluar",
      "BeratADJMasuk", "BeratBSUMasuk", "BeratProdMasuk",
    ],
  },
  broker: {
    title: "Mutasi Broker",
    name: "Jenis",
    core: ["BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
    unit: "Kg",
    columns: [
      "Jenis", "BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir",
      "OutputBSU", "OutputBroker", "InputBSU", "InputBroker", "InputInject",
      "InputMixer",
    ],
  },
  bonggolan: {
    title: "Mutasi Bonggolan",
    name: "NamaBonggolan",
    core: ["BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
    unit: "Kg",
    columns: [
      "NamaBonggolan", "BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir",
      "BeratADJKeluar", "BeratBSUKeluar", "BeratCRUSKeluar", "BeratBROKMasuk",
      "BeratINJCMasuk", "BeratADJMasuk", "BeratBSUMasuk", "BeratGILKeluar",
      "KeluarNot", "MasukNot",
    ],
  },
  crusher: {
    title: "Mutasi Crusher",
    name: "NamaCrusher",
    core: ["BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
    unit: "Kg",
    columns: [
      "NamaCrusher", "BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir",
      "BeratBSUInput", "BeratBROKInput", "BeratGILInput", "BeratProdOutput",
      "BeratBSUOutput",
    ],
  },
  gilingan: {
    title: "Mutasi Gilingan",
    name: "NamaGilingan",
    core: ["Awal", "BeratMasuk", "BeratKeluar", "Akhir"],
    unit: "Kg",
    columns: [
      "NamaGilingan", "Awal", "BeratMasuk", "BeratKeluar", "Akhir",
      "BeratProdOutput", "BeratBSUOutput", "BrokInput", "InjectInput",
      "MixInput", "BeratBSUInput", "WashInput",
    ],
  },
  mixer: {
    title: "Mutasi Mixer",
    name: "Jenis",
    core: ["BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
    unit: "Kg",
    columns: [
      "Jenis", "BeratAwal", "BeratMasuk", "MixProdOutput", "MixInjectOutput",
      "MixBSUOutput", "BeratKeluar", "BeratAkhir", "InjectInput", "BrokInput",
      "MixerInput", "BSUInput",
    ],
  },
  "furniture-wip": {
    title: "Mutasi Furniture WIP",
    name: "Nama",
    core: ["Awal", "Masuk", "Keluar", "Akhir"],
    unit: "Pcs",
    columns: [
      "Nama", "Awal", "Masuk", "Keluar", "Akhir", "OutputInjc", "OutHStamp",
      "OutputPKunci", "OutputSpan", "InputBJSort", "InputHStamp", "InputPack",
      "InputPKunci", "InputSpaner", "InputBSU", "OutputRetur", "OutputBSU",
      "InputInjct", "Jual",
    ],
  },
  "barang-jadi": {
    title: "Mutasi Barang Jadi",
    name: "NamaBJ",
    core: ["Awal", "Masuk", "Keluar", "Akhir"],
    unit: "Kg",
    columns: [
      "NamaBJ", "Awal", "Masuk", "Keluar", "Akhir", "PackOutput",
      "InjectOutput", "BSUOutput", "BSUInput", "BJJual", "BSortInput",
      "ReturOutput",
    ],
  },
  reject: {
    title: "Mutasi Reject",
    name: "NamaReject",
    core: ["BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
    unit: "Kg",
    columns: [
      "NamaReject", "BeratAwal", "BeratMasuk", "BeratKeluar", "BJSortOutput",
      "InjctOutput", "HStampOutput", "PKncOutput", "BrokerInput", "GiliInput",
      "BeratAkhir",
    ],
  },
};

// Label kolom yang ramah dibaca (dipakai untuk header tabel).
const COLUMN_LABELS = {
  Jenis: "Jenis",
  Nama: "Nama",
  NamaBJ: "Nama Barang Jadi",
  NamaBonggolan: "Nama Bonggolan",
  NamaCrusher: "Nama Crusher",
  NamaGilingan: "Nama Gilingan",
  NamaReject: "Nama Reject",

  Awal: "Berat Awal",
  BeratAwal: "Berat Awal",
  Masuk: "Berat Masuk",
  BeratMasuk: "Berat Masuk",
  MasukProd: "Masuk Produksi",
  Keluar: "Berat Keluar",
  BeratKeluar: "Berat Keluar",
  Akhir: "Berat Akhir",
  BeratAkhir: "Berat Akhir",

  // washing
  BeratADJKeluar: "Keluar ADJ",
  BeratBSUKeluar: "Keluar BSU",
  BeratBROKKeluar: "Keluar Broker",
  BeratWASHKeluar: "Keluar Washing",
  BeratADJMasuk: "Masuk ADJ",
  BeratBSUMasuk: "Masuk BSU",
  BeratProdMasuk: "Masuk Produksi",

  // bonggolan
  BeratCRUSKeluar: "Keluar Crusher",
  BeratGILKeluar: "Keluar Gilingan",
  BeratBROKMasuk: "Masuk Broker",
  BeratINJCMasuk: "Masuk Inject",
  KeluarNot: "Keluar Lain-lain",
  MasukNot: "Masuk Lain-lain",

  // broker
  OutputBSU: "Output BSU",
  OutputBroker: "Output Broker",
  InputBSU: "Input BSU",
  InputBroker: "Input Broker",
  InputInject: "Input Inject",
  InputMixer: "Input Mixer",

  // crusher
  BeratBSUInput: "Input BSU",
  BeratBROKInput: "Input Broker",
  BeratGILInput: "Input Gilingan",
  BeratProdOutput: "Output Produksi",
  BeratBSUOutput: "Output BSU",

  // gilingan
  BrokInput: "Input Broker",
  InjectInput: "Input Inject",
  MixInput: "Input Mixer",
  WashInput: "Input Washing",

  // mixer
  MixProdOutput: "Output Produksi",
  MixInjectOutput: "Output Inject",
  MixBSUOutput: "Output BSU",

  // barang jadi
  PackOutput: "Output Packing",
  InjectOutput: "Output Inject",
  BSUOutput: "Output BSU",
  BJJual: "Penjualan BJ",
  BSortInput: "Input Sortir",
  ReturOutput: "Output Retur",

  // furniture wip
  OutputInjc: "Output Inject",
  OutHStamp: "Output Hot Stamping",
  OutputPKunci: "Output Pasang Kunci",
  OutputSpan: "Output Spanner",
  InputBJSort: "Input Sortir BJ",
  InputHStamp: "Input Hot Stamping",
  InputPack: "Input Packing",
  InputPKunci: "Input Pasang Kunci",
  InputSpaner: "Input Spanner",
  OutputRetur: "Output Retur",
  InputInjct: "Input Inject",
  Jual: "Penjualan",

  // reject
  BJSortOutput: "Output Sortir BJ",
  InjctOutput: "Output Inject",
  HStampOutput: "Output Hot Stamping",
  PKncOutput: "Output Pasang Kunci",
  BrokerInput: "Input Broker",
  GiliInput: "Input Gilingan",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateId(value) {
  if (!value) return "-";
  const raw = String(value).slice(0, 10);
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function getColumnLabel(key) {
  return COLUMN_LABELS[key] || key;
}

function getConfig(jenis) {
  return (
    MUTASI_JENIS[jenis] || {
      title: `Mutasi ${jenis}`,
      name: null,
      core: [],
      unit: "Kg",
    }
  );
}

/**
 * Pisahkan kolom hasil SP menjadi:
 * - nameKey : kolom nama item
 * - coreKeys: kolom nilai utama (Awal/Masuk/Keluar/Akhir)
 * - detailKeys: kolom rincian asal-usul mutasi
 */
function splitColumns(jenis, keys) {
  const cfg = getConfig(jenis);
  // Hasil SP tanpa baris data tidak punya metadata kolom (mssql v11 tidak
  // mengekspos column metadata), jadi pakai daftar kolom dari config.
  const effectiveKeys = keys && keys.length ? keys : cfg.columns || [];
  const nameKey = cfg.name && effectiveKeys.includes(cfg.name) ? cfg.name : effectiveKeys[0];
  const coreKeys = cfg.core.filter((k) => effectiveKeys.includes(k));
  const detailKeys = effectiveKeys.filter(
    (k) => k !== nameKey && !coreKeys.includes(k),
  );
  return { cfg, nameKey, coreKeys, detailKeys };
}

function sumBy(rows, key) {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}

function buildTable({ nameLabel, columns, rows, nameKey, unit, className }) {
  const head = columns
    .map((key) => {
      const label =
        key === nameKey ? nameLabel : `${getColumnLabel(key)} (${unit})`;
      return `<th class="${key === nameKey ? "left" : "right"}">${escapeHtml(label)}</th>`;
    })
    .join("");

  const body = rows
    .map(
      (r) => `<tr>
        <td class="left name">${escapeHtml(r[nameKey] ?? "-")}</td>
        ${columns
          .filter((k) => k !== nameKey)
          .map((k) => `<td class="right">${formatNumber(r[k])}</td>`)
          .join("")}
      </tr>`,
    )
    .join("");

  const totalRow = `<tr class="total">
      <td class="left">TOTAL</td>
      ${columns
        .filter((k) => k !== nameKey)
        .map((k) => `<td class="right">${formatNumber(sumBy(rows, k))}</td>`)
        .join("")}
    </tr>`;

  return `<table class="data ${className}">
      <thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length}" class="empty">Tidak ada data.</td></tr>`}</tbody>
      ${rows.length ? `<tfoot>${totalRow}</tfoot>` : ""}
    </table>`;
}

function buildMutasiHtml({ jenis, tglAwal, tglAkhir, keys, rows }) {
  const { cfg, nameKey, coreKeys, detailKeys } = splitColumns(jenis, keys);
  const data = Array.isArray(rows) ? rows : [];

  const totalAwal = coreKeys[0] ? sumBy(data, coreKeys[0]) : 0;
  const totalMasuk = coreKeys[1] ? sumBy(data, coreKeys[1]) : 0;
  const totalKeluar = coreKeys[2] ? sumBy(data, coreKeys[2]) : 0;
  const totalAkhir = coreKeys[3] ? sumBy(data, coreKeys[3]) : 0;

  const coreTable = coreKeys.length
    ? buildTable({
        nameLabel: getColumnLabel(nameKey),
        columns: [nameKey, ...coreKeys],
        rows: data,
        nameKey,
        unit: cfg.unit,
        className: "core",
      })
    : "";

  const detailTable = detailKeys.length
    ? buildTable({
        nameLabel: getColumnLabel(nameKey),
        columns: [nameKey, ...detailKeys],
        rows: data,
        nameKey,
        unit: cfg.unit,
        className: "detail",
      })
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; color: #1e293b; }
  .report-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 2px solid #1e40af; padding-bottom: 8px; margin-bottom: 12px;
  }
  .report-title { font-size: 15px; font-weight: 700; color: #1e40af; }
  .report-subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
  .report-meta { text-align: right; font-size: 9px; color: #475569; }
  .summary-strip { display: flex; gap: 8px; margin-bottom: 12px; }
  .summary-card { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; }
  .summary-label { font-size: 8px; color: #64748b; text-transform: uppercase; }
  .summary-value { font-size: 13px; font-weight: 700; color: #1e40af; }
  .section-title {
    font-size: 9px; font-weight: 700; color: #1e3a8a; text-transform: uppercase;
    letter-spacing: 0.4px; margin: 12px 0 5px;
  }
  table.data { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.data th {
    background: #1e40af; color: #fff; font-size: 8px; text-transform: uppercase;
    letter-spacing: 0.2px; padding: 5px 4px; border: 1px solid #1e3a8a;
  }
  table.data td { padding: 4px 5px; border: 1px solid #e2e8f0; }
  table.data tr { page-break-inside: avoid; }
  table.data tbody tr:nth-child(even) td { background: #f8fafc; }
  table.detail { font-size: 7.5px; }
  table.detail th { font-size: 7px; padding: 4px 3px; }
  table.detail td { padding: 3px 4px; }
  tfoot td {
    background: #1e40af !important; color: #fff; font-weight: 700; border: none;
  }
  td.name { word-break: break-word; }
  .left { text-align: left; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { text-align: center; padding: 18px 0; color: #94a3b8; }
</style>
</head>
<body>
  <div class="report-header">
    <div>
      <div class="report-title">Laporan ${escapeHtml(cfg.title)}</div>
      <div class="report-subtitle">
        Periode: ${escapeHtml(formatDateId(tglAwal))} s.d. ${escapeHtml(formatDateId(tglAkhir))}
        &middot; Satuan: ${escapeHtml(cfg.unit)}
      </div>
    </div>
    <div class="report-meta">Jumlah baris: ${data.length}</div>
  </div>

  <div class="summary-strip">
    <div class="summary-card">
      <div class="summary-label">${escapeHtml(coreKeys[0] ? getColumnLabel(coreKeys[0]) : "Awal")} (${escapeHtml(cfg.unit)})</div>
      <div class="summary-value">${formatNumber(totalAwal)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">${escapeHtml(coreKeys[1] ? getColumnLabel(coreKeys[1]) : "Masuk")} (${escapeHtml(cfg.unit)})</div>
      <div class="summary-value">${formatNumber(totalMasuk)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">${escapeHtml(coreKeys[2] ? getColumnLabel(coreKeys[2]) : "Keluar")} (${escapeHtml(cfg.unit)})</div>
      <div class="summary-value">${formatNumber(totalKeluar)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">${escapeHtml(coreKeys[3] ? getColumnLabel(coreKeys[3]) : "Akhir")} (${escapeHtml(cfg.unit)})</div>
      <div class="summary-value">${formatNumber(totalAkhir)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Jumlah Item</div>
      <div class="summary-value">${data.length}</div>
    </div>
  </div>

  ${coreTable ? `<div class="section-title">Rekap Saldo</div>${coreTable}` : ""}
  ${detailTable ? `<div class="section-title">Rincian Mutasi</div>${detailTable}` : ""}
</body>
</html>`;
}

async function renderMutasiPdf({ html, username }) {
  const who = String(username ?? "-").trim() || "-";
  const printedAt = new Date().toLocaleString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  await acquirePageSlot();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 900 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    return Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `
          <div style="width:100%; font-size:8px; color:#94a3b8; font-family:'Segoe UI',Arial,sans-serif; display:flex; justify-content:space-between; padding:0 8mm;">
            <span>Print by ${escapeHtml(who)} on ${escapeHtml(printedAt)}</span>
            <span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
          </div>`,
        margin: { top: "8mm", right: "8mm", bottom: "14mm", left: "8mm" },
      }),
    );
  } finally {
    await page.close();
    releasePageSlot();
  }
}

module.exports = {
  buildMutasiHtml,
  renderMutasiPdf,
  getConfig,
  splitColumns,
  MUTASI_JENIS,
  COLUMN_LABELS,
};
