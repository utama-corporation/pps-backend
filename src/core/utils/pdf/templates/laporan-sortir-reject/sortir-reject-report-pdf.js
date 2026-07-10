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

function buildRowsHtml(rows) {
  return rows
    .map((row) => {
      const hasOutput = String(row.JenisOutput || "").trim() !== "";
      const outputName = hasOutput ? escapeHtml(row.JenisOutput) : '<span class="empty-output">-</span>';
      const outputQty = hasOutput ? formatNumber(row.JumlahOutput, 2) : "";

      return `
        <tr>
          <td class="input-cell">${escapeHtml(row.ProsesAsal || "-")}</td>
          <td class="center">${escapeHtml(formatDate(row.Tanggal))}</td>
          <td class="input-cell">${escapeHtml(row.JenisInput || "-")}</td>
          <td class="right input-cell">${formatNumber(row.JlhInput, 0)}</td>
          <td class="output-cell">${outputName}</td>
          <td class="right output-cell">${outputQty}</td>
        </tr>`;
    })
    .join("");
}

function buildGroupTableHtml(groupRows) {
  return `
    <table>
      <thead>
        <tr>
          <th class="col-asal">PROSES / ASAL</th>
          <th class="col-tgl center">TANGGAL</th>
          <th class="col-input">INPUT</th>
          <th class="col-jlh right">INPUT (Pcs)</th>
          <th class="col-output">OUTPUT</th>
          <th class="col-jumlah right">OUTPUT (Kg)</th>
        </tr>
      </thead>
      <tbody>${buildRowsHtml(groupRows)}</tbody>
    </table>`;
}

function buildSortirCard(noBJSortir, rows, totals) {
  const t = totals || {};
  const tanggal = formatDate(getFirstFilled(rows, "Tanggal"));
  const totalInput = formatNumber(t.TotalInput, 0);
  const totalOutput = formatNumber(t.TotalOutput, 2);
  const jenisOutput = escapeHtml(t.JenisOutput || "-");

  return `
    <div class="sortir-card">
      <div class="sortir-head">
        <div>
          <div class="sortir-no">No Sortir : ${escapeHtml(noBJSortir)}</div>
          <div class="sortir-meta">Tanggal : ${escapeHtml(tanggal)}</div>
        </div>
        <div class="summary">
          <div class="summary-output">${jenisOutput}</div>
          <span>Input: ${totalInput} Pcs</span>
          <span class="total-output">Output: ${totalOutput} Kg</span>
        </div>
      </div>
      ${buildGroupTableHtml(rows)}
    </div>`;
}

function buildSortirRejectReportHtml({ startDate, endDate, rows }) {
  const dataRows = Array.isArray(rows) ? rows : [];
  const templateHtml = fs.readFileSync(templatePath, "utf8");

  const sortPriority = { BJADI: 0, WIP: 1 };

  const totalsBySortir = new Map();
  for (const row of dataRows) {
    const key = row.NoBJSortir;
    if (!totalsBySortir.has(key)) {
      totalsBySortir.set(key, { TotalInput: 0, TotalOutput: 0, JenisOutput: row.JenisOutput });
    } else if (!totalsBySortir.get(key).JenisOutput && row.JenisOutput) {
      totalsBySortir.get(key).JenisOutput = row.JenisOutput;
    }
    const t = totalsBySortir.get(key);
    t.TotalInput += Number(row.JlhInput) || 0;
    t.TotalOutput += Number(row.JumlahOutput) || 0;
  }

  const content = dataRows.length === 0
    ? '<div class="no-data">Data laporan tidak ditemukan.</div>'
    : Array.from(groupBy(dataRows, (row) => row.GroupInput || "TANPA GROUP").entries())
        .sort(([a], [b]) => {
          const pa = sortPriority[a] ?? 2;
          const pb = sortPriority[b] ?? 2;
          if (pa !== pb) return pa - pb;
          return a.localeCompare(b);
        })
        .map(([groupName, groupRows]) => {
          const sortirCards = Array.from(groupBy(groupRows, (row) => row.NoBJSortir).entries())
            .map(([sortirNo, sortirRows]) => buildSortirCard(sortirNo, sortirRows, totalsBySortir.get(sortirNo)))
            .join("");
          return `
        <div class="group-section">
          <div class="group-title-main">GROUP INPUT : ${escapeHtml(groupName)}</div>
          ${sortirCards}
        </div>`;
        })
        .join("");

  return templateHtml
    .replace("{{periode}}", `${formatDate(startDate)} s/d ${formatDate(endDate)}`)
    .replace("{{content}}", content);
}

module.exports = { buildSortirRejectReportHtml };
