const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "sortir-reject-report-pdf.html");

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
  const raw = String(value).slice(0, 10);
  const parts = raw.split("-");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return raw;
}

function formatNumber(value, fractionDigits = 2) {
  if (value === null || value === undefined || value === "") return "";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "";

  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numberValue);
}

function groupBy(rows, keySelector) {
  return rows.reduce((map, row) => {
    const key = keySelector(row) || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
    return map;
  }, new Map());
}

function getFirstFilled(rows, fieldName) {
  const row = rows.find((x) => x[fieldName] !== null && x[fieldName] !== undefined && x[fieldName] !== "");
  return row ? row[fieldName] : "";
}

function buildSrKategoriRowsHtml(rows) {
  return rows
    .map((row) => {
      const hasOutput = String(row.JenisOutput || "").trim() !== "";
      const outputName = hasOutput ? escapeHtml(row.JenisOutput) : '<span class="empty-value">-</span>';
      const outputQty = hasOutput ? formatNumber(row.JumlahOutput, 2) : "";
      const inputName = escapeHtml(row.JenisInput || "-");
      const inputQty = formatNumber(row.JlhInput, 0);

      return `
        <tr>
          <td class="center">${escapeHtml(formatDate(row.Tanggal))}</td>
          <td class="input-cell">${inputName}</td>
          <td class="right input-cell">${inputQty}</td>
          <td class="center">Pcs</td>
          <td class="output-cell">${outputName}</td>
          <td class="right output-cell">${outputQty}</td>
          <td class="center">Kg</td>
        </tr>`;
    })
    .join("");
}

function buildSrKategoriSection(groupInput, rows) {
  const totalInput = rows.reduce((s, r) => s + (Number(r.JlhInput) || 0), 0);
  const totalOutput = rows.reduce((s, r) => s + (Number(r.JumlahOutput) || 0), 0);

  return `
    <div class="bs-card">
      <div class="kategori-header">
        <span class="kategori-title-label">${escapeHtml(groupInput || "TANPA GROUP")}</span>
        <div class="summary">
          <span>IN Pcs: ${formatNumber(totalInput, 0)}</span>
          <span class="total-output">OUT Kg: ${formatNumber(totalOutput, 2)}</span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="col-tgl center">TANGGAL</th>
            <th class="col-jenis">JENIS INPUT</th>
            <th class="col-qty right">QTY/BERAT IN</th>
            <th class="col-sat center">SATUAN</th>
            <th class="col-jenis">JENIS OUTPUT</th>
            <th class="col-qty right">QTY/BERAT</th>
            <th class="col-sat center">SATUAN</th>
          </tr>
        </thead>
        <tbody>${buildSrKategoriRowsHtml(rows)}</tbody>
      </table>
    </div>`;
}

function buildSortirRejectReportHtml({ startDate, endDate, rows }) {
  const dataRows = Array.isArray(rows) ? rows : [];
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const sortPriority = { BJADI: 0, WIP: 1 };

  const content = dataRows.length === 0
    ? '<div class="no-data">Data laporan tidak ditemukan.</div>'
    : Array.from(groupBy(dataRows, (row) => row.GroupInput || "TANPA GROUP").entries())
        .sort(([a], [b]) => {
          const pa = sortPriority[a] ?? 2;
          const pb = sortPriority[b] ?? 2;
          if (pa !== pb) return pa - pb;
          return a.localeCompare(b);
        })
        .map(([groupName, groupRows]) => buildSrKategoriSection(groupName, groupRows))
        .join("");

  return templateHtml
    .replace("{{periode}}", `${formatDate(startDate)} s/d ${formatDate(endDate)}`)
    .replace("{{content}}", content);
}

module.exports = { buildSortirRejectReportHtml };
