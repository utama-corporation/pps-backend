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

  return `
-- ============================================
-- ${type.toUpperCase()} (UPSERT)
-- ============================================
DECLARE @${type}Inserted int = 0;
DECLARE @${type}Updated int = 0;
DECLARE @${type}Invalid int = 0;

-- Temp table untuk aggregated data (SUM by key)
DECLARE @${type}Src TABLE(${keyColumn} int, ${quantityColumn} int);

INSERT INTO @${type}Src(${keyColumn}, ${quantityColumn})
SELECT ${keyColumn}, SUM(ISNULL(${quantityColumn}, 0)) AS ${quantityColumn}
FROM OPENJSON(@jsInputs, '$.${type}')
WITH (
  ${keyColumn} int '${jsonPath(keyColumn)}',
  ${quantityColumn} int '${jsonPath(quantityColumn)}'
)
WHERE ${keyColumn} IS NOT NULL
GROUP BY ${keyColumn};

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
SET tgt.${quantityColumn} = src.${quantityColumn}
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
INSERT INTO dbo.${mappingTable}(${produksiConfig.codeColumn}, ${keyColumn}, ${quantityColumn})
SELECT @no, src.${keyColumn}, src.${quantityColumn}
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
