const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "bongkar-susun-report-pdf.html");

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

function sumBy(rows, predicate, fieldName) {
  return rows.reduce((total, row) => {
    if (!predicate(row)) return total;
    const value = Number(row[fieldName] || 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function isPcs(row) {
  return String(row.Satuan || "").toLowerCase() === "pcs";
}

function isKg(row) {
  return String(row.Satuan || "").toLowerCase() === "kg";
}

function nilaiDigits(row) {
  return isPcs(row) ? 0 : 2;
}

function buildJenisInputGroup(jenisInput, rows) {
  const totalQty = sumBy(rows, () => true, "NilaiInput");
  const digits = rows.length > 0 ? nilaiDigits(rows[0]) : 2;
  const rowspan = rows.length;
  const escapedInput = escapeHtml(jenisInput || "-");

  const detailRows = rows
    .map((row, idx) => {
      const hasOutput = Number(row.JmlOutput || 0) > 0;
      const outputName = hasOutput
        ? escapeHtml(row.JenisOutput || row.Nama)
        : '<span class="empty-value">-</span>';
      const outputQty = hasOutput ? formatNumber(row.NilaiOutput, nilaiDigits(row)) : "";
      const inputQty = formatNumber(row.NilaiInput, nilaiDigits(row));
      const satuan = escapeHtml(row.Satuan || "");

      const inputCell = idx === 0
        ? `<td class="input-cell" rowspan="${rowspan}">${escapedInput}<div class="jenisinput-total">Total: ${formatNumber(totalQty, digits)}</div></td>`
        : "";

      return `
        <tr>
          ${inputCell}
          <td class="center">${escapeHtml(formatDate(row.Tanggal))}</td>
          <td class="right input-cell">${inputQty}</td>
          <td class="center">${satuan}</td>
          <td class="output-cell">${outputName}</td>
          <td class="right output-cell">${outputQty}</td>
          <td class="center">${satuan}</td>
        </tr>`;
    })
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th class="col-jenis">JENIS INPUT</th>
          <th class="col-tgl center">TANGGAL</th>
          <th class="col-qty right">QTY/BERAT IN</th>
          <th class="col-sat center">SAT</th>
          <th class="col-jenis">JENIS OUTPUT</th>
          <th class="col-qty right">QTY/BERAT</th>
          <th class="col-sat center">SAT</th>
        </tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>`;
}

function buildKategoriSection(kategori, rows) {
  const totalInputKg = sumBy(rows, isKg, "NilaiInput");
  const totalOutputKg = sumBy(rows, isKg, "NilaiOutput");
  const totalInputPcs = sumBy(rows, isPcs, "NilaiInput");
  const totalOutputPcs = sumBy(rows, isPcs, "NilaiOutput");
  const totalLabelIn = sumBy(rows, () => true, "JmlInput");
  const totalLabelOut = sumBy(rows, () => true, "JmlOutput");
  const totalSakIn = sumBy(rows, () => true, "JumlahSakInput");
  const totalSakOut = sumBy(rows, () => true, "JumlahSakOutput");

  const showKg = totalInputKg > 0 || totalOutputKg > 0;
  const showPcs = totalInputPcs > 0 || totalOutputPcs > 0;

  const jenisInputGroups = Array.from(groupBy(rows, (row) => row.JenisInput || "TANPA JENIS INPUT").entries())
    .map(([jenisInput, jenisRows]) => buildJenisInputGroup(jenisInput, jenisRows))
    .join("");

  return `
    <div class="bs-card">
      <div class="kategori-header">
        <span class="kategori-title-label">${escapeHtml(kategori || "TANPA KATEGORI")}</span>
        <div class="summary">
          ${showKg ? `<span class="kg">IN Kg: ${formatNumber(totalInputKg, 2)}</span>` : ""}
          ${showKg ? `<span class="kg">OUT Kg: ${formatNumber(totalOutputKg, 2)}</span>` : ""}
          ${showPcs ? `<span class="pcs">IN Pcs: ${formatNumber(totalInputPcs, 0)}</span>` : ""}
          ${showPcs ? `<span class="pcs">OUT Pcs: ${formatNumber(totalOutputPcs, 0)}</span>` : ""}
        </div>
      </div>
      ${jenisInputGroups}
      <div class="kategori-sum">
        Label IN: ${formatNumber(totalLabelIn, 0)} | Label OUT: ${formatNumber(totalLabelOut, 0)}
        ${totalSakIn > 0 || totalSakOut > 0 ? `&nbsp;&nbsp;—&nbsp;&nbsp;Sak IN: ${formatNumber(totalSakIn, 0)} | Sak OUT: ${formatNumber(totalSakOut, 0)}` : ""}
      </div>
    </div>`;
}

function buildBongkarSusunReportHtml({ startDate, endDate, rows }) {
  const dataRows = Array.isArray(rows) ? rows : [];
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const content = dataRows.length === 0
    ? '<div class="no-data">Data laporan tidak ditemukan.</div>'
    : Array.from(groupBy(dataRows, (row) => row.Kategori || "TANPA KATEGORI").entries())
        .map(([kategori, kategoriRows]) => buildKategoriSection(kategori, kategoriRows))
        .join("");

  return templateHtml
    .replace("{{periode}}", `${formatDate(startDate)} s/d ${formatDate(endDate)}`)
    .replace("{{content}}", content);
}

module.exports = { buildBongkarSusunReportHtml };
