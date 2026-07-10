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

function buildRowsHtml(rows) {
  return rows
    .map((row) => {
      const hasInput = Number(row.JmlInput || 0) > 0;
      const hasOutput = Number(row.JmlOutput || 0) > 0;

      const inputName = hasInput
        ? escapeHtml(row.JenisInput || row.Nama)
        : '<span class="empty-value">-</span>';

      const outputName = hasOutput
        ? escapeHtml(row.JenisOutput || row.Nama)
        : '<span class="empty-value">-</span>';

      const inputQty = hasInput ? formatNumber(row.NilaiInput, nilaiDigits(row)) : "";
      const outputQty = hasOutput ? formatNumber(row.NilaiOutput, nilaiDigits(row)) : "";

      return `
        <tr>
          <td class="center">${escapeHtml(formatDate(row.Tanggal))}</td>
          <td class="input-cell">${inputName}</td>
          <td class="right input-cell">${inputQty}</td>
          <td class="center input-cell">${escapeHtml(row.Satuan || "")}</td>
          <td class="output-cell">${outputName}</td>
          <td class="right output-cell">${outputQty}</td>
          <td class="center output-cell">${escapeHtml(row.Satuan || "")}</td>
        </tr>`;
    })
    .join("");
}

function buildKategoriTableHtml(rows) {
  return `
    <table>
      <thead>
        <tr>
          <th class="col-tgl center">TANGGAL</th>
          <th class="col-jenis">INPUT</th>
          <th class="col-qty right">QTY IN</th>
          <th class="col-sat center">SAT</th>
          <th class="col-jenis">OUTPUT</th>
          <th class="col-qty right">QTY OUT</th>
          <th class="col-sat center">SAT</th>
        </tr>
      </thead>
      <tbody>${buildRowsHtml(rows)}</tbody>
    </table>`;
}

function buildBongkarCard(noBongkarSusun, rows) {
  const tanggal = formatDate(getFirstFilled(rows, "Tanggal"));

  const totalInputKg = sumBy(rows, isKg, "NilaiInput");
  const totalOutputKg = sumBy(rows, isKg, "NilaiOutput");
  const totalInputPcs = sumBy(rows, isPcs, "NilaiInput");
  const totalOutputPcs = sumBy(rows, isPcs, "NilaiOutput");

  const kategoriRowsMap = groupBy(rows, (row) => row.Kategori || "TANPA KATEGORI");
  const kategoriHtml = Array.from(kategoriRowsMap.entries())
    .map(([kategori, kategoriRows]) => {
      const totalLabelIn = sumBy(kategoriRows, () => true, "JmlInput");
      const totalLabelOut = sumBy(kategoriRows, () => true, "JmlOutput");
      const totalSakIn = sumBy(kategoriRows, () => true, "JumlahSakInput");
      const totalSakOut = sumBy(kategoriRows, () => true, "JumlahSakOutput");
      return `
        <div class="kategori-title">${escapeHtml(kategori || "TANPA KATEGORI")}</div>
        ${buildKategoriTableHtml(kategoriRows)}
        <div class="kategori-sum">
          Label IN: ${formatNumber(totalLabelIn, 0)} | Label OUT: ${formatNumber(totalLabelOut, 0)}
          ${totalSakIn > 0 || totalSakOut > 0 ? `&nbsp;&nbsp;—&nbsp;&nbsp;Sak IN: ${formatNumber(totalSakIn, 0)} | Sak OUT: ${formatNumber(totalSakOut, 0)}` : ""}
        </div>`;
    })
    .join("");

  const showKg = totalInputKg > 0 || totalOutputKg > 0;
  const showPcs = totalInputPcs > 0 || totalOutputPcs > 0;

  return `
    <div class="bs-card">
      <div class="bs-head">
        <div>
          <div class="bs-no">No Bongkar Susun : ${escapeHtml(noBongkarSusun)}</div>
          <div class="bs-meta">Tanggal : ${escapeHtml(tanggal)}</div>
        </div>
        <div class="summary">
          ${showKg ? `<span class="kg">IN Kg: ${formatNumber(totalInputKg, 2)}</span>` : ""}
          ${showKg ? `<span class="kg">OUT Kg: ${formatNumber(totalOutputKg, 2)}</span>` : ""}
          ${showPcs ? `<span class="pcs">IN Pcs: ${formatNumber(totalInputPcs, 0)}</span>` : ""}
          ${showPcs ? `<span class="pcs">OUT Pcs: ${formatNumber(totalOutputPcs, 0)}</span>` : ""}
        </div>
      </div>
      ${kategoriHtml}
    </div>`;
}

function buildBongkarSusunReportHtml({ startDate, endDate, rows }) {
  const dataRows = Array.isArray(rows) ? rows : [];
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const content = dataRows.length === 0
    ? '<div class="no-data">Data laporan tidak ditemukan.</div>'
    : Array.from(groupBy(dataRows, (row) => row.NoBongkarSusun).entries())
        .map(([noBongkarSusun, bongkarRows]) => buildBongkarCard(noBongkarSusun, bongkarRows))
        .join("");

  return templateHtml
    .replace("{{periode}}", `${formatDate(startDate)} s/d ${formatDate(endDate)}`)
    .replace("{{content}}", content);
}

module.exports = { buildBongkarSusunReportHtml };
