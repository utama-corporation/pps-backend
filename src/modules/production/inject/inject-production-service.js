// services/inject-production-service.js
const { sql, poolPromise } = require("../../../core/config/db");

const {
  resolveEffectiveDateForCreate,
  toDateOnly,
  assertNotLocked,
  formatYMD,
  loadDocDateOnlyFromConfig,
} = require("../../../core/shared/tutup-transaksi-guard");
const sharedInputService = require("../../../core/shared/produksi-input.service");
const {
  badReq,
  conflict,
  notFound,
} = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");

// ============================================================
// ✅ GET ALL (paged + search + lastClosed + isLocked)
// ============================================================
async function getAllProduksi(page = 1, pageSize = 20, search = "") {
  const pool = await poolPromise;

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;

  const searchTerm = (search || "").trim();

  const whereClause = `
    WHERE (@search = '' OR h.NoProduksi LIKE '%' + @search + '%')
  `;

  // 1) Count
  const countQry = `
    SELECT COUNT(1) AS total
    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    ${whereClause};
  `;

  const countReq = pool.request();
  countReq.input("search", sql.VarChar(100), searchTerm);

  const countRes = await countReq.query(countQry);
  const total = countRes.recordset?.[0]?.total || 0;

  if (total === 0) return { data: [], total: 0 };

  // 2) Data + LastClosedDate + IsLocked
  const dataQry = `
    ;WITH LastClosed AS (
      SELECT TOP 1
        CONVERT(date, PeriodHarian) AS LastClosedDate
      FROM dbo.MstTutupTransaksiHarian WITH (NOLOCK)
      WHERE [Lock] = 1
      ORDER BY CONVERT(date, PeriodHarian) DESC, Id DESC
    )
    SELECT
      h.NoProduksi,
      h.TglProduksi,
      h.IdMesin,
      ms.NamaMesin,
      h.IdRegu,
      rg.NamaRegu,
      opAgg.PrimaryIdOperator AS IdOperator,
      opAgg.PrimaryNamaOperator AS NamaOperator,
      opAgg.IdOperators,
      opAgg.Operators,

      h.Jam,
      h.Shift,
      h.CreateBy,
      h.CheckBy1,
      h.CheckBy2,
      h.ApproveBy,
      h.JmlhAnggota,
      h.Hadir,

      h.IdCetakan,
      ct.NamaCetakan,
      h.IdWarna,
      wr.Warna,

      h.EnableOffset,
      h.OffsetCurrent,
      h.OffsetNext,

      h.IdFurnitureMaterial,
      mm.Nama AS NamaFurnitureMaterial,
      CASE
        WHEN fwCount.TotalCount > 0 THEN 'furnitureWip'
        WHEN bjCount.TotalCount > 0 THEN 'barangjadi'
        ELSE NULL
      END AS OutputCategory,
      CASE
        WHEN fwCount.TotalCount > 0 THEN fwItems.OutputItems
        WHEN bjCount.TotalCount > 0 THEN bjItems.OutputItems
        ELSE NULL
      END AS Outputs,
      h.HourMeter,
      h.BeratProdukHasilTimbang,

      CONVERT(VARCHAR(8), h.HourStart, 108) AS HourStart,
      CONVERT(VARCHAR(8), h.HourEnd,   108) AS HourEnd,

      lc.LastClosedDate AS LastClosedDate,

      CASE
        WHEN lc.LastClosedDate IS NOT NULL
         AND CONVERT(date, h.TglProduksi) <= lc.LastClosedDate
        THEN CAST(1 AS bit)
        ELSE CAST(0 AS bit)
      END AS IsLocked

    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstMesin    ms WITH (NOLOCK) ON ms.IdMesin    = h.IdMesin
    LEFT JOIN dbo.MstRegu     rg WITH (NOLOCK) ON rg.IdRegu     = h.IdRegu
    LEFT JOIN dbo.MstCetakan  ct WITH (NOLOCK) ON ct.IdCetakan  = h.IdCetakan
    LEFT JOIN dbo.MstWarna    wr WITH (NOLOCK) ON wr.IdWarna    = h.IdWarna
    LEFT JOIN dbo.MstCabinetMaterial mm WITH (NOLOCK)
      ON mm.IdCabinetMaterial = h.IdFurnitureMaterial
    OUTER APPLY (
      SELECT
        (
          SELECT TOP 1 odTop.IdOperator
          FROM dbo.InjectProduksiOperator_d odTop WITH (NOLOCK)
          WHERE odTop.NoProduksi = h.NoProduksi
          ORDER BY odTop.IdOperator
        ) AS PrimaryIdOperator,
        (
          SELECT TOP 1 opTop.NamaOperator
          FROM dbo.InjectProduksiOperator_d odTop WITH (NOLOCK)
          INNER JOIN dbo.MstOperator opTop WITH (NOLOCK)
            ON opTop.IdOperator = odTop.IdOperator
          WHERE odTop.NoProduksi = h.NoProduksi
          ORDER BY odTop.IdOperator
        ) AS PrimaryNamaOperator,
        JSON_QUERY(
          COALESCE(
            (
              SELECT od.IdOperator AS [value]
              FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
              WHERE od.NoProduksi = h.NoProduksi
              ORDER BY od.IdOperator
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS IdOperators,
        COALESCE(
          (
            SELECT STRING_AGG(op.NamaOperator, ', ')
            FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
            INNER JOIN dbo.MstOperator op WITH (NOLOCK)
              ON op.IdOperator = od.IdOperator
            WHERE od.NoProduksi = h.NoProduksi
          ),
          ''
        ) AS Operators
    ) opAgg
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT
          dFw.IdFurnitureWIP AS IdJenis,
          cab.Nama AS NamaJenis
        FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
        INNER JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
          ON cab.IdCabinetWIP = dFw.IdFurnitureWIP
        WHERE dFw.IdCetakan = h.IdCetakan
          AND dFw.IdWarna = h.IdWarna
          AND (
            (dFw.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR dFw.IdFurnitureMaterial = h.IdFurnitureMaterial
          )
      ) x
    ) fwCount
    OUTER APPLY (
      SELECT
        JSON_QUERY(
          COALESCE(
            (
              SELECT
                x.IdJenis AS idJenis,
                x.NamaJenis AS namaJenis
              FROM (
                SELECT DISTINCT
                  dFw.IdFurnitureWIP AS IdJenis,
                  cab.Nama AS NamaJenis
                FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
                INNER JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
                  ON cab.IdCabinetWIP = dFw.IdFurnitureWIP
                WHERE dFw.IdCetakan = h.IdCetakan
                  AND dFw.IdWarna = h.IdWarna
                  AND (
                    (dFw.IdFurnitureMaterial IS NULL
                      AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
                    OR dFw.IdFurnitureMaterial = h.IdFurnitureMaterial
                  )
              ) x
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS OutputItems
    ) fwItems
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT
          dBj.IdBarangJadi AS IdJenis,
          mbj.NamaBJ AS NamaJenis
        FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
        INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
          ON mbj.IdBJ = dBj.IdBarangJadi
        WHERE dBj.IdCetakan = h.IdCetakan
          AND dBj.IdWarna = h.IdWarna
          AND (
            (dBj.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR dBj.IdFurnitureMaterial = h.IdFurnitureMaterial
          )
      ) x
    ) bjCount
    OUTER APPLY (
      SELECT
        JSON_QUERY(
          COALESCE(
            (
              SELECT
                x.IdJenis AS idJenis,
                x.NamaJenis AS namaJenis
              FROM (
                SELECT DISTINCT
                  dBj.IdBarangJadi AS IdJenis,
                  mbj.NamaBJ AS NamaJenis
                FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
                INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
                  ON mbj.IdBJ = dBj.IdBarangJadi
                WHERE dBj.IdCetakan = h.IdCetakan
                  AND dBj.IdWarna = h.IdWarna
                  AND (
                    (dBj.IdFurnitureMaterial IS NULL
                      AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
                    OR dBj.IdFurnitureMaterial = h.IdFurnitureMaterial
                  )
              ) x
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS OutputItems
    ) bjItems

    OUTER APPLY (
      SELECT TOP 1 LastClosedDate
      FROM LastClosed
    ) lc

    ${whereClause}

    ORDER BY h.TglProduksi DESC, h.Jam ASC, h.NoProduksi DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;

  const dataReq = pool.request();
  dataReq.input("search", sql.VarChar(100), searchTerm);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("limit", sql.Int, ps);

  const dataRes = await dataReq.query(dataQry);
  const data = (dataRes.recordset || []).map((row) => {
    let idOperators = [];
    if (Array.isArray(row.IdOperators)) {
      idOperators = row.IdOperators;
    } else if (typeof row.IdOperators === "string" && row.IdOperators.trim()) {
      try {
        idOperators = JSON.parse(row.IdOperators).map((item) => {
          if (item && typeof item === "object" && "value" in item) {
            return Number(item.value);
          }
          return Number(item);
        });
      } catch (_) {
        idOperators = [];
      }
    }
    idOperators = idOperators
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);

    let outputs = [];
    if (Array.isArray(row.Outputs)) {
      outputs = row.Outputs;
    } else if (typeof row.Outputs === "string" && row.Outputs.trim()) {
      try {
        outputs = JSON.parse(row.Outputs);
      } catch (_) {
        outputs = [];
      }
    }

    return {
      ...row,
      IdOperator: idOperators[0] ?? null,
      NamaOperator: row.NamaOperator ?? null,
      IdOperators: idOperators,
      Outputs: outputs,
    };
  });

  return { data, total };
}

// ============================================================
// ✅ GET BY DATE
// ============================================================
async function getProduksiByDate(date) {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT 
      h.NoProduksi,
      h.TglProduksi,
      h.IdMesin,
      m.NamaMesin,
      h.IdRegu,
      rg.NamaRegu,
      opAgg.PrimaryIdOperator AS IdOperator,
      opAgg.PrimaryNamaOperator AS NamaOperator,
      opAgg.IdOperators,
      opAgg.Operators,
      h.Jam,
      h.Shift,
      h.CreateBy,
      h.CheckBy1,
      h.CheckBy2,
      h.ApproveBy,
      h.JmlhAnggota,
      h.Hadir,
      h.IdCetakan,
      h.IdWarna,
      wr.Warna,
      h.EnableOffset,
      h.OffsetCurrent,
      h.OffsetNext,
      h.IdFurnitureMaterial,
      mm.Nama AS NamaFurnitureMaterial,
      h.HourMeter,
      h.BeratProdukHasilTimbang,
      CONVERT(VARCHAR(8), h.HourStart, 108) AS HourStart,
      CONVERT(VARCHAR(8), h.HourEnd,   108) AS HourEnd,
      jenisAgg.IdJenis AS IdJenis,
      jenisAgg.NamaJenis AS NamaJenis
    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstMesin m WITH (NOLOCK) ON h.IdMesin = m.IdMesin
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK) ON h.IdRegu = rg.IdRegu
    LEFT JOIN dbo.MstWarna wr WITH (NOLOCK) ON h.IdWarna = wr.IdWarna
    LEFT JOIN dbo.MstCabinetMaterial mm WITH (NOLOCK)
      ON mm.IdCabinetMaterial = h.IdFurnitureMaterial
    OUTER APPLY (
      SELECT
        (
          SELECT TOP 1 odTop.IdOperator
          FROM dbo.InjectProduksiOperator_d odTop WITH (NOLOCK)
          WHERE odTop.NoProduksi = h.NoProduksi
          ORDER BY odTop.IdOperator
        ) AS PrimaryIdOperator,
        (
          SELECT TOP 1 opTop.NamaOperator
          FROM dbo.InjectProduksiOperator_d odTop WITH (NOLOCK)
          INNER JOIN dbo.MstOperator opTop WITH (NOLOCK)
            ON opTop.IdOperator = odTop.IdOperator
          WHERE odTop.NoProduksi = h.NoProduksi
          ORDER BY odTop.IdOperator
        ) AS PrimaryNamaOperator,
        JSON_QUERY(
          COALESCE(
            (
              SELECT od.IdOperator AS [value]
              FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
              WHERE od.NoProduksi = h.NoProduksi
              ORDER BY od.IdOperator
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS IdOperators,
        COALESCE(
          (
            SELECT STRING_AGG(op.NamaOperator, ', ')
            FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
            INNER JOIN dbo.MstOperator op WITH (NOLOCK)
              ON op.IdOperator = od.IdOperator
            WHERE od.NoProduksi = h.NoProduksi
          ),
          ''
        ) AS Operators
    ) opAgg
    OUTER APPLY (
      SELECT
        STRING_AGG(CONVERT(VARCHAR(50), x.IdJenis), ', ') AS IdJenis,
        STRING_AGG(x.NamaJenis, ', ') AS NamaJenis
      FROM (
        SELECT DISTINCT
          dFw.IdFurnitureWIP AS IdJenis,
          cab.Nama AS NamaJenis
        FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
        INNER JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
          ON cab.IdCabinetWIP = dFw.IdFurnitureWIP
        WHERE dFw.IdCetakan = h.IdCetakan
          AND dFw.IdWarna = h.IdWarna
          AND (
            (dFw.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR dFw.IdFurnitureMaterial = h.IdFurnitureMaterial
          )

        UNION

        SELECT DISTINCT
          dBj.IdBarangJadi AS IdJenis,
          mbj.NamaBJ AS NamaJenis
        FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
        INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
          ON mbj.IdBJ = dBj.IdBarangJadi
        WHERE dBj.IdCetakan = h.IdCetakan
          AND dBj.IdWarna = h.IdWarna
          AND (
            (dBj.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR dBj.IdFurnitureMaterial = h.IdFurnitureMaterial
          )
      ) x
    ) jenisAgg
    WHERE CONVERT(date, h.TglProduksi) = @date
    ORDER BY h.Jam ASC;
  `;

  request.input("date", sql.Date, date);
  const result = await request.query(query);
  return (result.recordset || []).map((row) => {
    let idOperators = [];
    if (Array.isArray(row.IdOperators)) {
      idOperators = row.IdOperators;
    } else if (typeof row.IdOperators === "string" && row.IdOperators.trim()) {
      try {
        idOperators = JSON.parse(row.IdOperators).map((item) => {
          if (item && typeof item === "object" && "value" in item) {
            return Number(item.value);
          }
          return Number(item);
        });
      } catch (_) {
        idOperators = [];
      }
    }

    return {
      ...row,
      IdOperator: idOperators[0] ?? null,
      IdOperators: idOperators.filter(
        (value) => Number.isFinite(Number(value)) && Number(value) > 0,
      ),
      NamaOperator: row.NamaOperator ?? null,
    };
  });
}

// ============================================================
// 🔹 FurnitureWIP kandidat dari header
// ============================================================
async function getFurnitureWipListByNoProduksi(noProduksi) {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("noProduksi", sql.VarChar(50), noProduksi);

  const query = `
    SELECT
      h.BeratProdukHasilTimbang,
      d.IdFurnitureWIP,
      cab.Nama AS NamaFurnitureWIP
    FROM dbo.InjectProduksi_h AS h WITH (NOLOCK)
    INNER JOIN dbo.CetakanWarnaToFurnitureWIP_d AS d WITH (NOLOCK)
      ON d.IdCetakan = h.IdCetakan
     AND d.IdWarna   = h.IdWarna
     AND (
          (d.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
          OR d.IdFurnitureMaterial = h.IdFurnitureMaterial
         )
    INNER JOIN dbo.MstCabinetWIP AS cab WITH (NOLOCK)
      ON cab.IdCabinetWIP = d.IdFurnitureWIP
    WHERE h.NoProduksi = @noProduksi
      AND h.IdCetakan IS NOT NULL
    ORDER BY cab.Nama ASC;
  `;

  const result = await request.query(query);
  return result.recordset;
}

// ============================================================
// 🔹 BarangJadi kandidat dari header
// ============================================================
async function getPackingListByNoProduksi(noProduksi) {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("noProduksi", sql.VarChar(50), noProduksi);

  const query = `
    SELECT
      h.BeratProdukHasilTimbang,
      d.IdBarangJadi AS IdBJ,
      mbj.NamaBJ
    FROM dbo.InjectProduksi_h AS h WITH (NOLOCK)
    INNER JOIN dbo.CetakanWarnaToProduk_d AS d WITH (NOLOCK)
      ON d.IdCetakan = h.IdCetakan
     AND d.IdWarna   = h.IdWarna
     AND (
          (d.IdFurnitureMaterial IS NULL AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
          OR d.IdFurnitureMaterial = h.IdFurnitureMaterial
         )
    INNER JOIN dbo.MstBarangJadi AS mbj WITH (NOLOCK)
      ON mbj.IdBJ = d.IdBarangJadi
    WHERE h.NoProduksi = @noProduksi
      AND h.IdCetakan IS NOT NULL
    ORDER BY mbj.NamaBJ ASC;
  `;

  const result = await request.query(query);
  return result.recordset;
}

function isSafeSqlIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || "").trim());
}

async function getKategoriByKode(pool, kodeKategori) {
  const req = pool.request();
  req.input("KodeKategori", sql.VarChar(50), String(kodeKategori || "").trim());
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

async function getFormulaInputsByNoProduksi(noProduksi) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  const pool = await poolPromise;
  const request = pool.request();
  request.input("NoProduksi", sql.VarChar(50), no);

  const headerRes = await request.query(`
    SELECT
      h.NoProduksi,
      h.IdCetakan,
      h.IdWarna,
      h.IdFurnitureMaterial,
      CASE
        WHEN fwCount.TotalCount > 0 THEN 'furnitureWip'
        WHEN bjCount.TotalCount > 0 THEN 'barangjadi'
        ELSE NULL
      END AS OutputCategory,
      CASE
        WHEN fwCount.TotalCount > 0 THEN fwItems.OutputItems
        WHEN bjCount.TotalCount > 0 THEN bjItems.OutputItems
        ELSE NULL
      END AS Outputs
    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT
          dFw.IdFurnitureWIP AS IdJenis
        FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
        WHERE dFw.IdCetakan = h.IdCetakan
          AND dFw.IdWarna = h.IdWarna
          AND (
            (dFw.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR dFw.IdFurnitureMaterial = h.IdFurnitureMaterial
          )
      ) x
    ) fwCount
    OUTER APPLY (
      SELECT
        JSON_QUERY(
          COALESCE(
            (
              SELECT
                x.IdJenis AS idJenis,
                x.NamaJenis AS namaJenis
              FROM (
                SELECT DISTINCT
                  dFw.IdFurnitureWIP AS IdJenis,
                  cab.Nama AS NamaJenis
                FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
                INNER JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
                  ON cab.IdCabinetWIP = dFw.IdFurnitureWIP
                WHERE dFw.IdCetakan = h.IdCetakan
                  AND dFw.IdWarna = h.IdWarna
                  AND (
                    (dFw.IdFurnitureMaterial IS NULL
                      AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
                    OR dFw.IdFurnitureMaterial = h.IdFurnitureMaterial
                  )
              ) x
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS OutputItems
    ) fwItems
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT
          dBj.IdBarangJadi AS IdJenis
        FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
        WHERE dBj.IdCetakan = h.IdCetakan
          AND dBj.IdWarna = h.IdWarna
          AND (
            (dBj.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR dBj.IdFurnitureMaterial = h.IdFurnitureMaterial
          )
      ) x
    ) bjCount
    OUTER APPLY (
      SELECT
        JSON_QUERY(
          COALESCE(
            (
              SELECT
                x.IdJenis AS idJenis,
                x.NamaJenis AS namaJenis
              FROM (
                SELECT DISTINCT
                  dBj.IdBarangJadi AS IdJenis,
                  mbj.NamaBJ AS NamaJenis
                FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
                INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
                  ON mbj.IdBJ = dBj.IdBarangJadi
                WHERE dBj.IdCetakan = h.IdCetakan
                  AND dBj.IdWarna = h.IdWarna
                  AND (
                    (dBj.IdFurnitureMaterial IS NULL
                      AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
                    OR dBj.IdFurnitureMaterial = h.IdFurnitureMaterial
                  )
              ) x
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS OutputItems
    ) bjItems
    WHERE h.NoProduksi = @NoProduksi;
  `);

  const header = headerRes.recordset?.[0];
  if (!header) {
    throw notFound(`InjectProduksi ${no} tidak ditemukan`);
  }

  let outputs = [];
  if (Array.isArray(header.Outputs)) {
    outputs = header.Outputs;
  } else if (typeof header.Outputs === "string" && header.Outputs.trim()) {
    try {
      outputs = JSON.parse(header.Outputs);
    } catch (_) {
      outputs = [];
    }
  }

  const normalizedOutputs = outputs
    .map((item) => ({
      idJenis: Number(item?.idJenis),
      namaJenis: item?.namaJenis ?? null,
    }))
    .filter((item) => Number.isFinite(item.idJenis) && item.idJenis > 0);

  if (!header.OutputCategory || normalizedOutputs.length === 0) {
    return {
      noProduksi: no,
      outputCategory: header.OutputCategory ?? null,
      outputCategoryId: null,
      outputs: normalizedOutputs,
      formulas: [],
    };
  }

  const outputKategori = await getKategoriByKode(
    pool,
    String(header.OutputCategory).toLowerCase(),
  );

  if (!outputKategori) {
    return {
      noProduksi: no,
      outputCategory: header.OutputCategory,
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
    noProduksi: no,
    outputCategory: header.OutputCategory,
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

async function createInjectProduksi(payload, ctx) {
  const body = payload && typeof payload === "object" ? payload : {};

  // ===============================
  // Validasi wajib
  // ===============================
  const operatorIdsRaw = Array.isArray(body?.idOperators)
    ? body.idOperators
    : body?.idOperator != null
      ? [body.idOperator]
      : [];
  const operatorIds = [
    ...new Set(
      operatorIdsRaw
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n)),
    ),
  ];
  const primaryOperatorId = operatorIds[0] ?? null;

  const must = [];
  if (!body?.tglProduksi) must.push("tglProduksi");
  if (body?.idMesin == null) must.push("idMesin");
  if (primaryOperatorId == null) must.push("idOperators");
  if (body?.idRegu == null) must.push("idRegu");
  if (body?.shift == null) must.push("shift");
  if (!body?.hourStart) must.push("hourStart");
  if (!body?.hourEnd) must.push("hourEnd");
  if (must.length) throw badReq(`Field wajib: ${must.join(", ")}`);

  const docDateOnly = toDateOnly(body.tglProduksi);

  // ===============================
  // Validasi ctx / audit
  // ===============================
  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();
  const auditCtx = {
    actorId: Math.trunc(actorIdNum),
    actorUsername,
    requestId,
  };

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // ===============================
    // Set audit context
    // ===============================
    const auditReq = new sql.Request(tx);
    const audit = await applyAuditContext(auditReq, auditCtx);

    // ===============================
    // Lock tanggal produksi
    // ===============================
    const effectiveDate = resolveEffectiveDateForCreate(body.tglProduksi);
    await assertNotLocked({
      date: effectiveDate,
      runner: tx,
      action: "create InjectProduksi",
      useLock: true,
    });

    // ===============================
    // Validasi kombinasi Cetakan / Warna / FurnitureMaterial
    // ===============================
    if (
      body.idCetakan != null ||
      body.idWarna != null ||
      body.idFurnitureMaterial != null
    ) {
      const cwReq = new sql.Request(tx);
      cwReq
        .input("IdCetakan", sql.Int, body.idCetakan ?? null)
        .input("IdWarna", sql.Int, body.idWarna ?? null)
        .input(
          "IdFurnitureMaterial",
          sql.Int,
          body.idFurnitureMaterial ?? null,
        );

      const cwRes = await cwReq.query(`
        SELECT TOP 1 1 AS found
        FROM dbo.CetakanWarna_h
        WHERE
          (@IdCetakan           IS NULL OR IdCetakan           = @IdCetakan)
          AND (@IdWarna             IS NULL OR IdWarna             = @IdWarna)
          AND (@IdFurnitureMaterial IS NULL OR IdFurnitureMaterial = @IdFurnitureMaterial)
      `);

      if (cwRes.recordset.length === 0) {
        throw badReq(
          "Cetakan, warna, dan material tidak valid atau belum terdaftar di master cetakan warna material.",
        );
      }
    }

    // ===============================
    // Generate NoProduksi unik
    // ===============================
    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.InjectProduksi_h",
        columnName: "NoProduksi",
        prefix: "S.",
        width: 10,
      });
    let noProduksi = await gen();

    // double check anti-race
    const exist = await new sql.Request(tx)
      .input("NoProduksi", sql.VarChar(50), noProduksi)
      .query(
        `SELECT 1 FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK) WHERE NoProduksi=@NoProduksi`,
      );
    if (exist.recordset.length > 0) {
      noProduksi = await gen();
    }

    // ===============================
    // Insert header dengan OUTPUT INTO table variable
    // ===============================
    const rqIns = new sql.Request(tx);
    rqIns
      .input("NoProduksi", sql.VarChar(50), noProduksi)
      .input("TglProduksi", sql.Date, effectiveDate)
      .input("IdMesin", sql.Int, body.idMesin)
      .input("IdRegu", sql.Int, body.idRegu ?? null)
      .input("Shift", sql.Int, body.shift)
      .input("Jam", sql.Int, body.jam ?? null)
      .input("CreateBy", sql.VarChar(100), body.createBy)
      .input("CheckBy1", sql.VarChar(100), body.checkBy1 ?? null)
      .input("CheckBy2", sql.VarChar(100), body.checkBy2 ?? null)
      .input("ApproveBy", sql.VarChar(100), body.approveBy ?? null)
      .input("JmlhAnggota", sql.Int, body.jmlhAnggota ?? null)
      .input("Hadir", sql.Int, body.hadir ?? null)
      .input("IdCetakan", sql.Int, body.idCetakan ?? null)
      .input("IdWarna", sql.Int, body.idWarna ?? null)
      .input("EnableOffset", sql.Bit, body.enableOffset ?? 0)
      .input("OffsetCurrent", sql.Int, body.offsetCurrent ?? null)
      .input("OffsetNext", sql.Int, body.offsetNext ?? null)
      .input("IdFurnitureMaterial", sql.Int, body.idFurnitureMaterial ?? null)
      .input("HourMeter", sql.Decimal(18, 2), body.hourMeter ?? null)
      .input(
        "BeratProdukHasilTimbang",
        sql.Decimal(18, 2),
        body.beratProdukHasilTimbang ?? null,
      )
      .input("HourStart", sql.VarChar(20), body.hourStart)
      .input("HourEnd", sql.VarChar(20), body.hourEnd);

    const insertSql = `
      DECLARE @tmp TABLE (
        NoProduksi varchar(50), IdMesin int, TglProduksi date,
        Jam int, Shift int, IdRegu int, CreateBy varchar(100), CheckBy1 varchar(100),
        CheckBy2 varchar(100), ApproveBy varchar(100), JmlhAnggota int,
        Hadir int, IdCetakan int, IdWarna int, EnableOffset bit,
        OffsetCurrent int, OffsetNext int, IdFurnitureMaterial int,
        HourMeter decimal(18,2), BeratProdukHasilTimbang decimal(18,2),
        HourStart time(7), HourEnd time(7)
      );

      INSERT INTO dbo.InjectProduksi_h (
        NoProduksi, IdMesin, TglProduksi, Jam, Shift,
        IdRegu,
        CreateBy, CheckBy1, CheckBy2, ApproveBy,
        JmlhAnggota, Hadir,
        IdCetakan, IdWarna,
        EnableOffset, OffsetCurrent, OffsetNext,
        IdFurnitureMaterial,
        HourMeter, BeratProdukHasilTimbang,
        HourStart, HourEnd
      )
      OUTPUT
        INSERTED.NoProduksi,
        INSERTED.IdMesin,
        INSERTED.TglProduksi,
        INSERTED.Jam,
        INSERTED.Shift,
        INSERTED.IdRegu,
        INSERTED.CreateBy,
        INSERTED.CheckBy1,
        INSERTED.CheckBy2,
        INSERTED.ApproveBy,
        INSERTED.JmlhAnggota,
        INSERTED.Hadir,
        INSERTED.IdCetakan,
        INSERTED.IdWarna,
        INSERTED.EnableOffset,
        INSERTED.OffsetCurrent,
        INSERTED.OffsetNext,
        INSERTED.IdFurnitureMaterial,
        INSERTED.HourMeter,
        INSERTED.BeratProdukHasilTimbang,
        INSERTED.HourStart,
        INSERTED.HourEnd
      INTO @tmp
      VALUES (
        @NoProduksi, @IdMesin, @TglProduksi,
        @Jam, @Shift, @IdRegu,
        @CreateBy, @CheckBy1, @CheckBy2, @ApproveBy,
        @JmlhAnggota, @Hadir,
        @IdCetakan, @IdWarna,
        @EnableOffset, @OffsetCurrent, @OffsetNext,
        @IdFurnitureMaterial,
        @HourMeter, @BeratProdukHasilTimbang,
        CASE WHEN @HourStart IS NULL OR LTRIM(RTRIM(@HourStart)) = '' THEN NULL ELSE CAST(@HourStart AS time(7)) END,
        CASE WHEN @HourEnd   IS NULL OR LTRIM(RTRIM(@HourEnd))   = '' THEN NULL ELSE CAST(@HourEnd   AS time(7)) END
      );

      SELECT * FROM @tmp;
    `;

    const insRes = await rqIns.query(insertSql);

    if (operatorIds.length > 0) {
      const rqOp = new sql.Request(tx);
      rqOp.input("NoProduksi", sql.VarChar(50), noProduksi);
      const opValues = operatorIds.map((opId, i) => {
        const p = `DetailOp${i}`;
        rqOp.input(p, sql.Int, opId);
        return `(@NoProduksi, @${p})`;
      });
      await rqOp.query(`
        INSERT INTO dbo.InjectProduksiOperator_d (NoProduksi, IdOperator)
        VALUES ${opValues.join(", ")};
      `);
    }

    await tx.commit();

    return {
      header: {
        ...(insRes.recordset?.[0] || {}),
        IdOperator: primaryOperatorId,
        IdOperators: operatorIds,
      },
      audit,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

// ============================================================
// ✅ UPDATE header InjectProduksi_h + sync DateUsage (inputs)
// ============================================================
async function updateInjectProduksi(noProduksi, payload, ctx) {
  if (!noProduksi) throw badReq("noProduksi wajib");

  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }

  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const auditCtx = {
    actorId: Math.trunc(actorIdNum),
    actorUsername,
    requestId,
  };

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // =====================================================
    // 0) load old doc date + lock
    // =====================================================
    const { docDateOnly: oldDocDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "injectProduksi",
      codeValue: noProduksi,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });

    // =====================================================
    // 1) handle date change
    // =====================================================
    const isChangingDate = payload?.tglProduksi !== undefined;
    let newDocDateOnly = null;
    if (isChangingDate) {
      if (!payload.tglProduksi) throw badReq("tglProduksi tidak boleh kosong");
      newDocDateOnly = resolveEffectiveDateForCreate(payload.tglProduksi);
    }

    // =====================================================
    // 2) guard tutup transaksi
    // =====================================================
    await assertNotLocked({
      date: oldDocDateOnly,
      runner: tx,
      action: "update InjectProduksi (current date)",
      useLock: true,
    });
    if (isChangingDate) {
      await assertNotLocked({
        date: newDocDateOnly,
        runner: tx,
        action: "update InjectProduksi (new date)",
        useLock: true,
      });
    }

    // =====================================================
    // 3) SET fields dynamically
    // =====================================================
    const sets = [];
    const rqUpd = new sql.Request(tx);
    const hasIdOperators = payload?.idOperators !== undefined;
    const normalizedOperatorIds = hasIdOperators
      ? [
          ...new Set(
            (Array.isArray(payload.idOperators) ? payload.idOperators : [])
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
              .map((value) => Math.trunc(value)),
          ),
        ]
      : [];

    if (hasIdOperators && normalizedOperatorIds.length === 0) {
      throw badReq("idOperators wajib berisi minimal 1 operator");
    }

    if (isChangingDate) {
      sets.push("TglProduksi = @TglProduksi");
      rqUpd.input("TglProduksi", sql.Date, newDocDateOnly);
    }

    if (payload.idMesin !== undefined) {
      sets.push("IdMesin = @IdMesin");
      rqUpd.input("IdMesin", sql.Int, payload.idMesin);
    }

    if (payload.idRegu !== undefined) {
      sets.push("IdRegu = @IdRegu");
      rqUpd.input("IdRegu", sql.Int, payload.idRegu ?? null);
    }

    if (payload.shift !== undefined) {
      sets.push("Shift = @Shift");
      rqUpd.input("Shift", sql.Int, payload.shift);
    }

    if (payload.jam !== undefined) {
      sets.push("Jam = @Jam");
      rqUpd.input("Jam", sql.Int, payload.jam ?? null);
    }

    if (payload.jmlhAnggota !== undefined) {
      sets.push("JmlhAnggota = @JmlhAnggota");
      rqUpd.input("JmlhAnggota", sql.Int, payload.jmlhAnggota ?? null);
    }

    if (payload.hadir !== undefined) {
      sets.push("Hadir = @Hadir");
      rqUpd.input("Hadir", sql.Int, payload.hadir ?? null);
    }

    if (payload.idCetakan !== undefined) {
      sets.push("IdCetakan = @IdCetakan");
      rqUpd.input("IdCetakan", sql.Int, payload.idCetakan ?? null);
    }

    if (payload.idWarna !== undefined) {
      sets.push("IdWarna = @IdWarna");
      rqUpd.input("IdWarna", sql.Int, payload.idWarna ?? null);
    }

    if (payload.enableOffset !== undefined) {
      sets.push("EnableOffset = @EnableOffset");
      rqUpd.input("EnableOffset", sql.Bit, payload.enableOffset ?? null);
    }

    if (payload.offsetCurrent !== undefined) {
      sets.push("OffsetCurrent = @OffsetCurrent");
      rqUpd.input("OffsetCurrent", sql.Int, payload.offsetCurrent ?? null);
    }

    if (payload.offsetNext !== undefined) {
      sets.push("OffsetNext = @OffsetNext");
      rqUpd.input("OffsetNext", sql.Int, payload.offsetNext ?? null);
    }

    if (payload.idFurnitureMaterial !== undefined) {
      sets.push("IdFurnitureMaterial = @IdFurnitureMaterial");
      rqUpd.input(
        "IdFurnitureMaterial",
        sql.Int,
        payload.idFurnitureMaterial ?? null,
      );
    }

    if (payload.hourMeter !== undefined) {
      sets.push("HourMeter = @HourMeter");
      rqUpd.input("HourMeter", sql.Decimal(18, 2), payload.hourMeter ?? null);
    }

    if (payload.beratProdukHasilTimbang !== undefined) {
      sets.push("BeratProdukHasilTimbang = @BeratProdukHasilTimbang");
      rqUpd.input(
        "BeratProdukHasilTimbang",
        sql.Decimal(18, 2),
        payload.beratProdukHasilTimbang ?? null,
      );
    }

    if (payload.hourStart !== undefined) {
      sets.push(
        `HourStart = CASE WHEN @HourStart IS NULL OR LTRIM(RTRIM(@HourStart)) = '' THEN NULL ELSE CAST(@HourStart AS time(7)) END`,
      );
      rqUpd.input("HourStart", sql.VarChar(20), payload.hourStart);
    }

    if (payload.hourEnd !== undefined) {
      sets.push(
        `HourEnd = CASE WHEN @HourEnd IS NULL OR LTRIM(RTRIM(@HourEnd)) = '' THEN NULL ELSE CAST(@HourEnd AS time(7)) END`,
      );
      rqUpd.input("HourEnd", sql.VarChar(20), payload.hourEnd);
    }

    if (payload.checkBy1 !== undefined) {
      sets.push("CheckBy1 = @CheckBy1");
      rqUpd.input("CheckBy1", sql.VarChar(100), payload.checkBy1 ?? null);
    }

    if (payload.checkBy2 !== undefined) {
      sets.push("CheckBy2 = @CheckBy2");
      rqUpd.input("CheckBy2", sql.VarChar(100), payload.checkBy2 ?? null);
    }

    if (payload.approveBy !== undefined) {
      sets.push("ApproveBy = @ApproveBy");
      rqUpd.input("ApproveBy", sql.VarChar(100), payload.approveBy ?? null);
    }

    if (sets.length === 0) throw badReq("No fields to update");

    rqUpd.input("NoProduksi", sql.VarChar(50), noProduksi);

    const updateSql = `
      UPDATE dbo.InjectProduksi_h
      SET ${sets.join(", ")}
      WHERE NoProduksi = @NoProduksi;

      SELECT *
      FROM dbo.InjectProduksi_h
      WHERE NoProduksi = @NoProduksi;
    `;

    // =====================================================
    // 4) apply audit context
    // =====================================================
    await applyAuditContext(rqUpd, auditCtx);

    // =====================================================
    // 5) execute update
    // =====================================================
    const updRes = await rqUpd.query(updateSql);
    let updatedHeader = updRes.recordset?.[0] || null;

    if (hasIdOperators) {
      const rqDelOp = new sql.Request(tx);
      rqDelOp.input("NoProduksi", sql.VarChar(50), noProduksi);
      await rqDelOp.query(`
        DELETE FROM dbo.InjectProduksiOperator_d
        WHERE NoProduksi = @NoProduksi;
      `);

      const rqInsOp = new sql.Request(tx);
      rqInsOp.input("NoProduksi", sql.VarChar(50), noProduksi);
      const valuesSql = normalizedOperatorIds.map((opId, index) => {
        const param = `IdOperator${index}`;
        rqInsOp.input(param, sql.Int, opId);
        return `(@NoProduksi, @${param})`;
      });

      await rqInsOp.query(`
        INSERT INTO dbo.InjectProduksiOperator_d (NoProduksi, IdOperator)
        VALUES ${valuesSql.join(", ")};
      `);
    }

    // =====================================================
    // 6) jika tanggal berubah -> sync DateUsage
    // =====================================================
    if (isChangingDate && updatedHeader) {
      const usageDate = resolveEffectiveDateForCreate(
        updatedHeader.TglProduksi,
      );
      const rqUsage = new sql.Request(tx);
      rqUsage
        .input("NoProduksi", sql.VarChar(50), noProduksi)
        .input("Tanggal", sql.Date, usageDate);

      const sqlUpdateUsage = `
        -------------------------------------------------------
        -- BROKER (FULL)
        -------------------------------------------------------
        UPDATE br
        SET br.DateUsage = @Tanggal
        FROM dbo.Broker_d AS br
        WHERE br.DateUsage IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.InjectProduksiInputBroker AS map
            WHERE map.NoProduksi = @NoProduksi
              AND map.NoBroker   = br.NoBroker
              AND map.NoSak      = br.NoSak
          );

        -------------------------------------------------------
        -- MIXER (FULL + PARTIAL)
        -------------------------------------------------------
        UPDATE m
        SET m.DateUsage = @Tanggal
        FROM dbo.Mixer_d AS m
        WHERE m.DateUsage IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM dbo.InjectProduksiInputMixer AS map
              WHERE map.NoProduksi = @NoProduksi
                AND map.NoMixer    = m.NoMixer
                AND map.NoSak      = m.NoSak
            )
            OR
            EXISTS (
              SELECT 1
              FROM dbo.InjectProduksiInputMixerPartial AS mp
              JOIN dbo.MixerPartial AS mpd
                ON mpd.NoMixerPartial = mp.NoMixerPartial
              WHERE mp.NoProduksi = @NoProduksi
                AND mpd.NoMixer   = m.NoMixer
                AND mpd.NoSak     = m.NoSak
            )
          );

        -------------------------------------------------------
        -- GILINGAN (FULL + PARTIAL)
        -------------------------------------------------------
        UPDATE g
        SET g.DateUsage = @Tanggal
        FROM dbo.Gilingan AS g
        WHERE g.DateUsage IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM dbo.InjectProduksiInputGilingan AS map
              WHERE map.NoProduksi = @NoProduksi
                AND map.NoGilingan = g.NoGilingan
            )
            OR
            EXISTS (
              SELECT 1
              FROM dbo.InjectProduksiInputGilinganPartial AS mp
              JOIN dbo.GilinganPartial AS gp
                ON gp.NoGilinganPartial = mp.NoGilinganPartial
              WHERE mp.NoProduksi = @NoProduksi
                AND gp.NoGilingan = g.NoGilingan
            )
          );

        -------------------------------------------------------
        -- FURNITURE WIP (FULL + PARTIAL)
        -------------------------------------------------------
        UPDATE fw
        SET fw.DateUsage = @Tanggal
        FROM dbo.FurnitureWIP AS fw
        WHERE fw.DateUsage IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM dbo.InjectProduksiInputFurnitureWIP AS map
              WHERE map.NoProduksi     = @NoProduksi
                AND map.NoFurnitureWIP = fw.NoFurnitureWIP
            )
            OR
            EXISTS (
              SELECT 1
              FROM dbo.InjectProduksiInputFurnitureWIPPartial AS mp
              JOIN dbo.FurnitureWIPPartial AS fwp
                ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
              WHERE mp.NoProduksi = @NoProduksi
                AND fwp.NoFurnitureWIP = fw.NoFurnitureWIP
            )
          );
      `;
      await rqUsage.query(sqlUpdateUsage);
    }

    const rqFinal = new sql.Request(tx);
    rqFinal.input("NoProduksi", sql.VarChar(50), noProduksi);
    updatedHeader =
      (
        await rqFinal.query(`
        SELECT
          h.*,
          JSON_QUERY(
            COALESCE(
              (
                SELECT od.IdOperator AS [value]
                FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
                WHERE od.NoProduksi = h.NoProduksi
                ORDER BY od.IdOperator
                FOR JSON PATH
              ),
              '[]'
            )
          ) AS IdOperators,
          COALESCE(
            (
              SELECT STRING_AGG(op.NamaOperator, ', ')
              FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
              INNER JOIN dbo.MstOperator op WITH (NOLOCK)
                ON op.IdOperator = od.IdOperator
              WHERE od.NoProduksi = h.NoProduksi
            ),
            ''
          ) AS Operators
        FROM dbo.InjectProduksi_h h WITH (NOLOCK)
        WHERE h.NoProduksi = @NoProduksi;
      `)
      ).recordset?.[0] || updatedHeader;

    if (
      updatedHeader &&
      typeof updatedHeader.IdOperators === "string" &&
      updatedHeader.IdOperators.trim()
    ) {
      try {
        updatedHeader.IdOperators = JSON.parse(updatedHeader.IdOperators)
          .map((item) =>
            item && typeof item === "object" && "value" in item
              ? Number(item.value)
              : Number(item),
          )
          .filter((value) => Number.isFinite(value) && value > 0);
      } catch (_) {
        updatedHeader.IdOperators = [];
      }
    }
    if (updatedHeader) {
      updatedHeader.IdOperator = updatedHeader.IdOperators?.[0] ?? null;
    }

    await tx.commit();
    return { header: updatedHeader, audit: auditCtx };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

// ============================================================
// ✅ DELETE header InjectProduksi_h + delete inputs + reset DateUsage
// ============================================================
async function deleteInjectProduksi(noProduksi, ctx) {
  if (!noProduksi) throw badReq("noProduksi wajib");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // =====================================================
    // 0) SET SESSION_CONTEXT (untuk trigger audit)
    // =====================================================
    const actorIdNum = Number(ctx?.actorId);
    if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
      throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
    }
    const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
    const requestId = String(ctx?.requestId || "").trim();

    const auditReq = new sql.Request(tx);
    await applyAuditContext(auditReq, {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    });

    // =====================================================
    // 1) Ambil docDateOnly dari config (LOCK HEADER)
    // =====================================================
    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "injectProduksi",
      codeValue: noProduksi,
      runner: tx,
      useLock: true, // DELETE = write lock
      throwIfNotFound: true,
    });

    // =====================================================
    // 2) Guard tutup transaksi
    // =====================================================
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete InjectProduksi",
      useLock: true,
    });

    // =====================================================
    // 3) Cek output
    // =====================================================
    const rqOut = new sql.Request(tx);
    const outRes = await rqOut.input("NoProduksi", sql.VarChar(50), noProduksi)
      .query(`
        SELECT
          SUM(CASE WHEN Src='BONGGOLAN' THEN Cnt ELSE 0 END) AS CntOutputBonggolan,
          SUM(CASE WHEN Src='MIXER'     THEN Cnt ELSE 0 END) AS CntOutputMixer,
          SUM(CASE WHEN Src='REJECT'    THEN Cnt ELSE 0 END) AS CntOutputReject,
          SUM(CASE WHEN Src='FWIP'      THEN Cnt ELSE 0 END) AS CntOutputFWIP,
          SUM(CASE WHEN Src='BJ'        THEN Cnt ELSE 0 END) AS CntOutputBJ
        FROM (
          SELECT 'BONGGOLAN' AS Src, COUNT(1) AS Cnt
          FROM dbo.InjectProduksiOutputBonggolan WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
          UNION ALL
          SELECT 'MIXER', COUNT(1)
          FROM dbo.InjectProduksiOutputMixer WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
          UNION ALL
          SELECT 'REJECT', COUNT(1)
          FROM dbo.InjectProduksiOutputRejectV2 WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
          UNION ALL
          SELECT 'FWIP', COUNT(1)
          FROM dbo.InjectProduksiOutputFurnitureWIP WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
          UNION ALL
          SELECT 'BJ', COUNT(1)
          FROM dbo.InjectProduksiOutputBarangJadi WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
        ) X;
      `);

    const row = outRes.recordset?.[0] || {};
    const hasOutput =
      (row.CntOutputBonggolan || 0) > 0 ||
      (row.CntOutputMixer || 0) > 0 ||
      (row.CntOutputReject || 0) > 0 ||
      (row.CntOutputFWIP || 0) > 0 ||
      (row.CntOutputBJ || 0) > 0;

    if (hasOutput) {
      throw badReq(
        "Tidak dapat menghapus Nomor Produksi ini karena sudah memiliki data output.",
      );
    }

    // =====================================================
    // 4) DELETE INPUT (FULL + PARTIAL) + RESET DATEUSAGE
    // =====================================================
    const rq = new sql.Request(tx);
    rq.input("NoProduksi", sql.VarChar(50), noProduksi);

    const sqlDelete = `
      SET NOCOUNT ON;

      ---------------------------------------------------------
      -- TABLE VARIABLE UNTUK KEY TERDAMPAK
      ---------------------------------------------------------
      DECLARE @BrokerKeys TABLE (NoBroker varchar(50), NoSak int);
      DECLARE @MixerKeys TABLE (NoMixer varchar(50), NoSak int);
      DECLARE @GilinganKeys TABLE (NoGilingan varchar(50));
      DECLARE @FWIPKeys TABLE (NoFurnitureWIP varchar(50));

      ---------------------------------------------------------
      -- INPUT FULL
      ---------------------------------------------------------
      INSERT INTO @BrokerKeys (NoBroker, NoSak)
      SELECT DISTINCT NoBroker, NoSak
      FROM dbo.InjectProduksiInputBroker
      WHERE NoProduksi = @NoProduksi;

      INSERT INTO @MixerKeys (NoMixer, NoSak)
      SELECT DISTINCT NoMixer, NoSak
      FROM dbo.InjectProduksiInputMixer
      WHERE NoProduksi = @NoProduksi;

      INSERT INTO @GilinganKeys (NoGilingan)
      SELECT DISTINCT NoGilingan
      FROM dbo.InjectProduksiInputGilingan
      WHERE NoProduksi = @NoProduksi;

      INSERT INTO @FWIPKeys (NoFurnitureWIP)
      SELECT DISTINCT NoFurnitureWIP
      FROM dbo.InjectProduksiInputFurnitureWIP
      WHERE NoProduksi = @NoProduksi;

      ---------------------------------------------------------
      -- INPUT PARTIAL
      ---------------------------------------------------------
      INSERT INTO @MixerKeys (NoMixer, NoSak)
      SELECT DISTINCT mpd.NoMixer, mpd.NoSak
      FROM dbo.InjectProduksiInputMixerPartial mp
      JOIN dbo.MixerPartial mpd
        ON mp.NoMixerPartial = mpd.NoMixerPartial
      WHERE mp.NoProduksi = @NoProduksi
        AND NOT EXISTS (
          SELECT 1 FROM @MixerKeys k
          WHERE k.NoMixer = mpd.NoMixer AND k.NoSak = mpd.NoSak
        );

      INSERT INTO @GilinganKeys (NoGilingan)
      SELECT DISTINCT gp.NoGilingan
      FROM dbo.InjectProduksiInputGilinganPartial mp
      JOIN dbo.GilinganPartial gp
        ON gp.NoGilinganPartial = mp.NoGilinganPartial
      WHERE mp.NoProduksi = @NoProduksi
        AND NOT EXISTS (
          SELECT 1 FROM @GilinganKeys k
          WHERE k.NoGilingan = gp.NoGilingan
        );

      INSERT INTO @FWIPKeys (NoFurnitureWIP)
      SELECT DISTINCT fwp.NoFurnitureWIP
      FROM dbo.InjectProduksiInputFurnitureWIPPartial mp
      JOIN dbo.FurnitureWIPPartial fwp
        ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
      WHERE mp.NoProduksi = @NoProduksi
        AND NOT EXISTS (
          SELECT 1 FROM @FWIPKeys k
          WHERE k.NoFurnitureWIP = fwp.NoFurnitureWIP
        );

      ---------------------------------------------------------
      -- HAPUS PARTIAL
      ---------------------------------------------------------
      DELETE mpd
      FROM dbo.MixerPartial mpd
      JOIN dbo.InjectProduksiInputMixerPartial mp
        ON mp.NoMixerPartial = mpd.NoMixerPartial
      WHERE mp.NoProduksi = @NoProduksi;

      DELETE gp
      FROM dbo.GilinganPartial gp
      JOIN dbo.InjectProduksiInputGilinganPartial mp
        ON mp.NoGilinganPartial = gp.NoGilinganPartial
      WHERE mp.NoProduksi = @NoProduksi;

      DELETE fwp
      FROM dbo.FurnitureWIPPartial fwp
      JOIN dbo.InjectProduksiInputFurnitureWIPPartial mp
        ON mp.NoFurnitureWIPPartial = fwp.NoFurnitureWIPPartial
      WHERE mp.NoProduksi = @NoProduksi;

      ---------------------------------------------------------
      -- HAPUS MAPPING INPUT FULL & PARTIAL
      ---------------------------------------------------------
      DELETE FROM dbo.InjectProduksiInputMixerPartial WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.InjectProduksiInputGilinganPartial WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.InjectProduksiInputFurnitureWIPPartial WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.InjectProduksiInputBroker WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.InjectProduksiInputMixer WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.InjectProduksiInputGilingan WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.InjectProduksiInputFurnitureWIP WHERE NoProduksi = @NoProduksi;

      ---------------------------------------------------------
      -- RESET DATEUSAGE
      ---------------------------------------------------------
      UPDATE b
      SET b.DateUsage = NULL
      FROM dbo.Broker_d b
      JOIN @BrokerKeys k ON k.NoBroker = b.NoBroker AND k.NoSak = b.NoSak;

      UPDATE m
      SET m.DateUsage = NULL
      FROM dbo.Mixer_d m
      JOIN @MixerKeys k ON k.NoMixer = m.NoMixer AND k.NoSak = m.NoSak;

      UPDATE g
      SET g.DateUsage = NULL
      FROM dbo.Gilingan g
      JOIN @GilinganKeys k ON k.NoGilingan = g.NoGilingan;

      UPDATE fw
      SET fw.DateUsage = NULL,
          fw.IsPartial = CASE
            WHEN EXISTS (
              SELECT 1
              FROM dbo.FurnitureWIPPartial p
              WHERE p.NoFurnitureWIP = fw.NoFurnitureWIP
            ) THEN 1 ELSE 0 END
      FROM dbo.FurnitureWIP fw
      JOIN @FWIPKeys k ON k.NoFurnitureWIP = fw.NoFurnitureWIP;

      ---------------------------------------------------------
      -- DELETE HEADER
      ---------------------------------------------------------
      DELETE FROM dbo.InjectProduksi_h
      WHERE NoProduksi = @NoProduksi;
    `;

    const res = await rq.query(sqlDelete);

    // throw notFound jika header tidak ada
    if (res.rowsAffected?.[res.rowsAffected.length - 1] === 0) {
      throw notFound(`NoProduksi tidak ditemukan: ${noProduksi}`);
    }

    await tx.commit();
    return { success: true, noProduksi };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function fetchInputs(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    /* ===================== [1] MAIN INPUTS (UNION) ===================== */

    /* ===== FurnitureWIP (FULL) ===== */
    SELECT
      'fwip' AS Src,
      f.NoProduksi,
      f.NoFurnitureWIP          AS Ref1,
      CAST(NULL AS varchar(50)) AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      fw.Berat AS Berat,
      CAST(NULL AS decimal(18,3)) AS BeratAct,
      fw.IsPartial AS IsPartial,
      fw.IDFurnitureWIP AS IdJenis,
      mcw.Nama          AS NamaJenis,
      CAST(NULL AS varchar(50)) AS NamaUOM,
      fw.Pcs AS Pcs
    FROM dbo.InjectProduksiInputFurnitureWIP f WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = f.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mcw WITH (NOLOCK)
      ON mcw.IdCabinetWIP = fw.IDFurnitureWIP
    WHERE f.NoProduksi = @no

    UNION ALL

    /* ===== Broker (FULL) ===== */
    SELECT
      'broker' AS Src,
      b.NoProduksi,
      b.NoBroker AS Ref1,
      b.NoSak    AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      brd.Berat AS Berat,
      CAST(NULL AS decimal(18,3)) AS BeratAct,
      brd.IsPartial AS IsPartial,
      bh.IdJenisPlastik AS IdJenis,
      jp.Jenis          AS NamaJenis,
      CAST(NULL AS varchar(50)) AS NamaUOM,
      CAST(NULL AS int) AS Pcs
    FROM dbo.InjectProduksiInputBroker b WITH (NOLOCK)
    LEFT JOIN dbo.Broker_d brd WITH (NOLOCK)
      ON brd.NoBroker = b.NoBroker AND brd.NoSak = b.NoSak
    LEFT JOIN dbo.Broker_h bh WITH (NOLOCK)
      ON bh.NoBroker = b.NoBroker
    LEFT JOIN dbo.MstJenisPlastik jp WITH (NOLOCK)
      ON jp.IdJenisPlastik = bh.IdJenisPlastik
    WHERE b.NoProduksi = @no

    UNION ALL

    /* ===== Mixer (FULL) ===== */
    SELECT
      'mixer' AS Src,
      m.NoProduksi,
      m.NoMixer AS Ref1,
      m.NoSak   AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      md.Berat AS Berat,
      CAST(NULL AS decimal(18,3)) AS BeratAct,
      md.IsPartial AS IsPartial,
      mh.IdMixer AS IdJenis,
      mm.Jenis   AS NamaJenis,
      CAST(NULL AS varchar(50)) AS NamaUOM,
      CAST(NULL AS int) AS Pcs
    FROM dbo.InjectProduksiInputMixer m WITH (NOLOCK)
    LEFT JOIN dbo.Mixer_d md WITH (NOLOCK)
      ON md.NoMixer = m.NoMixer AND md.NoSak = m.NoSak
    LEFT JOIN dbo.Mixer_h mh WITH (NOLOCK)
      ON mh.NoMixer = m.NoMixer
    LEFT JOIN dbo.MstMixer mm WITH (NOLOCK)
      ON mm.IdMixer = mh.IdMixer
    WHERE m.NoProduksi = @no

    UNION ALL

    /* ===== Gilingan (FULL) ===== */
    SELECT
      'gilingan' AS Src,
      g.NoProduksi,
      g.NoGilingan AS Ref1,
      CAST(NULL AS varchar(50)) AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      gl.Berat AS Berat,
      CAST(NULL AS decimal(18,3)) AS BeratAct,
      gl.IsPartial AS IsPartial,
      gl.IdGilingan    AS IdJenis,
      mg.NamaGilingan  AS NamaJenis,
      CAST(NULL AS varchar(50)) AS NamaUOM,
      CAST(NULL AS int) AS Pcs
    FROM dbo.InjectProduksiInputGilingan g WITH (NOLOCK)
    LEFT JOIN dbo.Gilingan gl WITH (NOLOCK)
      ON gl.NoGilingan = g.NoGilingan
    LEFT JOIN dbo.MstGilingan mg WITH (NOLOCK)
      ON mg.IdGilingan = gl.IdGilingan
    WHERE g.NoProduksi = @no

    UNION ALL

    /* ===== Cabinet Material ===== */
    SELECT
      'material' AS Src,
      cm.NoProduksi,
      CAST(cm.IdCabinetMaterial AS varchar(50)) AS Ref1,
      CAST(NULL AS varchar(50)) AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      CAST(NULL AS decimal(18,3)) AS Berat,
      CAST(NULL AS decimal(18,3)) AS BeratAct,
      CAST(NULL AS bit) AS IsPartial,
      CAST(NULL AS int) AS IdJenis,
      mm.Nama AS NamaJenis,
      uom.NamaUOM AS NamaUOM,
      CAST(cm.Pcs AS int) AS Pcs
    FROM dbo.InjectProduksiInputCabinetMaterial cm WITH (NOLOCK)
    LEFT JOIN dbo.MstCabinetMaterial mm WITH (NOLOCK)
      ON mm.IdCabinetMaterial = cm.IdCabinetMaterial
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mm.IdUOM
    WHERE cm.NoProduksi = @no

    ORDER BY Ref1 DESC, Ref2 ASC;

    /* ===================== [2] PARTIALS ===================== */

    /* ===== FurnitureWIP Partial ===== */
    SELECT
      'fwip' AS Src,
      pmap.NoFurnitureWIPPartial,
      fwp.NoFurnitureWIP,
      fwp.Pcs,
      fw.Berat,
      fw.IDFurnitureWIP AS IdJenis,
      mcw.Nama          AS NamaJenis
    FROM dbo.InjectProduksiInputFurnitureWIPPartial pmap WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIPPartial fwp WITH (NOLOCK)
      ON fwp.NoFurnitureWIPPartial = pmap.NoFurnitureWIPPartial
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = fwp.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mcw WITH (NOLOCK)
      ON mcw.IdCabinetWIP = fw.IDFurnitureWIP
    WHERE pmap.NoProduksi = @no
    ORDER BY pmap.NoFurnitureWIPPartial DESC;

    /* ===== Broker Partial ===== */
    SELECT
      bmap.NoBrokerPartial,
      bdet.NoBroker,
      bdet.NoSak,
      bdet.Berat,
      bh.IdJenisPlastik AS IdJenis,
      jp.Jenis          AS NamaJenis
    FROM dbo.InjectProduksiInputBrokerPartial bmap WITH (NOLOCK)
    LEFT JOIN dbo.BrokerPartial bdet WITH (NOLOCK)
      ON bdet.NoBrokerPartial = bmap.NoBrokerPartial
    LEFT JOIN dbo.Broker_h bh WITH (NOLOCK)
      ON bh.NoBroker = bdet.NoBroker
    LEFT JOIN dbo.MstJenisPlastik jp WITH (NOLOCK)
      ON jp.IdJenisPlastik = bh.IdJenisPlastik
    WHERE bmap.NoProduksi = @no
    ORDER BY bmap.NoBrokerPartial DESC;

    /* ===== Mixer Partial ===== */
    SELECT
      mmap.NoMixerPartial,
      mdet.NoMixer,
      mdet.NoSak,
      mdet.Berat,
      mh.IdMixer AS IdJenis,
      mm.Jenis   AS NamaJenis
    FROM dbo.InjectProduksiInputMixerPartial mmap WITH (NOLOCK)
    LEFT JOIN dbo.MixerPartial mdet WITH (NOLOCK)
      ON mdet.NoMixerPartial = mmap.NoMixerPartial
    LEFT JOIN dbo.Mixer_h mh WITH (NOLOCK)
      ON mh.NoMixer = mdet.NoMixer
    LEFT JOIN dbo.MstMixer mm WITH (NOLOCK)
      ON mm.IdMixer = mh.IdMixer
    WHERE mmap.NoProduksi = @no
    ORDER BY mmap.NoMixerPartial DESC;

    /* ===== Gilingan Partial ===== */
    SELECT
      gmap.NoGilinganPartial,
      gdet.NoGilingan,
      gdet.Berat,
      gh.IdGilingan   AS IdJenis,
      mg.NamaGilingan AS NamaJenis
    FROM dbo.InjectProduksiInputGilinganPartial gmap WITH (NOLOCK)
    LEFT JOIN dbo.GilinganPartial gdet WITH (NOLOCK)
      ON gdet.NoGilinganPartial = gmap.NoGilinganPartial
    LEFT JOIN dbo.Gilingan gh WITH (NOLOCK)
      ON gh.NoGilingan = gdet.NoGilingan
    LEFT JOIN dbo.MstGilingan mg WITH (NOLOCK)
      ON mg.IdGilingan = gh.IdGilingan
    WHERE gmap.NoProduksi = @no
    ORDER BY gmap.NoGilinganPartial DESC;
  `;

  const rs = await req.query(q);

  const mainRows = rs.recordsets?.[0] || [];
  const fwipPart = rs.recordsets?.[1] || [];
  const brokerPart = rs.recordsets?.[2] || [];
  const mixerPart = rs.recordsets?.[3] || [];
  const gilingPart = rs.recordsets?.[4] || [];

  const out = {
    furnitureWip: [],
    broker: [],
    mixer: [],
    gilingan: [],
    cabinetMaterial: [],
    summary: {
      furnitureWip: 0,
      broker: 0,
      mixer: 0,
      gilingan: 0,
      cabinetMaterial: 0,
    },
  };

  // ================= MAIN ROWS =================
  for (const r of mainRows) {
    const base = {
      berat: r.Berat ?? null,
      beratAct: r.BeratAct ?? null,
      isPartial: r.IsPartial ?? null,
      idJenis: r.IdJenis ?? null,
      namaJenis: r.NamaJenis ?? null,
    };

    switch (r.Src) {
      case "fwip":
        out.furnitureWip.push({
          noFurnitureWip: r.Ref1,
          pcs: r.Pcs ?? null,
          ...base,
        });
        break;

      case "broker":
        out.broker.push({
          noBroker: r.Ref1,
          noSak: r.Ref2,
          ...base,
        });
        break;

      case "mixer":
        out.mixer.push({
          noMixer: r.Ref1,
          noSak: r.Ref2,
          ...base,
        });
        break;

      case "gilingan":
        out.gilingan.push({
          noGilingan: r.Ref1,
          ...base,
        });
        break;

      case "material":
        out.cabinetMaterial.push({
          idCabinetMaterial: r.Ref1, // kalau mau int: Number(r.Ref1)
          pcs: r.Pcs ?? null,
          namaJenis: r.NamaJenis ?? null,
          namaUom: r.NamaUOM ?? null,
        });
        break;
    }
  }

  // ================= PARTIAL ROWS =================

  // FWIP partial
  for (const p of fwipPart) {
    out.furnitureWip.push({
      noFurnitureWipPartial: p.NoFurnitureWIPPartial,
      noFurnitureWip: p.NoFurnitureWIP ?? null,
      pcs: p.Pcs ?? null,
      berat: p.Berat ?? null,
      idJenis: p.IdJenis ?? null,
      namaJenis: p.NamaJenis ?? null,
    });
  }

  // Broker partial
  for (const p of brokerPart) {
    out.broker.push({
      noBrokerPartial: p.NoBrokerPartial,
      noBroker: p.NoBroker ?? null,
      noSak: p.NoSak ?? null,
      berat: p.Berat ?? null,
      idJenis: p.IdJenis ?? null,
      namaJenis: p.NamaJenis ?? null,
    });
  }

  // Mixer partial
  for (const p of mixerPart) {
    out.mixer.push({
      noMixerPartial: p.NoMixerPartial,
      noMixer: p.NoMixer ?? null,
      noSak: p.NoSak ?? null,
      berat: p.Berat ?? null,
      idJenis: p.IdJenis ?? null,
      namaJenis: p.NamaJenis ?? null,
    });
  }

  // Gilingan partial
  for (const p of gilingPart) {
    out.gilingan.push({
      noGilinganPartial: p.NoGilinganPartial,
      noGilingan: p.NoGilingan ?? null,
      berat: p.Berat ?? null,
      idJenis: p.IdJenis ?? null,
      namaJenis: p.NamaJenis ?? null,
    });
  }

  // ================= SUMMARY =================
  out.summary.furnitureWip = out.furnitureWip.length;
  out.summary.broker = out.broker.length;
  out.summary.mixer = out.mixer.length;
  out.summary.gilingan = out.gilingan.length;
  out.summary.cabinetMaterial = out.cabinetMaterial.length;

  return out;
}

async function fetchOutputs(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    SELECT DISTINCT
      o.NoProduksi,
      o.NoFurnitureWIP,
      fw.IDFurnitureWIP AS IdJenis,
      cw.Nama           AS NamaJenis,
      ISNULL(fw.HasBeenPrinted, 0) AS HasBeenPrinted,
      fw.Berat,
      fw.Pcs
    FROM dbo.InjectProduksiOutputFurnitureWIP o WITH (NOLOCK)
    INNER JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = o.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
      ON cw.IdCabinetWIP = fw.IDFurnitureWIP
    WHERE o.NoProduksi = @no
    ORDER BY o.NoFurnitureWIP DESC;
  `;

  const rs = await req.query(q);
  const rows = rs.recordset || [];
  return rows.map((r) => ({
    NoProduksi: r.NoProduksi,
    NoFurnitureWIP: r.NoFurnitureWIP,
    IdJenis: r.IdJenis ?? null,
    NamaJenis: r.NamaJenis ?? null,
    HasBeenPrinted: r.HasBeenPrinted ?? 0,
    Berat: r.Berat ?? null,
    Pcs: r.Pcs ?? null,
  }));
}

async function fetchOutputsBonggolan(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    SELECT DISTINCT
      o.NoProduksi,
      o.NoBonggolan,
      b.IdBonggolan,
      mb.NamaBonggolan,
      b.Berat,
      ISNULL(b.HasBeenPrinted, 0) AS HasBeenPrinted
    FROM dbo.InjectProduksiOutputBonggolan o WITH (NOLOCK)
    LEFT JOIN dbo.Bonggolan b WITH (NOLOCK)
      ON b.NoBonggolan = o.NoBonggolan
    LEFT JOIN dbo.MstBonggolan mb WITH (NOLOCK)
      ON mb.IdBonggolan = b.IdBonggolan
    WHERE o.NoProduksi = @no
    ORDER BY o.NoBonggolan DESC;
  `;

  const rs = await req.query(q);
  return rs.recordset || [];
}

async function fetchOutputsFurnitureWip(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    SELECT DISTINCT
      o.NoProduksi,
      o.NoFurnitureWIP,
      ISNULL(fw.HasBeenPrinted, 0) AS HasBeenPrinted
    FROM dbo.InjectProduksiOutputFurnitureWIP o WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = o.NoFurnitureWIP
    WHERE o.NoProduksi = @no
    ORDER BY o.NoFurnitureWIP DESC;
  `;

  const rs = await req.query(q);
  return rs.recordset || [];
}

async function fetchOutputsPacking(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    SELECT DISTINCT
      o.NoProduksi,
      o.NoBJ,
      bj.IdBJ AS IdJenis,
      mbj.NamaBJ AS NamaJenis,
      ISNULL(bj.HasBeenPrinted, 0) AS HasBeenPrinted,
      bj.Pcs
    FROM dbo.InjectProduksiOutputBarangJadi o WITH (NOLOCK)
    INNER JOIN dbo.BarangJadi bj WITH (NOLOCK)
      ON bj.NoBJ = o.NoBJ
    LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
      ON mbj.IdBJ = bj.IdBJ
    WHERE o.NoProduksi = @no
    ORDER BY o.NoBJ DESC;
  `;

  const rs = await req.query(q);
  const rows = rs.recordset || [];
  return rows.map((r) => ({
    NoProduksi: r.NoProduksi,
    NoBJ: r.NoBJ,
    IdJenis: r.IdJenis ?? null,
    NamaJenis: r.NamaJenis ?? null,
    HasBeenPrinted: r.HasBeenPrinted ?? 0,
    Pcs: r.Pcs ?? null,
  }));
}

async function fetchOutputsReject(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    WITH RejectPartialAgg AS (
      SELECT
        NoReject,
        SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
      FROM dbo.RejectV2Partial
      GROUP BY NoReject
    )
    SELECT DISTINCT
      o.NoProduksi,
      o.NoReject,
      rj.IdReject AS IdJenis,
      mr.NamaReject AS NamaJenis,
      ISNULL(CAST(rj.HasBeenPrinted AS int), 0) AS HasBeenPrinted,
      CASE
        WHEN ISNULL(rj.Berat, 0) - ISNULL(rp.TotalPartialBerat, 0) < 0
          THEN 0
        ELSE ISNULL(rj.Berat, 0) - ISNULL(rp.TotalPartialBerat, 0)
      END AS Berat,
      CAST(NULL AS int) AS Pcs
    FROM dbo.InjectProduksiOutputRejectV2 o WITH (NOLOCK)
    LEFT JOIN dbo.RejectV2 rj WITH (NOLOCK)
      ON rj.NoReject = o.NoReject
    LEFT JOIN dbo.MstReject mr WITH (NOLOCK)
      ON mr.IdReject = rj.IdReject
    LEFT JOIN RejectPartialAgg rp
      ON rp.NoReject = rj.NoReject
    WHERE o.NoProduksi = @no
    ORDER BY o.NoReject DESC;
  `;

  const rs = await req.query(q);
  const rows = rs.recordset || [];
  return rows.map((r) => ({
    NoProduksi: r.NoProduksi,
    NoReject: r.NoReject,
    IdJenis: r.IdJenis ?? null,
    NamaJenis: r.NamaJenis ?? null,
    HasBeenPrinted: r.HasBeenPrinted ?? 0,
    Berat: r.Berat ?? null,
    Pcs: r.Pcs ?? null,
  }));
}

function getInjectInputCategoryCodeByPrefix(prefix) {
  switch (String(prefix || "").toUpperCase()) {
    case "BB.":
      return "furniturewip";
    case "D.":
      return "broker";
    case "H.":
      return "mixer";
    case "V.":
      return "gilingan";
    default:
      return null;
  }
}

async function validateLabel(labelCode) {
  const pool = await poolPromise;

  // ---------- helpers ----------
  const toCamel = (s) => {
    if (!s) return s;
    let out = s.replace(/[_-]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
    out = out.charAt(0).toLowerCase() + out.slice(1);
    return out;
  };

  const camelize = (val) => {
    if (Array.isArray(val)) return val.map(camelize);
    if (val && typeof val === "object") {
      const o = {};
      for (const [k, v] of Object.entries(val)) o[toCamel(k)] = camelize(v);
      return o;
    }
    return val;
  };

  // ---------- normalize label ----------
  const raw = String(labelCode || "").trim();
  if (!raw) throw new Error("Label code is required");

  // prefix rule: untuk BF. (3 char), lainnya 2 char (mis: D., H., V., BB.)
  let prefix = "";
  const prefix3 = raw.substring(0, 3).toUpperCase();
  if (["BA.", "BB.", "BF.", "BL."].includes(prefix3)) prefix = prefix3;
  else prefix = raw.substring(0, 2).toUpperCase();

  let query = "";
  let tableName = "";

  async function run(label) {
    const req = pool.request();
    req.input("labelCode", sql.VarChar(50), label);
    const rs = await req.query(query);
    const rows = rs.recordset || [];
    return camelize({
      found: rows.length > 0,
      count: rows.length,
      prefix,
      tableName,
      data: rows,
    });
  }

  switch (prefix) {
    // =========================================================
    // BB. = FurnitureWIP / FurnitureWIPPartial (Inject pakai ini juga)
    // =========================================================
    case "BB.": {
      // 1) coba FULL dulu: FurnitureWIP.NoFurnitureWIP (DateUsage IS NULL)
      {
        tableName = "FurnitureWIP";
        query = `
        ;WITH PartialSum AS (
          SELECT
            fwp.NoFurnitureWIP,
            SUM(ISNULL(fwp.Pcs, 0)) AS PcsPartial
          FROM dbo.FurnitureWIPPartial AS fwp WITH (NOLOCK)
          GROUP BY fwp.NoFurnitureWIP
        )
        SELECT
          fw.NoFurnitureWIP,
          fw.DateCreate,
          fw.Jam,
          CAST(fw.Pcs - ISNULL(ps.PcsPartial, 0) AS int) AS Pcs,          -- ✅ sisa pcs
          fw.IDFurnitureWIP AS idJenis,
          mcw.Nama          AS namaJenis,
          fw.Berat,
          fw.IsPartial,
          fw.DateUsage,
          fw.IdWarehouse,
          fw.IdWarna,
          fw.CreateBy,
          fw.DateTimeCreate,
          fw.Blok,
          fw.IdLokasi,
          ISNULL(ps.PcsPartial, 0) AS PcsPartial                          -- (opsional) buat debug
        FROM dbo.FurnitureWIP fw WITH (NOLOCK)
        LEFT JOIN PartialSum ps
          ON ps.NoFurnitureWIP = fw.NoFurnitureWIP
        LEFT JOIN dbo.MstCabinetWIP mcw WITH (NOLOCK)
          ON mcw.IdCabinetWIP = fw.IDFurnitureWIP
        WHERE fw.NoFurnitureWIP = @labelCode
          AND fw.DateUsage IS NULL
          AND (fw.Pcs - ISNULL(ps.PcsPartial, 0)) > 0                     -- ✅ masih ada sisa
        ;
        `;
        const full = await run(raw);
        if (full.found) return full;
      }

      // 2) kalau tidak ketemu full, coba PARTIAL: FurnitureWIPPartial.NoFurnitureWIPPartial
      {
        tableName = "FurnitureWIPPartial";
        query = `
          SELECT
            fwp.NoFurnitureWIPPartial,
            fwp.NoFurnitureWIP,
            fwp.Pcs AS pcsPartial,

            fw.DateCreate,
            fw.Jam,
            fw.Pcs AS pcsHeader,
            fw.IDFurnitureWIP AS idJenis,
            mcw.Nama          AS namaJenis,
            fw.Berat,
            fw.IsPartial,
            fw.DateUsage,
            fw.IdWarehouse,
            fw.IdWarna,
            fw.CreateBy,
            fw.DateTimeCreate,
            fw.Blok,
            fw.IdLokasi
          FROM dbo.FurnitureWIPPartial fwp WITH (NOLOCK)
          JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
            ON fw.NoFurnitureWIP = fwp.NoFurnitureWIP
          LEFT JOIN dbo.MstCabinetWIP mcw WITH (NOLOCK)
            ON mcw.IdCabinetWIP = fw.IDFurnitureWIP
          WHERE fwp.NoFurnitureWIPPartial = @labelCode
            AND fw.DateUsage IS NULL;
        `;
        return await run(raw);
      }
    }

    // =========================================================
    // D. = Broker_d (sisa berat = Berat - SUM(BrokerPartial))
    // =========================================================
    case "D.": {
      tableName = "Broker_d";
      query = `
        ;WITH PartialSum AS (
          SELECT
            bp.NoBroker,
            bp.NoSak,
            SUM(ISNULL(bp.Berat, 0)) AS BeratPartial
          FROM dbo.BrokerPartial AS bp WITH (NOLOCK)
          GROUP BY bp.NoBroker, bp.NoSak
        )
        SELECT
          d.NoBroker AS noBroker,
          d.NoSak    AS noSak,
          CAST(d.Berat - ISNULL(ps.BeratPartial, 0) AS DECIMAL(18,2)) AS berat,
          d.DateUsage AS dateUsage,
          CASE WHEN ISNULL(ps.BeratPartial, 0) > 0 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isPartial,
          h.IdJenisPlastik AS idJenis,
          jp.Jenis         AS namaJenis
        FROM dbo.Broker_d AS d WITH (NOLOCK)
        LEFT JOIN PartialSum AS ps
          ON ps.NoBroker = d.NoBroker AND ps.NoSak = d.NoSak
        LEFT JOIN dbo.Broker_h AS h WITH (NOLOCK)
          ON h.NoBroker = d.NoBroker
        LEFT JOIN dbo.MstJenisPlastik AS jp WITH (NOLOCK)
          ON jp.IdJenisPlastik = h.IdJenisPlastik
        WHERE d.NoBroker = @labelCode
          AND d.DateUsage IS NULL
          AND (d.Berat - ISNULL(ps.BeratPartial, 0)) > 0
        ORDER BY d.NoBroker, d.NoSak;
      `;
      return await run(raw);
    }

    // =========================================================
    // H. = Mixer_d (sisa berat = Berat - SUM(MixerPartial))
    // =========================================================
    case "H.": {
      tableName = "Mixer_d";
      query = `
        ;WITH PartialSum AS (
          SELECT
            mp.NoMixer,
            mp.NoSak,
            SUM(ISNULL(mp.Berat, 0)) AS BeratPartial
          FROM dbo.MixerPartial AS mp WITH (NOLOCK)
          GROUP BY mp.NoMixer, mp.NoSak
        )
        SELECT
          d.NoMixer AS noMixer,
          d.NoSak   AS noSak,
          CAST(d.Berat - ISNULL(ps.BeratPartial, 0) AS DECIMAL(18,2)) AS berat,
          d.DateUsage AS dateUsage,
          CASE WHEN ISNULL(ps.BeratPartial, 0) > 0 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS isPartial,
          d.IdLokasi AS idLokasi,
          h.IdMixer  AS idJenis,
          mm.Jenis   AS namaJenis
        FROM dbo.Mixer_d AS d WITH (NOLOCK)
        LEFT JOIN PartialSum AS ps
          ON ps.NoMixer = d.NoMixer AND ps.NoSak = d.NoSak
        LEFT JOIN dbo.Mixer_h AS h WITH (NOLOCK)
          ON h.NoMixer = d.NoMixer
        LEFT JOIN dbo.MstMixer AS mm WITH (NOLOCK)
          ON mm.IdMixer = h.IdMixer
        WHERE d.NoMixer = @labelCode
          AND d.DateUsage IS NULL
          AND (d.Berat - ISNULL(ps.BeratPartial, 0)) > 0
        ORDER BY d.NoMixer, d.NoSak;
      `;
      return await run(raw);
    }

    // =========================================================
    // V. = Gilingan (sisa berat = Berat - SUM(GilinganPartial))
    // =========================================================
    case "V.": {
      tableName = "Gilingan";
      query = `
        ;WITH PartialAgg AS (
          SELECT gp.NoGilingan, SUM(ISNULL(gp.Berat, 0)) AS PartialBerat
          FROM dbo.GilinganPartial AS gp WITH (NOLOCK)
          GROUP BY gp.NoGilingan
        )
        SELECT
          g.NoGilingan,
          g.DateCreate,
          g.IdGilingan AS idJenis,
          mg.NamaGilingan AS namaJenis,
          g.DateUsage,
          Berat = CASE
                    WHEN g.Berat - ISNULL(pa.PartialBerat, 0) < 0 THEN 0
                    ELSE g.Berat - ISNULL(pa.PartialBerat, 0)
                  END,
          g.IsPartial AS isPartial
        FROM dbo.Gilingan AS g WITH (NOLOCK)
        LEFT JOIN PartialAgg AS pa ON pa.NoGilingan = g.NoGilingan
        LEFT JOIN dbo.MstGilingan AS mg WITH (NOLOCK)
          ON mg.IdGilingan = g.IdGilingan
        WHERE g.NoGilingan = @labelCode
          AND g.DateUsage IS NULL
        ORDER BY g.NoGilingan;
      `;
      return await run(raw);
    }

    default:
      throw new Error(
        `Invalid prefix: ${prefix}. Valid prefixes (Inject): BB., D., H., V.`,
      );
  }
}

async function validateInputLabelForNoProduksi(noProduksi, labelCode) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  let labelInfo;
  try {
    labelInfo = await validateLabel(labelCode);
  } catch (error) {
    if (/^Invalid prefix:/i.test(String(error?.message || ""))) {
      return {
        noProduksi: no,
        labelCode: String(labelCode || "").trim(),
        valid: false,
        reason: "Kategori label ini tidak didukung sebagai input inject",
        formulaMatch: null,
        label: null,
        output: null,
      };
    }
    throw error;
  }
  if (
    !labelInfo?.found ||
    !Array.isArray(labelInfo.data) ||
    !labelInfo.data[0]
  ) {
    return {
      noProduksi: no,
      labelCode: String(labelCode || "").trim(),
      valid: false,
      reason:
        "Label tidak ditemukan, sudah terpakai, atau tidak punya sisa quantity",
      formulaMatch: null,
      labelInfo,
    };
  }

  const formulaInfo = await getFormulaInputsByNoProduksi(no);
  const categoryCode = getInjectInputCategoryCodeByPrefix(labelInfo.prefix);
  if (!categoryCode) {
    return {
      noProduksi: no,
      labelCode: String(labelCode || "").trim(),
      valid: false,
      reason: `Prefix ${labelInfo.prefix} tidak didukung sebagai input inject`,
      formulaMatch: null,
      labelInfo,
      formulaInfo,
    };
  }

  const pool = await poolPromise;
  const kategoriRes = await pool
    .request()
    .input("KodeKategori", sql.VarChar(50), categoryCode).query(`
      SELECT TOP 1 IdKategori, KodeKategori, NamaKategori
      FROM dbo.MstKategori WITH (NOLOCK)
      WHERE LOWER(KodeKategori) = LOWER(@KodeKategori)
        AND ISNULL(Enable, 1) = 1;
    `);
  const kategori = kategoriRes.recordset?.[0] || null;

  const firstRow = labelInfo.data[0] || {};
  const inputId = Number(firstRow.idJenis);

  if (!kategori || !Number.isFinite(inputId) || inputId <= 0) {
    return {
      noProduksi: no,
      labelCode: String(labelCode || "").trim(),
      valid: false,
      reason: "Gagal menentukan kategori atau inputId dari label",
      formulaMatch: null,
      labelInfo,
      formulaInfo,
    };
  }

  const formulaMatch = Array.isArray(formulaInfo.formulas)
    ? formulaInfo.formulas.find(
        (row) =>
          Number(row.InputKategoriId) === Number(kategori.IdKategori) &&
          Number(row.InputId) === inputId,
      ) || null
    : null;

  return {
    noProduksi: no,
    labelCode: String(labelCode || "").trim(),
    valid: Boolean(formulaMatch),
    reason: formulaMatch
      ? "Label valid untuk NoProduksi ini"
      : "Label tidak termasuk formula input yang diizinkan untuk NoProduksi ini",
    formulaMatch: formulaMatch
      ? {
          idFormula: formulaMatch.IdFormula,
          inputKategoriId: formulaMatch.InputKategoriId,
          inputKategoriKode: formulaMatch.InputKategoriKode,
          inputKategoriNama: formulaMatch.InputKategoriNama,
          inputId: formulaMatch.InputId,
        }
      : null,
    label: {
      prefix: labelInfo.prefix,
      tableName: labelInfo.tableName,
      categoryId: kategori.IdKategori,
      categoryKode: kategori.KodeKategori,
      categoryNama: kategori.NamaKategori,
      inputId,
      namaJenis: firstRow.namaJenis ?? null,
      rawData: firstRow,
    },
    output: {
      category: formulaInfo.outputCategory ?? null,
      categoryId: formulaInfo.outputCategoryId ?? null,
      categoryKode: formulaInfo.outputCategoryKode ?? null,
      categoryNama: formulaInfo.outputCategoryNama ?? null,
      outputs: formulaInfo.outputs ?? [],
    },
  };
}

/**
 * Single entry: create NEW partials + link them, and attach EXISTING inputs.
 * All in one transaction.
 *
 * Payload shape (arrays optional):
 * {
 *   // existing inputs to attach
 *   broker:   [{ noBroker, noSak }],
 *   mixer:    [{ noMixer, noSak }],
 *   gilingan: [{ noGilingan }],
 *
 *   // NEW partials to create + map
 *   brokerPartialNew:   [{ noBroker, noSak, berat }],
 *   mixerPartialNew:    [{ noMixer, noSak, berat }],
 *   gilinganPartialNew: [{ noGilingan, berat }]
 * }
 */
/**
 * ✅ Upsert inputs & partials untuk Inject Production dengan audit context
 * Support: broker, mixer, gilingan, furnitureWip, cabinetMaterial (UPSERT)
 * Support: partials (existing + new)
 */
async function upsertInputsAndPartials(noProduksi, payload, ctx) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib diisi");

  const body = payload && typeof payload === "object" ? payload : {};

  // ✅ ctx wajib (audit)
  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }

  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";

  // requestId wajib string (kalau kosong, nanti di applyAuditContext dibuat fallback juga)
  const requestId = String(ctx?.requestId || "").trim();

  // ✅ forward ctx yang sudah dinormalisasi ke shared service
  return sharedInputService.upsertInputsAndPartials(
    "injectProduksi",
    no,
    body,
    {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    },
  );
}

async function deleteInputsAndPartials(noProduksi, payload, ctx) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib diisi");

  const body = payload && typeof payload === "object" ? payload : {};

  // ✅ Validate audit context
  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }

  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  // ✅ Forward to shared service
  return sharedInputService.deleteInputsAndPartials(
    "injectProduksi",
    no,
    body,
    {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    },
  );
}

async function splitProduksiTime(selector, payload, ctx) {
  const idMesin = Number(selector?.idMesin);
  const tanggal = String(selector?.tanggal || "").trim();
  if (!Number.isInteger(idMesin) || idMesin <= 0) {
    throw badReq("idMesin harus integer positif");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    throw badReq("tanggal harus format YYYY-MM-DD");
  }

  const hourStart = String(payload?.hourStart || "").trim();
  const idCetakan = Number(payload?.idCetakan);
  const idWarna = Number(payload?.idWarna);
  const idFurnitureMaterialRaw = payload?.idFurnitureMaterial;
  const idFurnitureMaterial =
    idFurnitureMaterialRaw === null ||
    idFurnitureMaterialRaw === undefined ||
    idFurnitureMaterialRaw === ""
      ? null
      : Number(idFurnitureMaterialRaw);

  if (!hourStart) throw badReq("hourStart wajib diisi");
  if (!Number.isInteger(idCetakan) || idCetakan <= 0) {
    throw badReq("idCetakan wajib integer positif");
  }
  if (!Number.isInteger(idWarna) || idWarna <= 0) {
    throw badReq("idWarna wajib integer positif");
  }
  if (
    idFurnitureMaterial != null &&
    (!Number.isInteger(idFurnitureMaterial) || idFurnitureMaterial <= 0)
  ) {
    throw badReq("idFurnitureMaterial harus integer positif bila diisi");
  }

  const toSeconds = (hhmmss) => {
    const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      String(hhmmss || "").trim(),
    );
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3] || "0");
    if (hh > 23 || mm > 59 || ss > 59) return null;
    return hh * 3600 + mm * 60 + ss;
  };
  const normalizeTimeValue = (v) => {
    if (v == null) return null;
    if (v instanceof Date) {
      const hh = String(v.getUTCHours()).padStart(2, "0");
      const mm = String(v.getUTCMinutes()).padStart(2, "0");
      const ss = String(v.getUTCSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    const s = String(v).trim();
    const m = /(\d{2}):(\d{2}):(\d{2})/.exec(s);
    return m ? `${m[1]}:${m[2]}:${m[3]}` : null;
  };
  const reqStartSec = toSeconds(hourStart);
  if (reqStartSec == null) {
    throw badReq("Format hourStart harus HH:mm atau HH:mm:ss");
  }
  const normalizeIntoShiftWindow = (sec, shiftStartSec, shiftEndSec) => {
    const isOvernight = shiftStartSec > shiftEndSec;
    if (!isOvernight) return sec;
    return sec < shiftStartSec ? sec + 86400 : sec;
  };

  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    await applyAuditContext(new sql.Request(tx), {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    });

    const comboRes = await new sql.Request(tx)
      .input("IdCetakan", sql.Int, idCetakan)
      .input("IdWarna", sql.Int, idWarna)
      .input("IdFurnitureMaterial", sql.Int, idFurnitureMaterial).query(`
        SELECT TOP 1 1 AS Found
        FROM dbo.CetakanWarna_h WITH (NOLOCK)
        WHERE IdCetakan = @IdCetakan
          AND IdWarna = @IdWarna
          AND (
            (@IdFurnitureMaterial IS NULL AND IdFurnitureMaterial IS NULL)
            OR IdFurnitureMaterial = @IdFurnitureMaterial
          );
      `);
    if (!comboRes.recordset?.length) {
      throw badReq(
        "Cetakan, warna, dan material tidak valid atau belum terdaftar di master cetakan warna material.",
      );
    }

    const srcRes = await new sql.Request(tx)
      .input("IdMesin", sql.Int, idMesin)
      .input("Tanggal", sql.Date, tanggal).query(`
        SELECT TOP 1 *
        FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin
          AND CONVERT(date, TglProduksi) = @Tanggal
        ORDER BY HourStart DESC, NoProduksi DESC
      `);

    const src = srcRes.recordset?.[0];
    if (!src) {
      throw notFound(
        `Produksi inject tidak ditemukan untuk idMesin ${idMesin} dan tanggal ${tanggal}`,
      );
    }

    const sourceNo = String(src.NoProduksi || "").trim();
    if (!sourceNo) throw conflict("Data produksi terakhir tidak valid");
    const srcShift = Number(src.Shift);
    if (!Number.isInteger(srcShift) || srcShift <= 0) {
      throw conflict(
        `Data shift produksi sumber tidak valid pada ${sourceNo}.`,
      );
    }

    const shiftRefRes = await new sql.Request(tx)
      .input("Tanggal", sql.Date, tanggal)
      .input("NoShift", sql.Int, srcShift).query(`
        ;WITH LatestShiftSet AS (
          SELECT TOP 1
            h.IdShiftHourSet,
            h.ValidFrmDate
          FROM dbo.MstShiftHourSet h WITH (NOLOCK)
          WHERE CONVERT(date, h.ValidFrmDate) <= @Tanggal
          ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
        )
        SELECT TOP 1
          ls.IdShiftHourSet,
          ls.ValidFrmDate,
          d.NoShift,
          CONVERT(varchar(8), d.HourStart, 108) AS HourStart,
          CONVERT(varchar(8), d.HourEnd, 108) AS HourEnd
        FROM LatestShiftSet ls
        INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
          ON d.IdShiftHourSet = ls.IdShiftHourSet
        WHERE d.NoShift = @NoShift;
      `);

    const shiftRef = shiftRefRes.recordset?.[0];
    if (!shiftRef) {
      throw notFound(
        `Master shift tidak ditemukan untuk tanggal ${tanggal} dan shift ${srcShift}.`,
      );
    }

    const shiftStartSec = toSeconds(shiftRef.HourStart);
    const hourEnd = String(shiftRef.HourEnd || "").trim();
    const shiftEndSec = toSeconds(hourEnd);
    if (shiftStartSec == null || shiftEndSec == null) {
      throw conflict("Master shift memiliki HourStart/HourEnd tidak valid.");
    }

    const reqStartInWindow = normalizeIntoShiftWindow(
      reqStartSec,
      shiftStartSec,
      shiftEndSec,
    );
    const reqEndInWindow = normalizeIntoShiftWindow(
      shiftEndSec,
      shiftStartSec,
      shiftEndSec,
    );
    const shiftEndBound =
      shiftStartSec > shiftEndSec ? shiftEndSec + 86400 : shiftEndSec;

    if (
      reqStartInWindow < shiftStartSec ||
      reqStartInWindow > shiftEndBound ||
      reqEndInWindow < shiftStartSec ||
      reqEndInWindow > shiftEndBound
    ) {
      throw badReq(
        `Range jam harus berada dalam batas shift ${srcShift} (${shiftRef.HourStart}-${shiftRef.HourEnd}) untuk tanggal ${tanggal}.`,
      );
    }
    if (reqEndInWindow <= reqStartInWindow) {
      throw badReq(
        "hourEnd harus lebih besar dari hourStart dalam rentang shift yang sama",
      );
    }

    const srcHourStartStr = normalizeTimeValue(src.HourStart);
    const srcStartSec = toSeconds(srcHourStartStr);
    const srcHourEndStr = normalizeTimeValue(src.HourEnd);
    const srcEndSec = toSeconds(srcHourEndStr);
    if (srcStartSec == null || srcEndSec == null) {
      throw conflict(
        `Data jam produksi sumber tidak valid pada ${sourceNo} (HourStart/HourEnd).`,
      );
    }
    const reqStartInSource = normalizeIntoShiftWindow(
      reqStartSec,
      srcStartSec,
      srcEndSec,
    );
    if (reqStartInSource <= srcStartSec) {
      throw badReq(`Jam Mulai harus lebih besar dari ${srcHourStartStr}.`);
    }

    const duplicateRes = await new sql.Request(tx)
      .input("IdMesin", sql.Int, idMesin)
      .input("Tanggal", sql.Date, tanggal)
      .input("HourStart", sql.VarChar(20), hourStart)
      .input("HourEnd", sql.VarChar(20), hourEnd).query(`
        SELECT TOP 1 NoProduksi
        FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin
          AND CONVERT(date, TglProduksi) = @Tanggal
          AND HourStart = CAST(@HourStart AS time(7))
          AND HourEnd = CAST(@HourEnd AS time(7))
        ORDER BY NoProduksi DESC
      `);
    if (duplicateRes.recordset?.length) {
      const existingNo = duplicateRes.recordset[0].NoProduksi;
      throw conflict(
        `Rentang waktu ${hourStart}-${hourEnd} sudah ada pada produksi ${existingNo}.`,
      );
    }

    const docDateOnly = toDateOnly(src.TglProduksi);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: `split time InjectProduksi ${sourceNo}`,
      useLock: true,
    });

    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.InjectProduksi_h",
        columnName: "NoProduksi",
        prefix: "S.",
        width: 10,
      });

    let newNoProduksi = await gen();
    const exists = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      newNoProduksi,
    ).query(`
        SELECT 1 FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoProduksi = @NoProduksi
      `);
    if (exists.recordset.length > 0) {
      const retry = await gen();
      const exists2 = await new sql.Request(tx).input(
        "NoProduksi",
        sql.VarChar(50),
        retry,
      ).query(`
          SELECT 1 FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
          WHERE NoProduksi = @NoProduksi
        `);
      if (exists2.recordset.length > 0) {
        throw conflict("Gagal generate NoProduksi unik, coba lagi.");
      }
      newNoProduksi = retry;
    }

    const insReq = new sql.Request(tx);
    insReq
      .input("NewNoProduksi", sql.VarChar(50), newNoProduksi)
      .input("SourceNoProduksi", sql.VarChar(50), sourceNo)
      .input("NewHourStart", sql.VarChar(20), hourStart)
      .input("NewHourEnd", sql.VarChar(20), hourEnd)
      .input("IdCetakan", sql.Int, idCetakan)
      .input("IdWarna", sql.Int, idWarna)
      .input("IdFurnitureMaterial", sql.Int, idFurnitureMaterial);

    const insertRes = await insReq.query(`
      DECLARE @out TABLE (
        NoProduksi varchar(50),
        IdMesin int,
        TglProduksi date,
        Jam int,
        Shift int,
        CreateBy varchar(100),
        CheckBy1 varchar(100),
        CheckBy2 varchar(100),
        ApproveBy varchar(100),
        JmlhAnggota int,
        Hadir int,
        IdCetakan int,
        IdWarna int,
        EnableOffset bit,
        OffsetCurrent int,
        OffsetNext int,
        IdFurnitureMaterial int,
        HourMeter decimal(18,2),
        BeratProdukHasilTimbang decimal(18,2),
        HourStart time(7),
        HourEnd time(7),
        IdRegu int
      );

      INSERT INTO dbo.InjectProduksi_h (
        NoProduksi, IdMesin, TglProduksi, Jam, Shift, CreateBy,
        CheckBy1, CheckBy2, ApproveBy, JmlhAnggota, Hadir,
        IdCetakan, IdWarna, EnableOffset, OffsetCurrent, OffsetNext,
        IdFurnitureMaterial, HourMeter, BeratProdukHasilTimbang,
        HourStart, HourEnd, IdRegu
      )
      OUTPUT
        INSERTED.NoProduksi, INSERTED.IdMesin, INSERTED.TglProduksi, INSERTED.Jam,
        INSERTED.Shift, INSERTED.CreateBy, INSERTED.CheckBy1, INSERTED.CheckBy2,
        INSERTED.ApproveBy, INSERTED.JmlhAnggota, INSERTED.Hadir, INSERTED.IdCetakan,
        INSERTED.IdWarna, INSERTED.EnableOffset, INSERTED.OffsetCurrent, INSERTED.OffsetNext,
        INSERTED.IdFurnitureMaterial, INSERTED.HourMeter, INSERTED.BeratProdukHasilTimbang,
        INSERTED.HourStart, INSERTED.HourEnd, INSERTED.IdRegu
      INTO @out
      SELECT
        @NewNoProduksi,
        h.IdMesin,
        h.TglProduksi,
        h.Jam,
        h.Shift,
        h.CreateBy,
        h.CheckBy1,
        h.CheckBy2,
        h.ApproveBy,
        h.JmlhAnggota,
        h.Hadir,
        @IdCetakan,
        @IdWarna,
        h.EnableOffset,
        h.OffsetCurrent,
        h.OffsetNext,
        @IdFurnitureMaterial,
        h.HourMeter,
        h.BeratProdukHasilTimbang,
        CAST(@NewHourStart AS time(7)),
        CAST(@NewHourEnd AS time(7)),
        h.IdRegu
      FROM dbo.InjectProduksi_h h WITH (UPDLOCK, HOLDLOCK)
      WHERE h.NoProduksi = @SourceNoProduksi;

      SELECT
        o.*,
        mc.NamaCetakan,
        mw.Warna,
        mfw.Nama AS NamaFurnitureMaterial
      FROM @out o
      LEFT JOIN dbo.MstCetakan mc WITH (NOLOCK)
        ON mc.IdCetakan = o.IdCetakan
      LEFT JOIN dbo.MstWarna mw WITH (NOLOCK)
        ON mw.IdWarna = o.IdWarna
      LEFT JOIN dbo.MstCabinetWIP mfw WITH (NOLOCK)
        ON mfw.IdCabinetWIP = o.IdFurnitureMaterial;
    `);

    await new sql.Request(tx)
      .input("SourceNoProduksi", sql.VarChar(50), sourceNo)
      .input("NewHourStart", sql.VarChar(20), hourStart).query(`
        UPDATE dbo.InjectProduksi_h
        SET HourEnd = CAST(@NewHourStart AS time(7))
        WHERE NoProduksi = @SourceNoProduksi
      `);

    await new sql.Request(tx)
      .input("SourceNoProduksi", sql.VarChar(50), sourceNo)
      .input("NewNoProduksi", sql.VarChar(50), newNoProduksi).query(`
        INSERT INTO dbo.InjectProduksiOperator_d (NoProduksi, IdOperator)
        SELECT @NewNoProduksi, od.IdOperator
        FROM dbo.InjectProduksiOperator_d od
        WHERE od.NoProduksi = @SourceNoProduksi;
      `);

    const opRes = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      newNoProduksi,
    ).query(`
        SELECT IdOperator
        FROM dbo.InjectProduksiOperator_d
        WHERE NoProduksi = @NoProduksi
        ORDER BY IdOperator;
      `);
    const idOperators = (opRes.recordset || [])
      .map((r) => Number(r.IdOperator))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.trunc(n));

    await tx.commit();
    return {
      idMesin,
      tanggal,
      sourceNoProduksi: sourceNo,
      newNoProduksi,
      sourceHourEndUpdatedTo: hourStart,
      newHourStart: hourStart,
      newHourEnd: hourEnd,
      header: {
        ...(insertRes.recordset?.[0] || {}),
        IdOperator: idOperators[0] ?? null,
        IdOperators: [...new Set(idOperators)],
      },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

module.exports = {
  getAllProduksi,
  getProduksiByDate,
  getFurnitureWipListByNoProduksi,
  getPackingListByNoProduksi,
  getFormulaInputsByNoProduksi,
  createInjectProduksi,
  updateInjectProduksi,
  deleteInjectProduksi,
  fetchInputs,
  fetchOutputs,
  fetchOutputsBonggolan,
  fetchOutputsFurnitureWip,
  fetchOutputsPacking,
  fetchOutputsReject,
  validateLabel,
  validateInputLabelForNoProduksi,
  upsertInputsAndPartials,
  deleteInputsAndPartials,
  splitProduksiTime,
};
