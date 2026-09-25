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
  const labelsTable = `#${type}DelLabels`;
  const hasLabels = !!config.markUsage;

  // Tangkap label (mis. NoBahanPendukung) milik material yang dihapus
  // SEBELUM baris mapping dihapus — label tersimpan sebagai CSV di kolom
  // NoBahanPendukung baris mapping.
  const captureLabels = hasLabels
    ? `
-- Tangkap label ${config.markUsage.labelColumn} material yang akan dihapus
IF OBJECT_ID(N'tempdb..${labelsTable}') IS NOT NULL DROP TABLE ${labelsTable};
CREATE TABLE ${labelsTable} (${config.markUsage.labelColumn} nvarchar(50) PRIMARY KEY);

INSERT INTO ${labelsTable} (${config.markUsage.labelColumn})
SELECT DISTINCT LTRIM(RTRIM(s.value))
FROM dbo.${mappingTable} map
INNER JOIN ${keysTable} k ON k.${keyColumn} = map.${keyColumn}
CROSS APPLY STRING_SPLIT(ISNULL(map.NoBahanPendukung, ''), ',') s
WHERE map.${produksiConfig.codeColumn} = @no
  AND LTRIM(RTRIM(s.value)) <> '';
`
    : "";
  const dropLabels = hasLabels
    ? `
IF OBJECT_ID(N'tempdb..${labelsTable}') IS NOT NULL DROP TABLE ${labelsTable};
`
    : "";

  const unmarkSection = config.markUsage
    ? _generateUnmarkUsageSection(type, config, produksiConfig, labelsTable)
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

${captureLabels}
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
${dropLabels}
`.trim();
}

/**
 * Generate unmark-usage section: kembalikan Qty label (mis. Bahan Pendukung
 * BP.) dari log konsumsi produksi ini dan lepaskan DateUsage, supaya label
 * bisa dipakai kembali.
 *
 * - Label yang punya catatan konsumsi di dbo.${table}Konsumsi_d untuk
 *   produksi ini → Qty dikembalikan persis sebesar QtyKonsumsi.
 * - Label legacy full-mark (tanpa log, mis. dikonsumsi sebelum fitur log)
 *   → Qty dibiarkan (sudah benar pada metode lama) dan hanya DateUsage
 *   yang dilepaskan.
 * - Kategori label dibatasi pada material yang benar-benar dihapus
 *   (labelsTable berisi NoBahanPendukung CSV dari baris mapping yang
 *   dihapus), sehingga release bersifat presisi per produksi+label.
 */
function _generateUnmarkUsageSection(
  type,
  config,
  produksiConfig,
  labelsTable,
) {
  const { table, labelColumn } = config.markUsage;
  const consumptionLogTable = `dbo.${table}Konsumsi_d`;

  return `
-- ============================================
-- ${type.toUpperCase()} RELEASE ${config.markUsage.table.toUpperCase()} (restore Qty dari log)
-- ============================================
DECLARE @${type}TglProduksi datetime;
SELECT @${type}TglProduksi = ${produksiConfig.dateColumn}
FROM dbo.${produksiConfig.headerTable} WITH (NOLOCK)
WHERE ${produksiConfig.codeColumn} = @no;

IF @${type}TglProduksi IS NOT NULL
BEGIN
  UPDATE b
  SET
    b.Qty = ISNULL(b.Qty, 0) + ISNULL(k.QtyKonsumsi, 0),
    b.DateUsage = CASE WHEN b.DateUsage = @${type}TglProduksi THEN NULL ELSE b.DateUsage END
  FROM dbo.${table} AS b
  INNER JOIN ${labelsTable} t ON t.${labelColumn} = b.${labelColumn}
  LEFT JOIN (
    SELECT NoBahanPendukung, SUM(QtyKonsumsi) AS QtyKonsumsi
    FROM ${consumptionLogTable}
    WHERE NoProduksi = @no
    GROUP BY NoBahanPendukung
  ) k ON k.NoBahanPendukung = b.${labelColumn}
  WHERE k.NoBahanPendukung IS NOT NULL
     OR b.DateUsage = @${type}TglProduksi;

  SELECT @${type}LabelReleased = @@ROWCOUNT;

  -- Hapus catatan konsumsi produksi ini agar tidak double-restore.
  DELETE k
  FROM ${consumptionLogTable} k
  INNER JOIN ${labelsTable} t ON t.${labelColumn} = k.NoBahanPendukung
  WHERE k.NoProduksi = @no;
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
