// src/core/utils/sql-generator/produksi-upsert-delete-sql.generator.js

/**
 * SQL Generator untuk DELETE UPSERT inputs
 * Hapus baris mapping input + (jika config punya markUsage) lepaskan label
 * yang sempat ditandai (mis. Bahan Pendukung BP.) supaya bisa dipakai lagi.
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
 * Generate complete SQL untuk DELETE UPSERT inputs
 * @param {string} produksiType - e.g., 'injectProduksi'
 * @param {string[]} requestedTypes - e.g., ['cabinetMaterial']
 */
function generateUpsertInputsDeleteSQL(produksiType, requestedTypes) {
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

  const sections = Object.entries(activeConfigs)
    .map(([type, config]) =>
      _generateSingleDeleteSection(type, config, produksiConfig),
    )
    .join("\n\n");

  const summaryInserts = Object.keys(activeConfigs)
    .map(
      (type) =>
        `  INSERT INTO @out SELECT '${type}', @${type}Deleted, @${type}NotFound, ISNULL(@${type}LabelReleased, 0);`,
    )
    .join("\n");

  return `
SET NOCOUNT ON;

DECLARE @out TABLE(Section sysname, Deleted int, NotFound int, LabelReleased int);

${sections}

${summaryInserts}

SELECT Section, Deleted, NotFound, LabelReleased FROM @out ORDER BY Section;
`.trim();
}

/**
 * Generate SQL section untuk delete satu jenis UPSERT input
 */
function _generateSingleDeleteSection(type, config, produksiConfig) {
  const { mappingTable, keyColumn } = config;
  const keyCamel = toCamelField(keyColumn);
  const keysTable = `#${type}DelKeys`;

  const unmarkSection = config.markUsage
    ? _generateUnmarkUsageSection(type, config, produksiConfig, keysTable)
    : "";

  return `
-- ============================================
-- ${type.toUpperCase()} (DELETE + release labels)
-- ============================================
DECLARE @${type}Deleted int = 0;
DECLARE @${type}NotFound int = 0;
DECLARE @${type}LabelReleased int = 0;

-- Kumpulkan key yang benar-benar akan dihapus (cocok mapping @no)
IF OBJECT_ID(N'tempdb..${keysTable}') IS NOT NULL DROP TABLE ${keysTable};
CREATE TABLE ${keysTable} (${keyColumn} int PRIMARY KEY);

INSERT INTO ${keysTable} (${keyColumn})
SELECT DISTINCT map.${keyColumn}
FROM dbo.${mappingTable} map
INNER JOIN OPENJSON(@jsInputs, '$.${type}')
  WITH (${keyCamel} int '${jsonPath(keyColumn)}') j
  ON map.${keyColumn} = j.${keyCamel}
WHERE map.${produksiConfig.codeColumn} = @no;

SELECT @${type}Deleted = COUNT(*) FROM ${keysTable};

-- Delete records
DELETE map
FROM dbo.${mappingTable} map
INNER JOIN ${keysTable} k ON k.${keyColumn} = map.${keyColumn}
WHERE map.${produksiConfig.codeColumn} = @no;

-- Calculate not found
DECLARE @${type}Requested int;
SELECT @${type}Requested = COUNT(*) FROM OPENJSON(@jsInputs,'$.${type}');
SET @${type}NotFound = @${type}Requested - @${type}Deleted;

${unmarkSection}

DROP TABLE ${keysTable};
`.trim();
}

/**
 * Generate unmark-usage section: kembalikan DateUsage label (mis. Bahan
 * Pendukung BP.) ke NULL untuk material yang dihapus, supaya label bisa
 * dipanggil kembali.
 *
 * Hanya label yang DateUsage-nya SAMA dengan tanggal produksi ini yang
 * dilepas (label ditandai = tanggal produksi saat material di-submit),
 * untuk menghindari membebaskan label milik produksi lain di tanggal lain.
 */
function _generateUnmarkUsageSection(type, config, produksiConfig, keysTable) {
  const { keyColumn } = config;

  return `
-- ============================================
-- ${type.toUpperCase()} RELEASE ${config.markUsage.table.toUpperCase()}
-- ============================================
DECLARE @${type}TglProduksi datetime;
SELECT @${type}TglProduksi = ${produksiConfig.dateColumn}
FROM dbo.${produksiConfig.headerTable} WITH (NOLOCK)
WHERE ${produksiConfig.codeColumn} = @no;

IF @${type}TglProduksi IS NOT NULL
BEGIN
  UPDATE b
  SET b.DateUsage = NULL
  FROM dbo.${config.markUsage.table} AS b
  WHERE b.DateUsage = @${type}TglProduksi
    AND EXISTS (
      SELECT 1 FROM ${keysTable} k
      WHERE k.${keyColumn} = b.${keyColumn}
    );

  SELECT @${type}LabelReleased = @@ROWCOUNT;
END
`.trim();
}

function _generateEmptySQL() {
  return `
SET NOCOUNT ON;
DECLARE @out TABLE(Section sysname, Deleted int, NotFound int, LabelReleased int);
SELECT Section, Deleted, NotFound, LabelReleased FROM @out ORDER BY Section;
`.trim();
}

module.exports = {
  generateUpsertInputsDeleteSQL,
};
