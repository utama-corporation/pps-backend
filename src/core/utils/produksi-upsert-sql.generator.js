// src/core/utils/sql-generator/produksi-upsert-sql.generator.js

/**
 * SQL Generator untuk UPSERT inputs (INSERT new + UPDATE existing)
 * Pattern ini digunakan untuk material yang bisa diakumulasi per key tanpa per-sak/batch
 * Contoh: Cabinet Material yang aggregate per IdCabinetMaterial
 */

const {
  UPSERT_INPUT_CONFIGS,
  PRODUKSI_CONFIGS,
} = require("../config/produksi-input-mapping.config");

/** convert "IdCabinetMaterial" -> "idCabinetMaterial" */
function toCamelField(dbKey) {
  if (!dbKey) return dbKey;
  return dbKey.charAt(0).toLowerCase() + dbKey.slice(1);
}

/** json path for OPENJSON: IdCabinetMaterial -> $.idCabinetMaterial */
function jsonPath(dbKey) {
  return `$.${toCamelField(dbKey)}`;
}

/**
 * Generate complete SQL untuk UPSERT inputs
 * @param {string} produksiType - e.g., 'injectProduksi'
 * @param {string[]} requestedTypes - e.g., ['cabinetMaterial']
 */
function generateUpsertInputsSQL(produksiType, requestedTypes) {
  const produksiConfig = PRODUKSI_CONFIGS[produksiType];
  const upsertConfigs = UPSERT_INPUT_CONFIGS[produksiType];

  if (!produksiConfig)
    throw new Error(`Unknown produksi type: ${produksiType}`);
  if (!upsertConfigs) return _generateEmptySQL();

  const activeConfigs = requestedTypes.reduce((acc, type) => {
    const config = upsertConfigs[type];
    if (config) acc[type] = config;
    return acc;
  }, {});

  if (Object.keys(activeConfigs).length === 0) return _generateEmptySQL();

  const sections = [];
  const summaryInserts = [];

  for (const [type, config] of Object.entries(activeConfigs)) {
    sections.push(_generateSingleUpsertSection(type, config, produksiConfig));
    summaryInserts.push(
      `  INSERT INTO @out SELECT '${type}', @${type}Inserted, @${type}Updated, 0, @${type}Invalid;`,
    );

    // MarkUsage: setelah UPSERT, tandai label (mis. Bahan Pendukung BP.) yang
    // dipakai agar tidak bisa dipanggil lagi pada penginputan berikutnya.
    if (config.markUsage) {
      sections.push(
        _generateMarkUsageSection(type, config, produksiConfig),
      );
      summaryInserts.push(
        `  INSERT INTO @out SELECT '${type}MarkUsage', 0, @${type}Marked, 0, 0;`,
      );
    }
  }

  return `
SET NOCOUNT ON;

DECLARE @out TABLE(Section sysname, Inserted int, Updated int, Skipped int, Invalid int);

${sections.join("\n\n")}

${summaryInserts.join("\n")}

SELECT Section, Inserted, Updated, Skipped, Invalid FROM @out ORDER BY Section;
`.trim();
}

/**
 * Generate SQL section untuk satu jenis UPSERT input
 */
function _generateSingleUpsertSection(type, config, produksiConfig) {
  const {
    mappingTable,
    sourceTable,
    keyColumn,
    quantityColumn,
    validateColumn,
    validateValue,
  } = config;

  const keyCamel = toCamelField(keyColumn);
  const qtyCamel = toCamelField(quantityColumn);

  // Kolom label Bahan Pendukung (BP.) per baris material. Hanya dibuat kalau
  // config punya markUsage (klien mengirim noBahanPendukung per entry).
  // Tujuan: NoBP tersimpan di baris mapping sehingga GET inputs bisa
  // mengembalikannya & UI menampilkan hasil inputan dengan labelnya.
  const hasLabels = !!config.markUsage;
  const labelField = config.markUsage?.labelJsonField || "noBahanPendukung";
  const labelColumn = "NoBahanPendukung";
  const srcLabelDecl = hasLabels ? `, ${labelColumn} nvarchar(max)` : "";
  const fillLabels = hasLabels
    ? `
-- Isi label Bahan Pendukung (BP.) yang termasuk material ini (agregat, dedup)
UPDATE s
SET s.${labelColumn} = lbl.Labels
FROM @${type}Src AS s
CROSS APPLY (
  SELECT STRING_AGG(t.Lbl, ',') WITHIN GROUP (ORDER BY t.Lbl) AS Labels
  FROM (
    SELECT DISTINCT l.value AS Lbl
    FROM OPENJSON(@jsInputs, '$.${type}')
    WITH (
      ${keyColumn} int '${jsonPath(keyColumn)}',
      ${quantityColumn} int '${jsonPath(quantityColumn)}',
      ${labelField} nvarchar(max) '$.${labelField}' AS JSON
    ) inp
    CROSS APPLY OPENJSON(inp.${labelField}) AS l
    WHERE inp.${keyColumn} = s.${keyColumn}
      AND inp.${quantityColumn} > 0
  ) t
) lbl;
`
    : "";
  const updateSetLabels = hasLabels ? `, tgt.${labelColumn} = src.${labelColumn}` : "";
  const insertCols = hasLabels ? `, ${labelColumn}` : "";
  const insertVals = hasLabels ? `, src.${labelColumn}` : "";

  return `
-- ============================================
-- ${type.toUpperCase()} (UPSERT)
-- ============================================
DECLARE @${type}Inserted int = 0;
DECLARE @${type}Updated int = 0;
DECLARE @${type}Invalid int = 0;

-- Temp table untuk aggregated data (SUM by key)
DECLARE @${type}Src TABLE(${keyColumn} int, ${quantityColumn} int${srcLabelDecl});

INSERT INTO @${type}Src(${keyColumn}, ${quantityColumn})
SELECT ${keyColumn}, SUM(ISNULL(${quantityColumn}, 0)) AS ${quantityColumn}
FROM OPENJSON(@jsInputs, '$.${type}')
WITH (
  ${keyColumn} int '${jsonPath(keyColumn)}',
  ${quantityColumn} int '${jsonPath(quantityColumn)}'
)
WHERE ${keyColumn} IS NOT NULL
GROUP BY ${keyColumn};

${fillLabels}
-- Count invalid: quantity <= 0 OR material not exists/disabled
SELECT @${type}Invalid = COUNT(*)
FROM @${type}Src s
WHERE s.${quantityColumn} <= 0
   OR NOT EXISTS (
     SELECT 1 FROM dbo.${sourceTable} m WITH (NOLOCK)
     WHERE m.${keyColumn} = s.${keyColumn}
       AND m.${validateColumn} = ${validateValue}
   );

-- UPDATE existing records
UPDATE tgt
SET tgt.${quantityColumn} = src.${quantityColumn}${updateSetLabels}
FROM dbo.${mappingTable} tgt
INNER JOIN @${type}Src src ON src.${keyColumn} = tgt.${keyColumn}
WHERE tgt.${produksiConfig.codeColumn} = @no
  AND src.${quantityColumn} > 0
  AND EXISTS (
    SELECT 1 FROM dbo.${sourceTable} m WITH (NOLOCK)
    WHERE m.${keyColumn} = src.${keyColumn}
      AND m.${validateColumn} = ${validateValue}
  );

SET @${type}Updated = @@ROWCOUNT;

-- INSERT new records
INSERT INTO dbo.${mappingTable}(${produksiConfig.codeColumn}, ${keyColumn}, ${quantityColumn}${insertCols})
SELECT @no, src.${keyColumn}, src.${quantityColumn}${insertVals}
FROM @${type}Src src
WHERE src.${quantityColumn} > 0
  AND EXISTS (
    SELECT 1 FROM dbo.${sourceTable} m WITH (NOLOCK)
    WHERE m.${keyColumn} = src.${keyColumn}
      AND m.${validateColumn} = ${validateValue}
  )
  AND NOT EXISTS (
    SELECT 1 FROM dbo.${mappingTable} x WITH (NOLOCK)
    WHERE x.${produksiConfig.codeColumn} = @no
      AND x.${keyColumn} = src.${keyColumn}
  );

SET @${type}Inserted = @@ROWCOUNT;
`.trim();
}

function _generateMarkUsageSection(type, config, produksiConfig) {
  const partialJsonField = config.markUsage?.partialJsonField;
  const hasPartial =
    partialJsonField &&
    typeof partialJsonField === "string" &&
    partialJsonField.length > 0;

  if (hasPartial) {
    return _generatePartialMarkUsageSection(
      type,
      config,
      produksiConfig,
      partialJsonField,
    );
  }
  return _generateLegacyMarkUsageSection(type, config, produksiConfig);
}

/**
 * Mark usage klasik: tandai seluruh label (misi. Bahan Pendukung BP.) yang
 * dikirim di `labelJsonField` sekaligus (DateUsage = TglProduksi). Dipakai
 * modul yang belum mendukung konsumsi parsial per label.
 */
function _generateLegacyMarkUsageSection(type, config, produksiConfig) {
  const { table, labelColumn, labelJsonField } = config.markUsage;
  const { mappingTable, sourceTable, keyColumn, quantityColumn, validateColumn, validateValue } = config;
  const tempName = `#${type}MarkUsageIds`;

  return `
-- ============================================
-- ${type.toUpperCase()} MARK USAGE (${table})
-- ============================================
DECLARE @${type}Marked int = 0;

-- Tandai label (mis. Bahan Pendukung BP.) yang dipakai pada submit ini:
-- DateUsage diset ke tanggal produksi sehingga validate-label tidak lagi
-- mengembalikan label yang sama pada penginputan berikutnya.
-- Hanya entry valid (quantity > 0 & material aktif) yang menandai labelnya.
-- CATATAN: OPENJSON tidak boleh jadi row source di UPDATE ... FROM (syntax
-- error), jadi label dikumpulkan dulu ke temp table lalu di-update.
IF OBJECT_ID(N'tempdb..${tempName}') IS NOT NULL DROP TABLE ${tempName};

CREATE TABLE ${tempName} (${labelColumn} nvarchar(50));

INSERT INTO ${tempName} (${labelColumn})
SELECT lbl.value
FROM OPENJSON(@jsInputs, '$.${type}')
WITH (
  ${keyColumn} int '${jsonPath(keyColumn)}',
  ${quantityColumn} int '${jsonPath(quantityColumn)}',
  ${labelJsonField} nvarchar(max) '$.${labelJsonField}' AS JSON
) inp
CROSS APPLY OPENJSON(inp.${labelJsonField}) lbl
WHERE inp.${quantityColumn} > 0
  AND EXISTS (
    SELECT 1 FROM dbo.${sourceTable} m WITH (NOLOCK)
    WHERE m.${keyColumn} = inp.${keyColumn}
      AND m.${validateColumn} = ${validateValue}
  );

DECLARE @${type}TglProduksi datetime;
SELECT @${type}TglProduksi = ${produksiConfig.dateColumn}
FROM dbo.${produksiConfig.headerTable} WITH (NOLOCK)
WHERE ${produksiConfig.codeColumn} = @no;

UPDATE b
SET b.DateUsage = @${type}TglProduksi
FROM dbo.${table} b
INNER JOIN ${tempName} u ON u.${labelColumn} = b.${labelColumn}
WHERE b.DateUsage IS NULL;

SET @${type}Marked = @@ROWCOUNT;

DROP TABLE ${tempName};
`.trim();
}

/**
 * Mark usage dengan dukungan konsumsi PARSIAL per label (dipakai modul
 * inject untuk Bahan Pendukung). Klien mengirim rincian `partialJsonField`
 * (array { no, qty } per entry). Perilaku:
 *  - qty < sisa Qty label → Qty label DIKURANGI, DateUsage tetap NULL
 *    (sisa tetap bisa dipakai produksi lain).
 *  - qty >= sisa Qty label → label ditandai penuh (DateUsage), Qty dibiarkan
 *    (kompatibel dengan release label pada delete).
 *  - Label yang dikirim lewat `labelJsonField` (noBahanPendukung) TANPA
 *    rincian parsial → ditandai penuh (fallback untuk klien lama / entry
 *    tanpa rincian).
 */
function _generatePartialMarkUsageSection(
  type,
  config,
  produksiConfig,
  partialJsonField,
) {
  const { table, labelColumn, labelJsonField } = config.markUsage;
  const { sourceTable, keyColumn, quantityColumn, validateColumn, validateValue } = config;
  const tempName = `#${type}MarkUsageIds`;

  // Rincian konsumsi per label dari klien
  const aggSQL = `
  SELECT
    LTRIM(RTRIM(p.no)) AS Lbl,
    SUM(ISNULL(p.qty, 0)) AS ConQty
  FROM OPENJSON(@jsInputs, '$.${type}')
  WITH (
    ${keyColumn} int '${jsonPath(keyColumn)}',
    ${partialJsonField} nvarchar(max) '$.${partialJsonField}' AS JSON
  ) e
  CROSS APPLY OPENJSON(e.${partialJsonField})
    WITH (no nvarchar(50) '$.no', qty decimal(18,4) '$.qty') p
  WHERE e.${keyColumn} IS NOT NULL
    AND p.qty > 0
    AND LTRIM(RTRIM(p.no)) <> ''
  GROUP BY LTRIM(RTRIM(p.no))`;

  return `
-- ============================================
-- ${type.toUpperCase()} MARK USAGE PARSIAL (${table})
-- ============================================
DECLARE @${type}Marked int = 0;

DECLARE @${type}TglProduksi datetime;
SELECT @${type}TglProduksi = ${produksiConfig.dateColumn}
FROM dbo.${produksiConfig.headerTable} WITH (NOLOCK)
WHERE ${produksiConfig.codeColumn} = @no;

-- Rincian konsumsi per label (dari klien: partialJsonField)
DECLARE @${type}Agg TABLE (Lbl varchar(50), ConQty decimal(18,4));
INSERT INTO @${type}Agg (Lbl, ConQty)
${aggSQL};

-- Tentukan tindakan per label berdasarkan sisa Qty saat ini (pre-image)
DECLARE @${type}Action TABLE (
  Lbl varchar(50),
  ConQty decimal(18,4),
  FullMark bit
);
INSERT INTO @${type}Action (Lbl, ConQty, FullMark)
SELECT a.Lbl, a.ConQty, CASE WHEN a.ConQty < b.Qty THEN 0 ELSE 1 END
FROM @${type}Agg a
INNER JOIN dbo.${table} b WITH (NOLOCK)
  ON b.${labelColumn} = a.Lbl
WHERE b.DateUsage IS NULL AND b.Qty > 0;

-- [PARSIAL] qty < sisa → kurangi Qty label, DateUsage tetap NULL
UPDATE b
SET b.Qty = b.Qty - a.ConQty
FROM dbo.${table} b
INNER JOIN @${type}Action a ON a.Lbl = b.${labelColumn}
WHERE a.FullMark = 0 AND b.DateUsage IS NULL AND b.Qty > 0;

DECLARE @${type}PartialCount int = @@ROWCOUNT;

-- [PENUH via rincian] qty >= sisa → tandai DateUsage
UPDATE b
SET b.DateUsage = @${type}TglProduksi
FROM dbo.${table} b
INNER JOIN @${type}Action a ON a.Lbl = b.${labelColumn}
WHERE a.FullMark = 1 AND b.DateUsage IS NULL;

DECLARE @${type}FullCount int = @@ROWCOUNT;

-- [LEGACY/FALLBACK] label di labelJsonField TANPA rincian parsial →
-- ditandai penuh (klien lama / entry tanpa bpPartials)
IF OBJECT_ID(N'tempdb..${tempName}') IS NOT NULL DROP TABLE ${tempName};
CREATE TABLE ${tempName} (${labelColumn} nvarchar(50));

INSERT INTO ${tempName} (${labelColumn})
SELECT lbl.value
FROM OPENJSON(@jsInputs, '$.${type}')
WITH (
  ${keyColumn} int '${jsonPath(keyColumn)}',
  ${quantityColumn} int '${jsonPath(quantityColumn)}',
  ${labelJsonField} nvarchar(max) '$.${labelJsonField}' AS JSON
) inp
CROSS APPLY OPENJSON(inp.${labelJsonField}) lbl
WHERE inp.${quantityColumn} > 0
  AND EXISTS (
    SELECT 1 FROM dbo.${sourceTable} m WITH (NOLOCK)
    WHERE m.${keyColumn} = inp.${keyColumn}
      AND m.${validateColumn} = ${validateValue}
  )
  AND NOT EXISTS (
    SELECT 1 FROM @${type}Agg a
    WHERE a.Lbl = LTRIM(RTRIM(lbl.value))
  );

UPDATE b
SET b.DateUsage = @${type}TglProduksi
FROM dbo.${table} b
INNER JOIN ${tempName} u ON u.${labelColumn} = b.${labelColumn}
WHERE b.DateUsage IS NULL;

DECLARE @${type}LegacyCount int = @@ROWCOUNT;

SET @${type}Marked = @${type}PartialCount + @${type}FullCount + @${type}LegacyCount;

DROP TABLE ${tempName};
`.trim();
}

function _generateEmptySQL() {
  return `
SET NOCOUNT ON;
DECLARE @out TABLE(Section sysname, Inserted int, Updated int, Skipped int, Invalid int);
SELECT Section, Inserted, Updated, Skipped, Invalid FROM @out ORDER BY Section;
`.trim();
}

module.exports = {
  generateUpsertInputsSQL,
};
