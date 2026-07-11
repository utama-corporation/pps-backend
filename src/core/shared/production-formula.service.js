const { sql } = require("../config/db");

function isSafeSqlIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || "").trim());
}

async function getKategoriByKode(pool, kodeKategori) {
  const kode = String(kodeKategori || "").trim();
  if (!kode) return null;

  const req = pool.request();
  req.input("KodeKategori", sql.VarChar(100), kode);
  const res = await req.query(`
    SELECT TOP 1
      IdKategori,
      KodeKategori,
      NamaKategori,
      PrefixLabel,
      NamaTableJenis,
      NamaKolomIdJenis,
      NamaKolomNamaJenis,
      NamaTableLabel,
      NamaKolomNoLabel,
      NamaKolomIdJenisDiLabel
    FROM dbo.MstKategori WITH (NOLOCK)
    WHERE LOWER(KodeKategori) = LOWER(@KodeKategori)
      AND ISNULL(Enable, 1) = 1;
  `);

  return res.recordset?.[0] || null;
}

async function getKategoriByIds(pool, idKategoriList = []) {
  const ids = [...new Set(idKategoriList.map(Number).filter(Number.isFinite))];
  if (ids.length === 0) return new Map();

  const req = pool.request();
  ids.forEach((id, index) => {
    req.input(`KategoriId${index}`, sql.Int, id);
  });
  const inClause = ids.map((_, index) => `@KategoriId${index}`).join(", ");
  const res = await req.query(`
    SELECT
      IdKategori,
      KodeKategori,
      NamaKategori,
      PrefixLabel,
      NamaTableJenis,
      NamaKolomIdJenis,
      NamaKolomNamaJenis,
      NamaTableLabel,
      NamaKolomNoLabel,
      NamaKolomIdJenisDiLabel
    FROM dbo.MstKategori WITH (NOLOCK)
    WHERE IdKategori IN (${inClause})
      AND ISNULL(Enable, 1) = 1;
  `);

  return new Map(
    (res.recordset || []).map((row) => [Number(row.IdKategori), row]),
  );
}

async function loadJenisNamesForFormulaRows(pool, formulaRows = []) {
  const rows = Array.isArray(formulaRows) ? formulaRows : [];
  if (rows.length === 0) return new Map();

  const kategoriMap = await getKategoriByIds(
    pool,
    rows.map((row) => row.InputKategoriId),
  );
  const nameMap = new Map();
  const groups = new Map();

  for (const row of rows) {
    const kategoriId = Number(row.InputKategoriId);
    const inputId = Number(row.InputId);
    if (!Number.isFinite(kategoriId) || !Number.isFinite(inputId)) continue;
    if (!groups.has(kategoriId)) groups.set(kategoriId, new Set());
    groups.get(kategoriId).add(inputId);
  }

  for (const [kategoriId, idSet] of groups.entries()) {
    const meta = kategoriMap.get(kategoriId);
    if (!meta) continue;

    const tableName = String(meta.NamaTableJenis || "").trim();
    const idColumn = String(meta.NamaKolomIdJenis || "").trim();
    const nameColumn = String(meta.NamaKolomNamaJenis || "").trim();

    if (
      !isSafeSqlIdentifier(tableName) ||
      !isSafeSqlIdentifier(idColumn) ||
      !isSafeSqlIdentifier(nameColumn)
    ) {
      continue;
    }

    const ids = [...idSet];
    if (ids.length === 0) continue;

    const req = pool.request();
    ids.forEach((id, index) => {
      req.input(`JenisId${kategoriId}_${index}`, sql.Int, id);
    });
    const inClause = ids
      .map((_, index) => `@JenisId${kategoriId}_${index}`)
      .join(", ");

    const res = await req.query(`
      SELECT
        CAST(${idColumn} AS int) AS IdJenis,
        CAST(${nameColumn} AS nvarchar(4000)) AS NamaJenis
      FROM dbo.${tableName} WITH (NOLOCK)
      WHERE ${idColumn} IN (${inClause});
    `);

    for (const item of res.recordset || []) {
      nameMap.set(
        `${kategoriId}:${Number(item.IdJenis)}`,
        item.NamaJenis ?? null,
      );
    }
  }

  return nameMap;
}

function normalizeOutputs(outputs = []) {
  return (Array.isArray(outputs) ? outputs : [])
    .map((item) => ({
      idJenis: Number(item?.idJenis),
      namaJenis: item?.namaJenis ?? null,
    }))
    .filter((item) => Number.isFinite(item.idJenis) && item.idJenis > 0);
}

async function getFormulaInputsByCategory({
  pool,
  outputCategory,
  outputs = [],
}) {
  const normalizedCategory = String(outputCategory || "").trim();
  const normalizedOutputs = normalizeOutputs(outputs);

  if (!normalizedCategory || normalizedOutputs.length === 0) {
    return {
      outputCategory: normalizedCategory || null,
      outputCategoryId: null,
      outputs: normalizedOutputs,
      formulas: [],
    };
  }

  const outputKategori = await getKategoriByKode(pool, normalizedCategory);
  if (!outputKategori) {
    return {
      outputCategory: normalizedCategory,
      outputCategoryId: null,
      outputs: normalizedOutputs,
      formulas: [],
    };
  }

  const formulaReq = pool.request();
  formulaReq.input("MainOutputKategoriId", sql.Int, outputKategori.IdKategori);
  normalizedOutputs.forEach((item, index) => {
    formulaReq.input(`MainOutputId${index}`, sql.Int, item.idJenis);
  });

  const inClause = normalizedOutputs
    .map((_, index) => `@MainOutputId${index}`)
    .join(", ");

  const formulaRes = await formulaReq.query(`
    SELECT
      f.IdFormula,
      f.MainOutputKategoriId,
      mk.KodeKategori AS MainOutputKategoriKode,
      mk.NamaKategori AS MainOutputKategoriNama,
      f.MainOutputId,
      f.InputKategoriId,
      ik.KodeKategori AS InputKategoriKode,
      ik.NamaKategori AS InputKategoriNama,
      ik.PrefixLabel AS InputPrefixLabel,
      ik.NamaTableJenis AS InputNamaTableJenis,
      ik.NamaKolomIdJenis AS InputNamaKolomIdJenis,
      ik.NamaKolomNamaJenis AS InputNamaKolomNamaJenis,
      ik.NamaTableLabel AS InputNamaTableLabel,
      ik.NamaKolomNoLabel AS InputNamaKolomNoLabel,
      ik.NamaKolomIdJenisDiLabel AS InputNamaKolomIdJenisDiLabel,
      f.InputId
    FROM dbo.MstFormulaInput f WITH (NOLOCK)
    LEFT JOIN dbo.MstKategori mk WITH (NOLOCK)
      ON mk.IdKategori = f.MainOutputKategoriId
    LEFT JOIN dbo.MstKategori ik WITH (NOLOCK)
      ON ik.IdKategori = f.InputKategoriId
    WHERE f.MainOutputKategoriId = @MainOutputKategoriId
      AND f.MainOutputId IN (${inClause})
    ORDER BY f.MainOutputId ASC, f.InputKategoriId ASC, f.InputId ASC;
  `);

  const outputNameMap = new Map(
    normalizedOutputs.map((item) => [item.idJenis, item.namaJenis ?? null]),
  );
  const inputNameMap = await loadJenisNamesForFormulaRows(
    pool,
    formulaRes.recordset || [],
  );
  const formulas = (formulaRes.recordset || []).map((row) => ({
    ...row,
    InputNama:
      inputNameMap.get(
        `${Number(row.InputKategoriId)}:${Number(row.InputId)}`,
      ) ?? null,
    MainOutputNama: outputNameMap.get(Number(row.MainOutputId)) ?? null,
  }));

  return {
    outputCategory: normalizedCategory,
    outputCategoryId: outputKategori.IdKategori,
    outputCategoryKode: outputKategori.KodeKategori,
    outputCategoryNama: outputKategori.NamaKategori,
    outputPrefixLabel: outputKategori.PrefixLabel ?? null,
    outputNamaTableJenis: outputKategori.NamaTableJenis ?? null,
    outputNamaKolomIdJenis: outputKategori.NamaKolomIdJenis ?? null,
    outputNamaKolomNamaJenis: outputKategori.NamaKolomNamaJenis ?? null,
    outputNamaTableLabel: outputKategori.NamaTableLabel ?? null,
    outputNamaKolomNoLabel: outputKategori.NamaKolomNoLabel ?? null,
    outputNamaKolomIdJenisDiLabel:
      outputKategori.NamaKolomIdJenisDiLabel ?? null,
    outputs: normalizedOutputs,
    formulas,
  };
}

module.exports = {
  getFormulaInputsByCategory,
  normalizeOutputs,
};
