// src/core/utils/sql-generator/produksi-delete-sql.generator.js

/**
 * SQL Generator untuk delete inputs & partials secara dinamis.
 * Menghasilkan SQL berdasarkan config yang ada di produksi-input-mapping.config.js
 */

const {
  INPUT_CONFIGS,
  PARTIAL_CONFIGS,
  PRODUKSI_CONFIGS,
  WEIGHT_TOLERANCE,
} = require("../config/produksi-input-mapping.config");

/** convert "NoSak" -> "noSak", "NoBahanBaku" -> "noBahanBaku" */
function toCamelField(dbKey) {
  if (!dbKey) return dbKey;
  return dbKey.charAt(0).toLowerCase() + dbKey.slice(1);
}

// Ekspresi: "sisa partial label ini sudah menutup berat sumber (terpakai penuh)".
// Dipakai supaya reset DateUsage tidak mem-NULL-kan label yang sebenarnya masih
// terpakai penuh lewat partial yang tersisa. Ekspresi selalu mengacu ke alias d.
function _partialCoverageExpr(partialCfg, keys) {
  if (!partialCfg || !partialCfg.tableName || !Array.isArray(keys) || keys.length === 0) {
    return null;
  }
  const keyJoin = keys.map((k) => `p.${k} = d.${k}`).join(" AND ");
  const sum = `SELECT SUM(p.${partialCfg.weightColumn}) FROM dbo.${partialCfg.tableName} p WHERE ${keyJoin}`;
  return `(ISNULL((${sum}), 0) >= (${partialCfg.weightSourceColumn}) - ${WEIGHT_TOLERANCE})`;
}

/** json path for OPENJSON: NoSak -> $.noSak */
function jsonPath(dbKey) {
  return `$.${toCamelField(dbKey)}`;
}

/** choose sql type based on key name */
function sqlTypeForKey(dbKey) {
  const k = String(dbKey || "").toLowerCase();
  if (k === "nosak" || k === "nopallet") return "int";
  return "varchar(50)";
}

/**
 * Generate SQL untuk delete inputs (full materials)
 * @param {string} produksiType
 * @param {string[]} requestedTypes
 */
function generateInputsDeleteSQL(produksiType, requestedTypes) {
  const produksiConfig = PRODUKSI_CONFIGS[produksiType];
  const inputConfigs = INPUT_CONFIGS[produksiType];

  if (!produksiConfig)
    throw new Error(`Unknown produksi type: ${produksiType}`);
  if (!inputConfigs)
    throw new Error(`No input configs found for ${produksiType}`);

  const activeConfigs = requestedTypes.reduce((acc, type) => {
    const config = inputConfigs[type];
    if (config) acc[type] = config;
    return acc;
  }, {});

  if (Object.keys(activeConfigs).length === 0) return _generateEmptySQL();

  const sections = Object.entries(activeConfigs)
    .map(([type, config]) =>
      _generateSingleInputDeleteSection(type, config, produksiConfig),
    )
    .join("\n\n");

  return `
SET NOCOUNT ON;

DECLARE @out TABLE(Section sysname, Deleted int, NotFound int);

${sections}

SELECT Section, Deleted, NotFound FROM @out ORDER BY Section;
`.trim();
}

/**
 * Generate SQL section untuk delete satu jenis input
 */
function _generateSingleInputDeleteSection(type, config, produksiConfig) {
  const varPrefix = type.toUpperCase();

  const keys = config.keys || [];
  const keyFieldsLower = keys.map(toCamelField).join(", ");

  // OPENJSON WITH clause
  const withClause = keys
    .map((k) => `${toCamelField(k)} ${sqlTypeForKey(k)} '${jsonPath(k)}'`)
    .join(", ");

  // Nama kolom di tabel mapping (default sama dengan kolom sumber)
  const mapCol = (k) => config.mappingKeyColumns?.[k] || k;

  // JOIN conditions untuk mapping table
  const joinConditions = keys
    .map((k) => `map.${mapCol(k)} = j.${toCamelField(k)}`)
    .join(" AND ");

  // JOIN conditions untuk source table DateUsage reset
  const sourceJoinConditions = keys
    .map((k) => `d.${k} = map.${mapCol(k)}`)
    .join(" AND ");

  const dateUsageColumn = config.dateUsageColumn || "DateUsage";

  // Coverage check: label masih terpakai penuh kalau (a) sisa partial-nya
  // menutup berat sumber, atau (b) ada mapping produksi LAIN di tabel ini
  // untuk key yang sama. DateUsage tidak boleh di-NULL kalau salah satu
  // terpenuhi — kalau tidak, label yang masih penuh akan muncul "tersedia"
  // sekalipun sudah dipakai (bug DateUsage ter-reset pada edit/delete produksi).
  const coverageExpr = _partialCoverageExpr(PARTIAL_CONFIGS[type], keys);
  const otherMappingExpr = `EXISTS (SELECT 1 FROM dbo.${config.mappingTable} x WHERE ${keys
    .map((k) => `x.${mapCol(k)} = d.${k}`)
    .join(" AND ")} AND x.${produksiConfig.codeColumn} <> @no)`;
  const keepExpr = coverageExpr ? `(${coverageExpr} OR ${otherMappingExpr})` : otherMappingExpr;

  return `
-- ${varPrefix}
DECLARE @${type}Deleted int = 0, @${type}NotFound int = 0;

SELECT @${type}Deleted = COUNT(*)
FROM dbo.${config.mappingTable} map
INNER JOIN OPENJSON(@jsInputs, '$.${type}')
WITH (${withClause}) j
ON ${joinConditions}
WHERE map.${produksiConfig.codeColumn} = @no;

-- Reset ${dateUsageColumn} sebelum DELETE (hanya bila label memang tidak
-- lagi terpakai penuh)
IF @${type}Deleted > 0 AND '${dateUsageColumn}' <> ''
BEGIN
  UPDATE d
  SET d.${dateUsageColumn} = CASE
    WHEN ${keepExpr} THEN d.${dateUsageColumn}
    ELSE NULL END
  FROM dbo.${config.sourceTable} d
  INNER JOIN dbo.${config.mappingTable} map
    ON ${sourceJoinConditions}
  INNER JOIN OPENJSON(@jsInputs, '$.${type}')
  WITH (${withClause}) j
  ON ${joinConditions}
  WHERE map.${produksiConfig.codeColumn} = @no;
END;

-- DELETE dari mapping table
DELETE map
FROM dbo.${config.mappingTable} map
INNER JOIN OPENJSON(@jsInputs, '$.${type}')
WITH (${withClause}) j
ON ${joinConditions}
WHERE map.${produksiConfig.codeColumn} = @no;

-- Calculate notFound
DECLARE @${type}Requested int;
SELECT @${type}Requested = COUNT(*)
FROM OPENJSON(@jsInputs, '$.${type}');

SET @${type}NotFound = @${type}Requested - @${type}Deleted;

INSERT INTO @out SELECT '${type}', @${type}Deleted, @${type}NotFound;
`.trim();
}

/**
 * Generate SQL untuk delete partials
 * @param {string} produksiType
 * @param {string[]} requestedTypes
 */
function generatePartialsDeleteSQL(produksiType, requestedTypes) {
  const produksiConfig = PRODUKSI_CONFIGS[produksiType];
  if (!produksiConfig)
    throw new Error(`Unknown produksi type: ${produksiType}`);

  // Filter hanya partial types yang valid untuk produksiType ini
  const activeTypes = (requestedTypes || []).filter((type) => {
    const cfg = PARTIAL_CONFIGS[type];
    return !!(cfg && cfg.mappingTables && cfg.mappingTables[produksiType]);
  });

  if (activeTypes.length === 0) {
    return _generateEmptySQL();
  }

  const sections = activeTypes
    .map((type) =>
      _generateSinglePartialDeleteSection(
        type,
        PARTIAL_CONFIGS[type],
        produksiType,
      ),
    )
    .join("\n\n");

  return `
SET NOCOUNT ON;

DECLARE @out TABLE(Section sysname, Deleted int, NotFound int);

${sections}

SELECT Section, Deleted, NotFound FROM @out ORDER BY Section;
`.trim();
}

/**
 * Generate SQL section untuk delete satu jenis partial
 */
function _generateSinglePartialDeleteSection(type, config, produksiType) {
  const varName = type.charAt(0).toUpperCase() + type.slice(1);
  const mappingTable = config.mappingTables[produksiType];
  const produksiConfig = PRODUKSI_CONFIGS[produksiType];

  const keys = config.keys || [];
  const keyFieldsDb = keys.join(", ");

  // WITH clause untuk partial column
  const partialWithClause = `${toCamelField(config.partialColumn)} varchar(50) '$.${toCamelField(config.partialColumn)}'`;

  // Temp table untuk track deleted source keys
  const tempTableDef = keys.map((k) => `${k} ${sqlTypeForKey(k)}`).join(", ");

  // JOIN conditions untuk deleted partials temp table
  const deletedJoinConditions = keys
    .map((k) => `bp.${k} = del.${k}`)
    .join(" AND ");

  // Source table UPDATE conditions
  const sourceUpdateConditions = keys
    .map((k) => `d.${k} = del.${k}`)
    .join(" AND ");

  // Partial EXISTS check
  const partialExistsConditions = keys
    .map((k) => `bp.${k} = d.${k}`)
    .join(" AND ");

  // Coverage check: partial yang tersisa masih menutup berat sumber?
  // Dipakai supaya DateUsage tidak di-NULL bila labelnya memang masih
  // terpakai penuh (mis. dimensi ini pernah jadi korban bug: DateUsage
  // ter-reset saat edit produksi, padahal SUM partial masih 100%).
  const remainingSum = `SELECT SUM(p.${config.weightColumn}) FROM dbo.${config.tableName} p WHERE ${keys
    .map((k) => `p.${k} = d.${k}`)
    .join(" AND ")}`;
  const stillFull = `(ISNULL((${remainingSum}), 0) >= (${config.weightSourceColumn}) - ${WEIGHT_TOLERANCE})`;

  return `
-- ${type.toUpperCase()} PARTIAL
DECLARE @${type}Deleted int = 0, @${type}NotFound int = 0;

SELECT @${type}Deleted = COUNT(*)
FROM dbo.${mappingTable} map
INNER JOIN OPENJSON(@jsPartials, '$.${type}Partial')
WITH (${partialWithClause}) j
ON map.${config.partialColumn} = j.${toCamelField(config.partialColumn)}
WHERE map.${produksiConfig.codeColumn} = @no;

-- Track source keys dari partials yang akan dihapus
DECLARE @deleted${varName}Partials TABLE (${tempTableDef});

INSERT INTO @deleted${varName}Partials (${keyFieldsDb})
SELECT DISTINCT ${keyFieldsDb}
FROM dbo.${config.tableName} bp
INNER JOIN dbo.${mappingTable} map ON bp.${config.partialColumn} = map.${config.partialColumn}
INNER JOIN OPENJSON(@jsPartials, '$.${type}Partial')
WITH (${partialWithClause}) j
ON map.${config.partialColumn} = j.${toCamelField(config.partialColumn)}
WHERE map.${produksiConfig.codeColumn} = @no;

-- DELETE dari mapping table
DELETE map
FROM dbo.${mappingTable} map
INNER JOIN OPENJSON(@jsPartials, '$.${type}Partial')
WITH (${partialWithClause}) j
ON map.${config.partialColumn} = j.${toCamelField(config.partialColumn)}
WHERE map.${produksiConfig.codeColumn} = @no;

-- DELETE dari partial table
DELETE bp
FROM dbo.${config.tableName} bp
INNER JOIN OPENJSON(@jsPartials, '$.${type}Partial')
WITH (${partialWithClause}) j
ON bp.${config.partialColumn} = j.${toCamelField(config.partialColumn)};

-- Update source table IsPartial & DateUsage (recompute dari partial tersisa)
IF @${type}Deleted > 0
BEGIN
  UPDATE d
  SET
    d.DateUsage = CASE
      WHEN ${stillFull} THEN d.DateUsage
      ELSE NULL END,
    d.IsPartial = CASE
      WHEN EXISTS (
        SELECT 1
        FROM dbo.${config.tableName} bp
        WHERE ${partialExistsConditions}
      ) THEN 1
      ELSE 0 END
  FROM dbo.${config.sourceTable} d
  INNER JOIN @deleted${varName}Partials del
    ON ${sourceUpdateConditions};
END;

-- Calculate notFound
DECLARE @${type}Requested int;
SELECT @${type}Requested = COUNT(*)
FROM OPENJSON(@jsPartials, '$.${type}Partial');

SET @${type}NotFound = @${type}Requested - @${type}Deleted;

INSERT INTO @out SELECT '${type}Partial', @${type}Deleted, @${type}NotFound;
`.trim();
}

function _generateEmptySQL() {
  return `
SET NOCOUNT ON;
DECLARE @out TABLE(Section sysname, Deleted int, NotFound int);
SELECT Section, Deleted, NotFound FROM @out ORDER BY Section;
`.trim();
}

module.exports = {
  generateInputsDeleteSQL,
  generatePartialsDeleteSQL,
};
