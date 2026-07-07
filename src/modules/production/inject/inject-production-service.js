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
  getBlokLokasiFromKodeProduksi,
} = require("../../../core/shared/mesin-location-helper");
const {
  badReq,
  conflict,
  notFound,
} = require("../../../core/utils/http-error");
const {
  getFormulaInputsByCategory,
  normalizeOutputs,
} = require("../../../core/shared/production-formula.service");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const {
  getReferencedTables,
} = require("../../../core/config/produksi-input-mapping.config");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDateOnlyString(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  if (typeof value === "string") {
    const datePart = value.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
  }

  return null;
}

function normalizeTimeString(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function addDays(dateString, dayOffset) {
  const baseDate = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return null;

  baseDate.setDate(baseDate.getDate() + dayOffset);
  return `${baseDate.getFullYear()}-${pad2(baseDate.getMonth() + 1)}-${pad2(baseDate.getDate())}`;
}

function isCurrentProduksi({
  tglProduksi,
  hourStart,
  hourEnd,
  now = new Date(),
}) {
  const currentDate = toDateOnlyString(now);
  const currentTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const produksiDate = toDateOnlyString(tglProduksi);
  const startTime = normalizeTimeString(hourStart);
  const endTime = normalizeTimeString(hourEnd);

  if (!currentDate || !produksiDate || !startTime || !endTime) {
    return false;
  }

  if (startTime <= endTime) {
    return (
      currentDate === produksiDate &&
      currentTime >= startTime &&
      currentTime < endTime
    );
  }

  const nextDate = addDays(produksiDate, 1);
  if (!nextDate) return false;

  return (
    (currentDate === produksiDate && currentTime >= startTime) ||
    (currentDate === nextDate && currentTime < endTime)
  );
}

function deriveProduksiStatus(row, now = new Date()) {
  if (
    isCurrentProduksi({
      tglProduksi: row.TglProduksi,
      hourStart: row.HourStart,
      hourEnd: row.HourEnd,
      now,
    })
  ) {
    return "current";
  }

  return row.IsComplete ? "complete" : "pending";
}

function formatTanggalPanjangIndonesia(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

async function assertNoIncompleteProduksiForMesin(tx, idMesin) {
  const mesinId = Number(idMesin);
  if (!Number.isInteger(mesinId) || mesinId <= 0) {
    throw badReq("idMesin wajib integer positif");
  }

  const activeRes = await new sql.Request(tx).input("IdMesin", sql.Int, mesinId)
    .query(`
      SELECT TOP 1
        NoProduksi,
        TglProduksi,
        Shift
      FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
      WHERE IdMesin = @IdMesin
        AND ISNULL(IsComplete, 0) = 0
      ORDER BY TglProduksi ASC, HourStart ASC, NoProduksi ASC;
    `);

  const activeRow = activeRes.recordset?.[0] || null;
  const activeNoProduksi = String(activeRow?.NoProduksi || "").trim();

  if (activeNoProduksi) {
    const tanggalPanjang =
      formatTanggalPanjangIndonesia(activeRow?.TglProduksi) || "-";
    const shiftText =
      activeRow?.Shift == null || activeRow?.Shift === ""
        ? "-"
        : String(activeRow.Shift).trim();

    throw conflict(
      `Terdapat produksi yang belum di selesaikan pada ${tanggalPanjang}, shift ${shiftText} dengan Nomor Produksi ${activeNoProduksi}. Selesaikan produksi tersebut terlebih dahulu.`,
    );
  }
}

// ============================================================
// ✅ GET ALL (paged + search + lastClosed + isLocked)
// ============================================================
async function getAllProduksi(
  page = 1,
  pageSize = 20,
  search = "",
  idMesin = null,
  tanggal = null,
  shift = null,
) {
  const pool = await poolPromise;

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;

  const searchTerm = (search || "").trim();

  const whereClause = `
    WHERE (@search = '' OR h.NoProduksi LIKE '%' + @search + '%')
      AND (@idMesin IS NULL OR h.IdMesin = @idMesin)
      AND (@tanggal IS NULL OR CONVERT(date, h.TglProduksi) = @tanggal)
      AND (@shift IS NULL OR h.Shift = @shift)
  `;

  // 1) Count
  const countQry = `
    SELECT COUNT(1) AS total
    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    ${whereClause};
  `;

  const countReq = pool.request();
  countReq.input("search", sql.VarChar(100), searchTerm);
  countReq.input("idMesin", sql.Int, idMesin);
  countReq.input("tanggal", sql.Date, tanggal);
  countReq.input("shift", sql.Int, shift);

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
      END AS IsLocked,

      h.InputMode,

      h.IsComplete

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
  dataReq.input("idMesin", sql.Int, idMesin);
  dataReq.input("tanggal", sql.Date, tanggal);
  dataReq.input("shift", sql.Int, shift);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("limit", sql.Int, ps);

  const dataRes = await dataReq.query(dataQry);
  const now = new Date();
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

    const { IsComplete, ...restRow } = row;

    return {
      ...restRow,
      IdOperator: idOperators[0] ?? null,
      NamaOperator: row.NamaOperator ?? null,
      IdOperators: idOperators,
      Outputs: outputs,
      status: deriveProduksiStatus(row, now),
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
      h.InputMode,
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

function normalizeBatchHourStart(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${match[1]}:${match[2]}:${String(second).padStart(2, "0")}`;
}

function formatHourStartForResponse(value) {
  const normalized = normalizeBatchHourStart(value);
  return normalized ? normalized.slice(0, 5) : null;
}

async function getInjectPcsPerLabelByNoProduksi(
  noProduksi,
  idJenisFilter = null,
  outputCategoryFilter = null,
) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  const idJenis =
    idJenisFilter === null ||
    idJenisFilter === undefined ||
    idJenisFilter === ""
      ? null
      : Number(idJenisFilter);
  if (idJenis != null && (!Number.isInteger(idJenis) || idJenis <= 0)) {
    throw badReq("idJenis harus integer positif bila diisi");
  }

  const normalizedOutputCategory =
    outputCategoryFilter == null || String(outputCategoryFilter).trim() === ""
      ? null
      : String(outputCategoryFilter).trim().toLowerCase();
  if (
    normalizedOutputCategory &&
    normalizedOutputCategory !== "furniturewip" &&
    normalizedOutputCategory !== "barangjadi"
  ) {
    throw badReq("outputCategory harus furnitureWip atau barangjadi");
  }

  const pool = await poolPromise;
  const headerReq = pool.request();
  headerReq.input("NoProduksi", sql.VarChar(50), no);
  const headerRes = await headerReq.query(`
    SELECT TOP 1
      h.NoProduksi,
      h.IdWarna,
      h.TglProduksi,
      CASE
        WHEN fwCount.TotalCount > 0 THEN 'furnitureWip'
        WHEN bjCount.TotalCount > 0 THEN 'barangjadi'
        ELSE NULL
      END AS OutputCategory
    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    OUTER APPLY (
      SELECT COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT dFw.IdFurnitureWIP
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
      SELECT COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT dBj.IdBarangJadi
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
    WHERE h.NoProduksi = @NoProduksi;
  `);

  const header = headerRes.recordset?.[0];
  if (!header) {
    throw notFound(`NoProduksi tidak ditemukan: ${no}`);
  }

  const outputCategory = header.OutputCategory ?? null;
  if (!outputCategory) {
    throw notFound(`Output mapping tidak ditemukan untuk NoProduksi ${no}`);
  }
  if (
    normalizedOutputCategory &&
    String(outputCategory).toLowerCase() !== normalizedOutputCategory
  ) {
    throw badReq(
      `OutputCategory ${normalizedOutputCategory} tidak valid untuk NoProduksi ${no}`,
    );
  }

  const request = pool.request();
  request.input("NoProduksi", sql.VarChar(50), no);
  request.input("IdJenis", sql.Int, idJenis);

  const queryBarangJadi = async () =>
    request.query(`
      SELECT TOP 1
        mbj.PcsPerLabel,
        mbj.NamaBJ AS NamaBarang,
        d.IdBarangJadi AS IdJenis,
        h.IdWarna,
        h.TglProduksi,
        CAST('barangjadi' AS varchar(20)) AS OutputCategory
      FROM dbo.InjectProduksi_h h WITH (NOLOCK)
      INNER JOIN dbo.CetakanWarnaToProduk_d d WITH (NOLOCK)
        ON d.IdCetakan = h.IdCetakan
       AND d.IdWarna = h.IdWarna
       AND (
            (d.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR d.IdFurnitureMaterial = h.IdFurnitureMaterial
           )
      INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
        ON mbj.IdBJ = d.IdBarangJadi
      WHERE h.NoProduksi = @NoProduksi
        AND (@IdJenis IS NULL OR d.IdBarangJadi = @IdJenis)
      ORDER BY d.IdBarangJadi ASC;
    `);

  const queryFurnitureWip = async () =>
    request.query(`
      SELECT TOP 1
        m.PcsPerLabel,
        m.Nama AS NamaBarang,
        cw.IdFurnitureWIP AS IdJenis,
        h.IdWarna,
        h.TglProduksi,
        CAST('furnitureWip' AS varchar(20)) AS OutputCategory
      FROM dbo.InjectProduksi_h h WITH (NOLOCK)
      INNER JOIN dbo.CetakanWarnaToFurnitureWIP_d cw WITH (NOLOCK)
        ON cw.IdCetakan = h.IdCetakan
       AND cw.IdWarna = h.IdWarna
       AND (
            (cw.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR cw.IdFurnitureMaterial = h.IdFurnitureMaterial
           )
      INNER JOIN dbo.MstCabinetWIP m WITH (NOLOCK)
        ON m.IdCabinetWIP = cw.IdFurnitureWIP
      WHERE h.NoProduksi = @NoProduksi
        AND (@IdJenis IS NULL OR cw.IdFurnitureWIP = @IdJenis)
      ORDER BY cw.IdFurnitureWIP ASC;
    `);

  let result = null;
  if (normalizedOutputCategory === "barangjadi") {
    result = await queryBarangJadi();
  } else if (normalizedOutputCategory === "furniturewip") {
    result = await queryFurnitureWip();
  } else if (idJenis != null) {
    result = await queryBarangJadi();
    if (!result.recordset?.[0]) {
      result = await queryFurnitureWip();
    }
  } else if (String(outputCategory).toLowerCase() === "barangjadi") {
    result = await queryBarangJadi();
  } else {
    result = await queryFurnitureWip();
  }

  const row = result.recordset?.[0];
  if (!row) {
    throw notFound(`Pcs per label tidak ditemukan untuk NoProduksi ${no}`);
  }

  const resolvedCategory = row.OutputCategory ?? outputCategory;
  return {
    outputCategory: resolvedCategory,
    idJenis: row.IdJenis ?? null,
    idFurnitureWIP:
      String(resolvedCategory).toLowerCase() === "furniturewip"
        ? (row.IdJenis ?? null)
        : null,
    idBarangJadi:
      String(resolvedCategory).toLowerCase() === "barangjadi"
        ? (row.IdJenis ?? null)
        : null,
    namaBarang: row.NamaBarang ?? null,
    pcsPerLabel: row.PcsPerLabel == null ? null : Number(row.PcsPerLabel),
    idWarna: row.IdWarna ?? null,
    tglProduksi: row.TglProduksi ?? null,
  };
}

async function getInjectPcsPerLabelListByNoProduksi(noProduksi) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  const pool = await poolPromise;
  const headerReq = pool.request();
  headerReq.input("NoProduksi", sql.VarChar(50), no);
  const headerRes = await headerReq.query(`
    SELECT TOP 1
      h.NoProduksi,
      h.IdWarna,
      h.IdMesin,
      h.TglProduksi,
      ms.CounterCurrent,
      ms.StandarBerat,
      ms.StandarCycleTime,
      CASE
        WHEN fwCount.TotalCount > 0 THEN 'furnitureWip'
        WHEN bjCount.TotalCount > 0 THEN 'barangjadi'
        ELSE NULL
      END AS OutputCategory
    FROM dbo.InjectProduksi_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstMesinInject ms WITH (NOLOCK)
      ON ms.IdMesin = h.IdMesin
    OUTER APPLY (
      SELECT COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT dFw.IdFurnitureWIP
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
      SELECT COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT dBj.IdBarangJadi
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
    WHERE h.NoProduksi = @NoProduksi;
  `);

  const header = headerRes.recordset?.[0];
  if (!header) throw notFound(`NoProduksi tidak ditemukan: ${no}`);

  const outputCategory = header.OutputCategory ?? null;
  if (!outputCategory)
    throw notFound(`Output mapping tidak ditemukan untuk NoProduksi ${no}`);

  const listReq = pool.request();
  listReq.input("NoProduksi", sql.VarChar(50), no);

  let rows = [];
  if (String(outputCategory).toLowerCase() === "barangjadi") {
    const res = await listReq.query(`
      SELECT
        mbj.PcsPerLabel,
        mbj.NamaBJ AS NamaBarang,
        d.IdBarangJadi AS IdJenis,
        h.IdWarna,
        h.TglProduksi,
        CAST('barangjadi' AS varchar(20)) AS OutputCategory
      FROM dbo.InjectProduksi_h h WITH (NOLOCK)
      INNER JOIN dbo.CetakanWarnaToProduk_d d WITH (NOLOCK)
        ON d.IdCetakan = h.IdCetakan
       AND d.IdWarna = h.IdWarna
       AND (
            (d.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR d.IdFurnitureMaterial = h.IdFurnitureMaterial
           )
      INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
        ON mbj.IdBJ = d.IdBarangJadi
      WHERE h.NoProduksi = @NoProduksi
      ORDER BY d.IdBarangJadi ASC;
    `);
    rows = res.recordset ?? [];
  } else {
    const res = await listReq.query(`
      SELECT
        m.PcsPerLabel,
        m.Nama AS NamaBarang,
        cw.IdFurnitureWIP AS IdJenis,
        h.IdWarna,
        h.TglProduksi,
        CAST('furnitureWip' AS varchar(20)) AS OutputCategory
      FROM dbo.InjectProduksi_h h WITH (NOLOCK)
      INNER JOIN dbo.CetakanWarnaToFurnitureWIP_d cw WITH (NOLOCK)
        ON cw.IdCetakan = h.IdCetakan
       AND cw.IdWarna = h.IdWarna
       AND (
            (cw.IdFurnitureMaterial IS NULL
              AND (h.IdFurnitureMaterial = 0 OR h.IdFurnitureMaterial IS NULL))
            OR cw.IdFurnitureMaterial = h.IdFurnitureMaterial
           )
      INNER JOIN dbo.MstCabinetWIP m WITH (NOLOCK)
        ON m.IdCabinetWIP = cw.IdFurnitureWIP
      WHERE h.NoProduksi = @NoProduksi
      ORDER BY cw.IdFurnitureWIP ASC;
    `);
    rows = res.recordset ?? [];
  }

  if (rows.length === 0)
    throw notFound(`Pcs per label tidak ditemukan untuk NoProduksi ${no}`);

  return {
    outputCategory,
    idWarna: header.IdWarna ?? null,
    idMesin: header.IdMesin ?? null,
    tglProduksi: header.TglProduksi ?? null,
    counterCurrent:
      header.CounterCurrent == null ? null : Number(header.CounterCurrent),
    standarBerat:
      header.StandarBerat == null ? null : Number(header.StandarBerat),
    standarCycleTime:
      header.StandarCycleTime == null ? null : Number(header.StandarCycleTime),
    items: rows.map((row) => ({
      idJenis: row.IdJenis ?? null,
      namaBarang: row.NamaBarang ?? null,
      pcsPerLabel: row.PcsPerLabel == null ? null : Number(row.PcsPerLabel),
    })),
  };
}

async function getInjectBatchByNoProduksi(noProduksi) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  const pool = await poolPromise;
  const request = pool.request();
  request.input("NoProduksi", sql.VarChar(50), no);

  const result = await request.query(`
    SELECT
      b.Id,
      b.NoProduksi,
      CONVERT(varchar(8), b.HourStart, 108) AS HourStart,
      b.Berat,
      b.CycleTime,
      b.Counter,
      b.DateTimeCreate,
      d.Id           AS DetailId,
      d.IdJenis,
      d.OutputCategory,
      d.CarryOverIn,
      d.PcsInput,
      d.CarryOverOut
    FROM dbo.InjectProduksiBatch b WITH (NOLOCK)
    LEFT JOIN dbo.InjectProduksiBatch_d d WITH (NOLOCK)
      ON d.IdBatch = b.Id
    WHERE b.NoProduksi = @NoProduksi
    ORDER BY b.HourStart ASC, b.Id ASC, d.Id ASC;
  `);

  const rows = result.recordset || [];
  if (rows.length === 0) return [];

  // Group detail rows by batch Id, deduplicate batches
  const batchMap = new Map();
  for (const row of rows) {
    if (!batchMap.has(row.Id)) {
      batchMap.set(row.Id, {
        id: row.Id,
        noProduksi: row.NoProduksi,
        hourStart: row.HourStart,
        berat: row.Berat,
        cycleTime: row.CycleTime,
        counter: row.Counter,
        dateTimeCreate: row.DateTimeCreate,
        items: [],
      });
    }
    if (row.DetailId != null) {
      batchMap.get(row.Id).items.push({
        idJenis: row.IdJenis ?? null,
        outputCategory: row.OutputCategory ?? null,
        carryOverIn: row.CarryOverIn ?? 0,
        pcsInput: row.PcsInput ?? 0,
        carryOverOut: row.CarryOverOut ?? 0,
      });
    }
  }

  const batches = [...batchMap.values()];

  const labelResult = await pool
    .request()
    .input("NoProduksi", sql.VarChar(50), no).query(`
      SELECT
        'furnitureWip' AS LabelType,
        fw.DateTimeCreate,
        map.NoFurnitureWIP AS LabelNo,
        fw.IDFurnitureWIP AS LabelIdJenis,
        cab.Nama AS LabelNamaJenis,
        ISNULL(CAST(fw.HasBeenPrinted AS int), 0) AS LabelHasBeenPrinted,
        fw.Pcs AS LabelPcs,
        CAST(NULL AS decimal(18,3)) AS LabelBerat
      FROM dbo.InjectProduksiOutputFurnitureWIP map WITH (NOLOCK)
      INNER JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
        ON fw.NoFurnitureWIP = map.NoFurnitureWIP
      LEFT JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
        ON cab.IdCabinetWIP = fw.IDFurnitureWIP
      WHERE map.NoProduksi = @NoProduksi

      UNION ALL

      SELECT
        'barangJadi' AS LabelType,
        bj.DateTimeCreate,
        map.NoBJ AS LabelNo,
        bj.IdBJ AS LabelIdJenis,
        mbj.NamaBJ AS LabelNamaJenis,
        ISNULL(CAST(bj.HasBeenPrinted AS int), 0) AS LabelHasBeenPrinted,
        bj.Pcs AS LabelPcs,
        CAST(NULL AS decimal(18,3)) AS LabelBerat
      FROM dbo.InjectProduksiOutputBarangJadi map WITH (NOLOCK)
      INNER JOIN dbo.BarangJadi bj WITH (NOLOCK)
        ON bj.NoBJ = map.NoBJ
      LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
        ON mbj.IdBJ = bj.IdBJ
      WHERE map.NoProduksi = @NoProduksi

      UNION ALL

      SELECT
        'bonggolan' AS LabelType,
        bg.DateTimeCreate,
        map.NoBonggolan AS LabelNo,
        bg.IdBonggolan AS LabelIdJenis,
        mb.NamaBonggolan AS LabelNamaJenis,
        ISNULL(CAST(bg.HasBeenPrinted AS int), 0) AS LabelHasBeenPrinted,
        CAST(NULL AS decimal(18,3)) AS LabelPcs,
        bg.Berat AS LabelBerat
      FROM dbo.InjectProduksiOutputBonggolan map WITH (NOLOCK)
      INNER JOIN dbo.Bonggolan bg WITH (NOLOCK)
        ON bg.NoBonggolan = map.NoBonggolan
      LEFT JOIN dbo.MstBonggolan mb WITH (NOLOCK)
        ON mb.IdBonggolan = bg.IdBonggolan
      WHERE map.NoProduksi = @NoProduksi

      UNION ALL

      SELECT
        'reject' AS LabelType,
        rj.DateTimeCreate,
        map.NoReject AS LabelNo,
        rj.IdReject AS LabelIdJenis,
        mr.NamaReject AS LabelNamaJenis,
        ISNULL(CAST(rj.HasBeenPrinted AS int), 0) AS LabelHasBeenPrinted,
        CAST(NULL AS decimal(18,3)) AS LabelPcs,
        rj.Berat AS LabelBerat
      FROM dbo.InjectProduksiOutputRejectV2 map WITH (NOLOCK)
      INNER JOIN dbo.RejectV2 rj WITH (NOLOCK)
        ON rj.NoReject = map.NoReject
      LEFT JOIN dbo.MstReject mr WITH (NOLOCK)
        ON mr.IdReject = rj.IdReject
      WHERE map.NoProduksi = @NoProduksi;
    `);

  const batchKeyMap = new Map();
  for (const batch of batches) {
    const key =
      batch.dateTimeCreate instanceof Date
        ? batch.dateTimeCreate.toISOString()
        : new Date(batch.dateTimeCreate).toISOString();
    batchKeyMap.set(key, {
      furnitureWip: [],
      barangJadi: [],
      bonggolan: [],
      reject: [],
    });
  }

  for (const labelRow of labelResult.recordset || []) {
    const dateValue = labelRow.DateTimeCreate;
    if (!dateValue) continue;
    const key =
      dateValue instanceof Date
        ? dateValue.toISOString()
        : new Date(dateValue).toISOString();
    const bucket = batchKeyMap.get(key);
    if (!bucket) continue;

    const labelItem =
      labelRow.LabelType === "furnitureWip"
        ? {
            noFurnitureWIP: labelRow.LabelNo,
            idJenis: labelRow.LabelIdJenis ?? null,
            namaJenis: labelRow.LabelNamaJenis ?? null,
            hasBeenPrinted: labelRow.LabelHasBeenPrinted ?? 0,
            pcs: labelRow.LabelPcs == null ? null : Number(labelRow.LabelPcs),
          }
        : labelRow.LabelType === "barangJadi"
          ? {
              noBJ: labelRow.LabelNo,
              idJenis: labelRow.LabelIdJenis ?? null,
              namaJenis: labelRow.LabelNamaJenis ?? null,
              hasBeenPrinted: labelRow.LabelHasBeenPrinted ?? 0,
              pcs: labelRow.LabelPcs == null ? null : Number(labelRow.LabelPcs),
            }
          : labelRow.LabelType === "bonggolan"
            ? {
                noBonggolan: labelRow.LabelNo,
                idJenis: labelRow.LabelIdJenis ?? null,
                namaJenis: labelRow.LabelNamaJenis ?? null,
                hasBeenPrinted: labelRow.LabelHasBeenPrinted ?? 0,
                berat:
                  labelRow.LabelBerat == null
                    ? null
                    : Number(labelRow.LabelBerat),
              }
            : {
                noReject: labelRow.LabelNo,
                idJenis: labelRow.LabelIdJenis ?? null,
                namaJenis: labelRow.LabelNamaJenis ?? null,
                hasBeenPrinted: labelRow.LabelHasBeenPrinted ?? 0,
                berat:
                  labelRow.LabelBerat == null
                    ? null
                    : Number(labelRow.LabelBerat),
              };

    if (labelRow.LabelType === "furnitureWip") {
      bucket.furnitureWip.push(labelItem);
    } else if (labelRow.LabelType === "barangJadi") {
      bucket.barangJadi.push(labelItem);
    } else if (labelRow.LabelType === "bonggolan") {
      bucket.bonggolan.push(labelItem);
    } else if (labelRow.LabelType === "reject") {
      bucket.reject.push(labelItem);
    }
  }

  return batches.map((batch) => {
    const key =
      batch.dateTimeCreate instanceof Date
        ? batch.dateTimeCreate.toISOString()
        : new Date(batch.dateTimeCreate).toISOString();
    const labels = batchKeyMap.get(key) || {
      furnitureWip: [],
      barangJadi: [],
      bonggolan: [],
      reject: [],
    };

    return {
      id: batch.id ?? null,
      noProduksi: batch.noProduksi ?? null,
      hourStart: formatHourStartForResponse(batch.hourStart),
      berat: batch.berat == null ? null : Number(batch.berat),
      cycleTime: batch.cycleTime == null ? null : Number(batch.cycleTime),
      counter: batch.counter ?? 0,
      dateTimeCreate: batch.dateTimeCreate ?? null,
      items: batch.items,
      labels: {
        furnitureWip: labels.furnitureWip,
        barangJadi: labels.barangJadi,
        bonggolan: labels.bonggolan,
        reject: labels.reject,
      },
    };
  });
}

async function getInjectQcByNoProduksi(noProduksi) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  const pool = await poolPromise;
  const request = pool.request();
  request.input("NoProduksi", sql.VarChar(50), no);

  const result = await request.query(`
    SELECT
      Id,
      NoProduksi,
      HourStart,
      JumlahBS,
      CycleTime,
      Counter,
      Berat,
      DateTimeCreate
    FROM dbo.InjectProduksi_QC WITH (NOLOCK)
    WHERE NoProduksi = @NoProduksi
    ORDER BY HourStart ASC, Id ASC;
  `);

  return (result.recordset || []).map((row) => ({
    id: row.Id ?? null,
    noProduksi: row.NoProduksi ?? null,
    hourStart: formatHourStartForResponse(row.HourStart),
    jumlahBS: row.JumlahBS == null ? null : Number(row.JumlahBS),
    cycleTime: row.CycleTime == null ? null : Number(row.CycleTime),
    counter: row.Counter ?? null,
    berat: row.Berat == null ? null : Number(row.Berat),
    dateTimeCreate: row.DateTimeCreate ?? null,
  }));
}

async function createInjectQc(payload, ctx) {
  const noProduksi = String(payload?.noProduksi || "").trim();
  if (!noProduksi) throw badReq("noProduksi wajib");

  const hourStart = normalizeBatchHourStart(payload?.hourStart);
  if (!hourStart) throw badReq("hourStart harus format HH:mm atau HH:mm:ss");

  const jumlahBS =
    payload?.jumlahBS === null || payload?.jumlahBS === undefined
      ? null
      : Number(payload.jumlahBS);
  if (jumlahBS == null || !Number.isFinite(jumlahBS) || jumlahBS < 0) {
    throw badReq("jumlahBS harus angka >= 0");
  }

  const cycleTime =
    payload?.cycleTime === null || payload?.cycleTime === undefined
      ? null
      : Number(payload.cycleTime);
  if (cycleTime != null && (!Number.isFinite(cycleTime) || cycleTime < 0)) {
    throw badReq("cycleTime harus angka >= 0");
  }

  const counter =
    payload?.counter === null || payload?.counter === undefined
      ? null
      : Number(payload.counter);
  if (counter != null && (!Number.isInteger(counter) || counter < 0)) {
    throw badReq("counter harus integer >= 0");
  }

  const berat =
    payload?.berat === null || payload?.berat === undefined
      ? null
      : Number(payload.berat);
  if (berat != null && (!Number.isFinite(berat) || berat < 0)) {
    throw badReq("berat harus angka >= 0");
  }

  const actorId = Number(ctx?.actorId);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    // ✅ Checkpoint counter QC per mesin (independen dari MstMesinInject.CounterCurrent).
    // IdMesin di-resolve dari header produksi; nilai counter disimpan terpisah.
    let qcIdMesin = null;
    if (counter != null) {
      const mesinRes = await new sql.Request(tx).input(
        "NoProduksi",
        sql.VarChar(50),
        noProduksi,
      ).query(`
          SELECT TOP 1 IdMesin
          FROM dbo.InjectProduksi_h WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi;
        `);
      qcIdMesin = mesinRes.recordset?.[0]?.IdMesin ?? null;

      if (qcIdMesin != null) {
        // UPDLOCK + HOLDLOCK: kunci baris (atau range key bila belum ada)
        // agar pembacaan floor & upsert counter race-safe per mesin.
        const counterRes = await new sql.Request(tx).input(
          "IdMesin",
          sql.Int,
          qcIdMesin,
        ).query(`
            SELECT CounterCurrent
            FROM dbo.InjectProduksiQcCounter WITH (UPDLOCK, HOLDLOCK)
            WHERE IdMesin = @IdMesin;
          `);
        const counterCurrent = Number(
          counterRes.recordset?.[0]?.CounterCurrent ?? 0,
        );
        if (counter < counterCurrent) {
          throw badReq(
            `counter harus >= ${counterCurrent} (counter QC terakhir mesin ${qcIdMesin}). Input: ${counter}.`,
          );
        }
      }
    }

    const nowDateTime = new Date();
    const insertRes = await new sql.Request(tx)
      .input("NoProduksi", sql.VarChar(50), noProduksi)
      .input("HourStart", sql.VarChar(5), hourStart.slice(0, 5))
      .input("JumlahBS", sql.Decimal(18, 3), jumlahBS)
      .input(
        "CycleTime",
        sql.Decimal(10, 2),
        cycleTime == null ? null : cycleTime,
      )
      .input("Counter", sql.Int, counter)
      .input("Berat", sql.Decimal(18, 3), berat == null ? null : berat)
      .input("DateTimeCreate", sql.DateTime, nowDateTime).query(`
        DECLARE @out TABLE (
          Id int,
          NoProduksi varchar(50),
          HourStart varchar(5),
          JumlahBS decimal(18,3),
          CycleTime decimal(10,2),
          Counter int,
          Berat decimal(18,3),
          DateTimeCreate datetime
        );

        INSERT INTO dbo.InjectProduksi_QC (
          NoProduksi, HourStart, JumlahBS, CycleTime, Counter, Berat, DateTimeCreate
        )
        OUTPUT
          INSERTED.Id,
          INSERTED.NoProduksi,
          INSERTED.HourStart,
          INSERTED.JumlahBS,
          INSERTED.CycleTime,
          INSERTED.Counter,
          INSERTED.Berat,
          INSERTED.DateTimeCreate
        INTO @out
        VALUES (
          @NoProduksi, @HourStart, @JumlahBS, @CycleTime, @Counter, @Berat, @DateTimeCreate
        );

        SELECT * FROM @out;
      `);

    // ✅ Majukan checkpoint counter QC mesin (upsert). counter >= floor sudah dijamin di atas.
    if (counter != null && qcIdMesin != null) {
      await new sql.Request(tx)
        .input("IdMesin", sql.Int, qcIdMesin)
        .input("Counter", sql.Int, counter)
        .input("UpdatedBy", sql.VarChar(50), actorUsername).query(`
          MERGE dbo.InjectProduksiQcCounter AS t
          USING (SELECT @IdMesin AS IdMesin) AS s
            ON t.IdMesin = s.IdMesin
          WHEN MATCHED THEN
            UPDATE SET CounterCurrent = @Counter,
                       UpdatedBy = @UpdatedBy,
                       DateTimeUpdate = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (IdMesin, CounterCurrent, UpdatedBy, DateTimeUpdate)
            VALUES (@IdMesin, @Counter, @UpdatedBy, GETDATE());
        `);
    }

    await tx.commit();

    const row = insertRes.recordset?.[0] || {};
    return {
      id: row.Id ?? null,
      noProduksi: row.NoProduksi ?? null,
      hourStart: formatHourStartForResponse(row.HourStart),
      jumlahBS: row.JumlahBS == null ? null : Number(row.JumlahBS),
      cycleTime: row.CycleTime == null ? null : Number(row.CycleTime),
      counter: row.Counter ?? null,
      berat: row.Berat == null ? null : Number(row.Berat),
      dateTimeCreate: row.DateTimeCreate ?? null,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw error;
  }
}

async function updateInjectQc(id, payload, ctx) {
  const qcId = Number(id);
  if (!Number.isInteger(qcId) || qcId <= 0) {
    throw badReq("id QC harus integer positif");
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, "noProduksi")) {
    const noProduksi = String(payload?.noProduksi || "").trim();
    if (!noProduksi) throw badReq("noProduksi tidak boleh kosong");
    updates.noProduksi = noProduksi;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "hourStart")) {
    const hourStart = normalizeBatchHourStart(payload?.hourStart);
    if (!hourStart) throw badReq("hourStart harus format HH:mm atau HH:mm:ss");
    updates.hourStart = hourStart.slice(0, 5);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "jumlahBS")) {
    const jumlahBS =
      payload?.jumlahBS === null || payload?.jumlahBS === undefined
        ? null
        : Number(payload.jumlahBS);
    if (jumlahBS == null || !Number.isFinite(jumlahBS) || jumlahBS < 0) {
      throw badReq("jumlahBS harus angka >= 0");
    }
    updates.jumlahBS = jumlahBS;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "cycleTime")) {
    const cycleTime =
      payload?.cycleTime === null || payload?.cycleTime === undefined
        ? null
        : Number(payload.cycleTime);
    if (cycleTime != null && (!Number.isFinite(cycleTime) || cycleTime < 0)) {
      throw badReq("cycleTime harus angka >= 0");
    }
    updates.cycleTime = cycleTime;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "counter")) {
    const counter =
      payload?.counter === null || payload?.counter === undefined
        ? null
        : Number(payload.counter);
    if (counter != null && (!Number.isInteger(counter) || counter < 0)) {
      throw badReq("counter harus integer >= 0");
    }
    updates.counter = counter;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "berat")) {
    const berat =
      payload?.berat === null || payload?.berat === undefined
        ? null
        : Number(payload.berat);
    if (berat != null && (!Number.isFinite(berat) || berat < 0)) {
      throw badReq("berat harus angka >= 0");
    }
    updates.berat = berat;
  }

  if (Object.keys(updates).length === 0) {
    throw badReq("Minimal satu field harus diisi untuk update QC");
  }

  const actorId = Number(ctx?.actorId);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    const existsRes = await new sql.Request(tx).input("Id", sql.Int, qcId)
      .query(`
        SELECT TOP 1 Id
        FROM dbo.InjectProduksi_QC WITH (UPDLOCK, HOLDLOCK)
        WHERE Id = @Id;
      `);
    if (!existsRes.recordset?.length) {
      throw notFound(`Data QC tidak ditemukan untuk id ${qcId}`);
    }

    const setClauses = [];
    const request = new sql.Request(tx);
    request.input("Id", sql.Int, qcId);

    if (Object.prototype.hasOwnProperty.call(updates, "noProduksi")) {
      setClauses.push("NoProduksi = @NoProduksi");
      request.input("NoProduksi", sql.VarChar(50), updates.noProduksi);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "hourStart")) {
      setClauses.push("HourStart = @HourStart");
      request.input("HourStart", sql.VarChar(5), updates.hourStart);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "jumlahBS")) {
      setClauses.push("JumlahBS = @JumlahBS");
      request.input("JumlahBS", sql.Decimal(18, 3), updates.jumlahBS);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "cycleTime")) {
      setClauses.push("CycleTime = @CycleTime");
      request.input("CycleTime", sql.Decimal(10, 2), updates.cycleTime);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "counter")) {
      setClauses.push("Counter = @Counter");
      request.input("Counter", sql.Int, updates.counter);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "berat")) {
      setClauses.push("Berat = @Berat");
      request.input("Berat", sql.Decimal(18, 3), updates.berat);
    }

    const updateRes = await request.query(`
      UPDATE dbo.InjectProduksi_QC
      SET ${setClauses.join(", ")}
      OUTPUT
        INSERTED.Id,
        INSERTED.NoProduksi,
        INSERTED.HourStart,
        INSERTED.JumlahBS,
        INSERTED.CycleTime,
        INSERTED.Counter,
        INSERTED.Berat,
        INSERTED.DateTimeCreate
      WHERE Id = @Id;
    `);

    await tx.commit();

    const row = updateRes.recordset?.[0] || {};
    return {
      id: row.Id ?? null,
      noProduksi: row.NoProduksi ?? null,
      hourStart: formatHourStartForResponse(row.HourStart),
      jumlahBS: row.JumlahBS == null ? null : Number(row.JumlahBS),
      cycleTime: row.CycleTime == null ? null : Number(row.CycleTime),
      counter: row.Counter ?? null,
      berat: row.Berat == null ? null : Number(row.Berat),
      dateTimeCreate: row.DateTimeCreate ?? null,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw error;
  }
}

async function generateUniqueCode(
  tx,
  { tableName, columnName, prefix, width },
) {
  const gen = () =>
    generateNextCode(tx, {
      tableName,
      columnName,
      prefix,
      width,
    });

  let generated = await gen();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const exists = await new sql.Request(tx).input(
      "Code",
      sql.VarChar(50),
      generated,
    ).query(`
        SELECT 1
        FROM ${tableName} WITH (UPDLOCK, HOLDLOCK)
        WHERE ${columnName} = @Code
      `);
    if (!exists.recordset?.length) return generated;
    generated = await gen();
  }

  throw conflict(`Gagal generate ${columnName} unik, coba lagi.`);
}

async function createInjectFurnitureWipLabel(
  tx,
  {
    noProduksi,
    idFurnitureWIP,
    pcs,
    hourStart,
    idWarna,
    dateCreate,
    nowDateTime,
    createBy,
    blok,
    idLokasi,
    idWarehouse,
  },
) {
  const noFurnitureWIP = await generateUniqueCode(tx, {
    tableName: "dbo.FurnitureWIP",
    columnName: "NoFurnitureWIP",
    prefix: "BB.",
    width: 10,
  });

  await new sql.Request(tx)
    .input("NoProduksi", sql.VarChar(50), noProduksi)
    .input("NoFurnitureWIP", sql.VarChar(50), noFurnitureWIP)
    .input("DateCreate", sql.Date, dateCreate)
    .input("Jam", sql.VarChar(20), hourStart)
    .input("Pcs", sql.Decimal(18, 3), pcs)
    .input("IDFurnitureWIP", sql.Int, idFurnitureWIP)
    .input("Berat", sql.Decimal(18, 3), null)
    .input("IsPartial", sql.Bit, 0)
    .input("IdWarehouse", sql.Int, idWarehouse ?? null)
    .input("IdWarna", sql.Int, idWarna ?? null)
    .input("CreateBy", sql.VarChar(50), createBy)
    .input("DateTimeCreate", sql.DateTime, nowDateTime)
    .input("Blok", sql.VarChar(50), blok ?? null)
    .input("IdLokasi", sql.Int, idLokasi ?? null).query(`
      INSERT INTO dbo.FurnitureWIP (
        NoFurnitureWIP, DateCreate, Jam, Pcs, IDFurnitureWIP, Berat, IsPartial, DateUsage,
        IdWarehouse, IdWarna, CreateBy, DateTimeCreate, Blok, IdLokasi
      )
      VALUES (
        @NoFurnitureWIP, @DateCreate, @Jam, @Pcs, @IDFurnitureWIP, @Berat, @IsPartial, NULL,
        @IdWarehouse, @IdWarna, @CreateBy, @DateTimeCreate, @Blok, @IdLokasi
      );

      INSERT INTO dbo.InjectProduksiOutputFurnitureWIP (NoProduksi, NoFurnitureWIP)
      VALUES (@NoProduksi, @NoFurnitureWIP);
    `);

  return noFurnitureWIP;
}

async function createInjectBarangJadiLabel(
  tx,
  {
    noProduksi,
    idBJ,
    pcs,
    hourStart,
    dateCreate,
    nowDateTime,
    createBy,
    blok,
    idLokasi,
    idWarehouse,
  },
) {
  const noBJ = await generateUniqueCode(tx, {
    tableName: "dbo.BarangJadi",
    columnName: "NoBJ",
    prefix: "BA.",
    width: 10,
  });

  await new sql.Request(tx)
    .input("NoProduksi", sql.VarChar(50), noProduksi)
    .input("NoBJ", sql.VarChar(50), noBJ)
    .input("IdBJ", sql.Int, idBJ)
    .input("DateCreate", sql.Date, dateCreate)
    .input("Jam", sql.VarChar(20), hourStart)
    .input("Pcs", sql.Decimal(18, 3), pcs)
    .input("Berat", sql.Decimal(18, 3), null)
    .input("IsPartial", sql.Bit, 0)
    .input("IdWarehouse", sql.Int, idWarehouse ?? null)
    .input("CreateBy", sql.VarChar(50), createBy)
    .input("DateTimeCreate", sql.DateTime, nowDateTime)
    .input("Blok", sql.VarChar(50), blok ?? null)
    .input("IdLokasi", sql.Int, idLokasi ?? null).query(`
      INSERT INTO dbo.BarangJadi (
        NoBJ, IdBJ, DateCreate, DateUsage, Jam, Pcs, Berat,
        IdWarehouse, CreateBy, DateTimeCreate, IsPartial, Blok, IdLokasi
      )
      VALUES (
        @NoBJ, @IdBJ, @DateCreate, NULL, @Jam, @Pcs, @Berat,
        @IdWarehouse, @CreateBy, @DateTimeCreate, @IsPartial, @Blok, @IdLokasi
      );

      INSERT INTO dbo.InjectProduksiOutputBarangJadi (NoProduksi, NoBJ)
      VALUES (@NoProduksi, @NoBJ);
    `);

  return noBJ;
}

async function createInjectBonggolanLabel(
  tx,
  {
    noProduksi,
    idBonggolan,
    berat,
    dateCreate,
    nowDateTime,
    createBy,
    blok,
    idLokasi,
    idWarehouse,
  },
) {
  const noBonggolan = await generateUniqueCode(tx, {
    tableName: "dbo.Bonggolan",
    columnName: "NoBonggolan",
    prefix: "M.",
    width: 10,
  });

  await new sql.Request(tx)
    .input("NoProduksi", sql.VarChar(50), noProduksi)
    .input("NoBonggolan", sql.VarChar(50), noBonggolan)
    .input("DateCreate", sql.Date, dateCreate)
    .input("IdBonggolan", sql.Int, idBonggolan)
    .input("IdWarehouse", sql.Int, idWarehouse ?? null)
    .input("Berat", sql.Decimal(18, 3), berat)
    .input("IdStatus", sql.Int, 1)
    .input("Blok", sql.VarChar(50), blok ?? null)
    .input("IdLokasi", sql.Int, idLokasi ?? null)
    .input("CreateBy", sql.VarChar(50), createBy)
    .input("DateTimeCreate", sql.DateTime, nowDateTime).query(`
      INSERT INTO dbo.Bonggolan (
        NoBonggolan, DateCreate, IdBonggolan, IdWarehouse, DateUsage,
        Berat, IdStatus, Blok, IdLokasi, CreateBy, DateTimeCreate
      )
      VALUES (
        @NoBonggolan, @DateCreate, @IdBonggolan, @IdWarehouse, NULL,
        @Berat, @IdStatus, @Blok, @IdLokasi, @CreateBy, @DateTimeCreate
      );

      INSERT INTO dbo.InjectProduksiOutputBonggolan (NoProduksi, NoBonggolan)
      VALUES (@NoProduksi, @NoBonggolan);
    `);

  return noBonggolan;
}

async function createInjectRejectLabel(
  tx,
  {
    noProduksi,
    idReject,
    berat,
    hourStart,
    dateCreate,
    nowDateTime,
    createBy,
    blok,
    idLokasi,
    idWarehouse,
  },
) {
  const noReject = await generateUniqueCode(tx, {
    tableName: "dbo.RejectV2",
    columnName: "NoReject",
    prefix: "BF.",
    width: 10,
  });

  await new sql.Request(tx)
    .input("NoProduksi", sql.VarChar(50), noProduksi)
    .input("NoReject", sql.VarChar(50), noReject)
    .input("IdReject", sql.Int, idReject)
    .input("DateCreate", sql.Date, dateCreate)
    .input("IdWarehouse", sql.Int, idWarehouse ?? null)
    .input("Berat", sql.Decimal(18, 3), berat)
    .input("Jam", sql.VarChar(20), hourStart)
    .input("CreateBy", sql.VarChar(50), createBy)
    .input("DateTimeCreate", sql.DateTime, nowDateTime)
    .input("IsPartial", sql.Bit, 0)
    .input("Blok", sql.VarChar(50), blok ?? null)
    .input("IdLokasi", sql.Int, idLokasi ?? null).query(`
      INSERT INTO dbo.RejectV2 (
        NoReject, IdReject, DateCreate, DateUsage, IdWarehouse,
        Berat, Jam, CreateBy, DateTimeCreate, IsPartial, Blok, IdLokasi
      )
      VALUES (
        @NoReject, @IdReject, @DateCreate, NULL, @IdWarehouse,
        @Berat, @Jam, @CreateBy, @DateTimeCreate, @IsPartial, @Blok, @IdLokasi
      );

      INSERT INTO dbo.InjectProduksiOutputRejectV2 (NoProduksi, NoReject)
      VALUES (@NoProduksi, @NoReject);
    `);

  return noReject;
}

async function submitInjectBatch(payload, ctx, { forceClose = false } = {}) {
  const noProduksi = String(payload?.noProduksi || "").trim();
  if (!noProduksi) throw badReq("noProduksi wajib");

  const hourStart = normalizeBatchHourStart(payload?.hourStart);
  if (!hourStart) throw badReq("hourStart harus format HH:mm atau HH:mm:ss");

  const toNonNegativeInt = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw badReq(`${fieldName} harus integer >= 0`);
    }
    return parsed;
  };
  const toNonNegativeFloat = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw badReq(`${fieldName} harus angka >= 0`);
    }
    return parsed;
  };

  const berat = toNonNegativeFloat(payload?.berat, "berat");
  const cycleTime = toNonNegativeFloat(payload?.cycleTime, "cycleTime");
  const counter = toNonNegativeInt(payload?.counter, "counter");

  if (!Array.isArray(payload?.items) || payload.items.length === 0) {
    throw badReq("items wajib berupa array minimal 1 elemen");
  }
  const items = payload.items.map((item, idx) => {
    const label = `items[${idx}]`;
    const idJenisRaw = item?.idJenis;
    const idJenis =
      idJenisRaw === null || idJenisRaw === undefined || idJenisRaw === ""
        ? null
        : Number(idJenisRaw);
    if (idJenis != null && (!Number.isInteger(idJenis) || idJenis <= 0)) {
      throw badReq(`${label}.idJenis harus integer positif bila diisi`);
    }
    return {
      idJenis,
      carryOverIn: toNonNegativeInt(item?.carryOverIn, `${label}.carryOverIn`),
      pcsInput: toNonNegativeInt(item?.pcsInput, `${label}.pcsInput`),
      carryOverOut: toNonNegativeInt(
        item?.carryOverOut,
        `${label}.carryOverOut`,
      ),
    };
  });
  const totalPcsInput = items.reduce((sum, item) => sum + item.pcsInput, 0);

  const idJenisSet = new Set(items.map((it) => it.idJenis));
  if (idJenisSet.size !== items.length) {
    throw badReq("items tidak boleh memiliki idJenis yang duplikat");
  }

  const bonggolan = payload?.bonggolan ?? null;
  const reject = payload?.reject ?? null;
  const isLastBatch = Boolean(bonggolan || reject || forceClose);

  if (bonggolan) {
    const idBonggolan = Number(bonggolan.idBonggolan);
    const berat = Number(bonggolan.berat);
    if (!Number.isInteger(idBonggolan) || idBonggolan <= 0) {
      throw badReq("bonggolan.idBonggolan harus integer positif");
    }
    if (!Number.isFinite(berat) || berat <= 0) {
      throw badReq("bonggolan.berat harus angka > 0");
    }
  }

  if (reject) {
    const idReject = Number(reject.idReject);
    const berat = Number(reject.berat);
    if (!Number.isInteger(idReject) || idReject <= 0) {
      throw badReq("reject.idReject harus integer positif");
    }
    if (!Number.isFinite(berat) || berat <= 0) {
      throw badReq("reject.berat harus angka > 0");
    }
  }

  const actorId = Number(ctx?.actorId);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    const headerRes = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      noProduksi,
    ).query(`
        SELECT TOP 1
          h.NoProduksi,
          h.TglProduksi,
          h.IdWarna,
          h.IdMesin,
          CASE
            WHEN fwCount.TotalCount > 0 THEN 'furnitureWip'
            WHEN bjCount.TotalCount > 0 THEN 'barangjadi'
            ELSE NULL
          END AS OutputCategory,
          CONVERT(VARCHAR(8), h.HourStart, 108) AS HourStart,
          CONVERT(VARCHAR(8), h.HourEnd,   108) AS HourEnd
        FROM dbo.InjectProduksi_h h WITH (UPDLOCK, HOLDLOCK)
        OUTER APPLY (
          SELECT COUNT(1) AS TotalCount
          FROM (
            SELECT DISTINCT dFw.IdFurnitureWIP
            FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
            WHERE dFw.IdCetakan = h.IdCetakan
              AND dFw.IdWarna = h.IdWarna
              AND (
                (dFw.IdFurnitureMaterial IS NULL
                  AND (
                    h.IdFurnitureMaterial = 0
                    OR h.IdFurnitureMaterial IS NULL
                  ))
                OR dFw.IdFurnitureMaterial = h.IdFurnitureMaterial
              )
          ) x
        ) fwCount
        OUTER APPLY (
          SELECT COUNT(1) AS TotalCount
          FROM (
            SELECT DISTINCT dBj.IdBarangJadi
            FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
            WHERE dBj.IdCetakan = h.IdCetakan
              AND dBj.IdWarna = h.IdWarna
              AND (
                (dBj.IdFurnitureMaterial IS NULL
                  AND (
                    h.IdFurnitureMaterial = 0
                    OR h.IdFurnitureMaterial IS NULL
                  ))
                OR dBj.IdFurnitureMaterial = h.IdFurnitureMaterial
              )
          ) x
        ) bjCount
        WHERE h.NoProduksi = @NoProduksi;
      `);

    const header = headerRes.recordset?.[0];
    if (!header) {
      throw notFound(`NoProduksi tidak ditemukan: ${noProduksi}`);
    }

    const docDateOnly = toDateOnly(header.TglProduksi);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: `submit batch InjectProduksi ${noProduksi}`,
      useLock: true,
    });

    if (bonggolan) {
      const bonggolanRes = await new sql.Request(tx).input(
        "IdBonggolan",
        sql.Int,
        Number(bonggolan.idBonggolan),
      ).query(`
          SELECT TOP 1 IdBonggolan
          FROM dbo.MstBonggolan WITH (NOLOCK)
          WHERE IdBonggolan = @IdBonggolan
        `);
      if (!bonggolanRes.recordset?.length) {
        throw badReq(
          `bonggolan.idBonggolan tidak ditemukan: ${bonggolan.idBonggolan}`,
        );
      }
    }

    if (reject) {
      const rejectRes = await new sql.Request(tx).input(
        "IdReject",
        sql.Int,
        Number(reject.idReject),
      ).query(`
          SELECT TOP 1 IdReject
          FROM dbo.MstReject WITH (NOLOCK)
          WHERE IdReject = @IdReject
        `);
      if (!rejectRes.recordset?.length) {
        throw badReq(`reject.idReject tidak ditemukan: ${reject.idReject}`);
      }
    }

    const duplicateRes = await new sql.Request(tx)
      .input("NoProduksi", sql.VarChar(50), noProduksi)
      .input("HourStart", sql.VarChar(20), hourStart).query(`
        SELECT TOP 1 Id
        FROM dbo.InjectProduksiBatch WITH (UPDLOCK, HOLDLOCK)
        WHERE NoProduksi = @NoProduksi
          AND HourStart = CAST(@HourStart AS time(7));
      `);
    if (duplicateRes.recordset?.length) {
      throw conflict(
        `Batch untuk NoProduksi ${noProduksi} dan hourStart ${formatHourStartForResponse(hourStart)} sudah pernah disubmit.`,
      );
    }

    const idMesin = header.IdMesin ?? null;
    if (idMesin) {
      const mesinRes = await new sql.Request(tx).input(
        "IdMesin",
        sql.Int,
        idMesin,
      ).query(`
          SELECT TOP 1 CounterCurrent
          FROM dbo.MstMesinInject WITH (UPDLOCK)
          WHERE IdMesin = @IdMesin;
        `);
      const counterCurrent = Number(
        mesinRes.recordset?.[0]?.CounterCurrent ?? 0,
      );
      if (counter < counterCurrent) {
        throw badReq(
          `Counter harus >= ${counterCurrent} (counter terakhir mesin). Input: ${counter}.`,
        );
      }
    }

    const nowDateTime = new Date();
    const lokasi = await getBlokLokasiFromKodeProduksi({
      kode: noProduksi,
      runner: tx,
    });

    const batchInsertRes = await new sql.Request(tx)
      .input("NoProduksi", sql.VarChar(50), noProduksi)
      .input("HourStart", sql.VarChar(20), hourStart)
      .input("Berat", sql.Decimal(18, 3), berat)
      .input("CycleTime", sql.Decimal(18, 3), cycleTime)
      .input("Counter", sql.Int, counter)
      .input("PcsInput", sql.Int, totalPcsInput)
      .input("DateTimeCreate", sql.DateTime, nowDateTime).query(`
        DECLARE @out TABLE (Id int, HourStart time(7));

        INSERT INTO dbo.InjectProduksiBatch (
          NoProduksi, HourStart, Berat, CycleTime, Counter, PcsInput, DateTimeCreate
        )
        OUTPUT INSERTED.Id, INSERTED.HourStart INTO @out
        VALUES (
          @NoProduksi, CAST(@HourStart AS time(7)), @Berat, @CycleTime, @Counter, @PcsInput, @DateTimeCreate
        );

        SELECT Id, CONVERT(varchar(8), HourStart, 108) AS HourStart
        FROM @out;
      `);

    const batchRow = batchInsertRes.recordset?.[0] || {};
    const idBatch = batchRow.Id;

    const furnitureWIP = [];
    const barangJadi = [];

    for (const item of items) {
      const pcsInfo = await getInjectPcsPerLabelByNoProduksi(
        noProduksi,
        item.idJenis ?? null,
        payload?.outputCategory ?? header.OutputCategory ?? null,
      );
      if (item.idJenis != null && Number(pcsInfo.idJenis) !== item.idJenis) {
        throw badReq(
          `idJenis ${item.idJenis} tidak valid untuk NoProduksi ${noProduksi}`,
        );
      }

      const outputCategory = String(
        pcsInfo.outputCategory || header.OutputCategory || "",
      ).toLowerCase();

      const pcsPerLabel = Number(pcsInfo.pcsPerLabel);
      if (!Number.isFinite(pcsPerLabel) || pcsPerLabel <= 0) {
        throw conflict(
          `PcsPerLabel tidak valid untuk NoProduksi ${noProduksi}`,
        );
      }

      const totalPcs = item.carryOverIn + item.pcsInput;
      const jumlahLabel = Math.floor(totalPcs / pcsPerLabel);
      const sisaPcs = totalPcs % pcsPerLabel;

      if (jumlahLabel > 0 && item.idJenis == null) {
        throw badReq(
          "idJenis wajib diisi jika totalPcs sudah cukup minimal 1 label",
        );
      }
      if (isLastBatch && sisaPcs > 0 && item.idJenis == null) {
        throw badReq(
          "idJenis wajib diisi pada batch terakhir jika masih ada sisa pcs",
        );
      }

      await new sql.Request(tx)
        .input("IdBatch", sql.Int, idBatch)
        .input("IdJenis", sql.Int, item.idJenis)
        .input(
          "OutputCategory",
          sql.VarChar(20),
          outputCategory === "barangjadi" ? "barangjadi" : "furnitureWip",
        )
        .input("CarryOverIn", sql.Int, item.carryOverIn)
        .input("PcsInput", sql.Int, item.pcsInput)
        .input("CarryOverOut", sql.Int, item.carryOverOut).query(`
          INSERT INTO dbo.InjectProduksiBatch_d (IdBatch, IdJenis, OutputCategory, CarryOverIn, PcsInput, CarryOverOut)
          VALUES (@IdBatch, @IdJenis, @OutputCategory, @CarryOverIn, @PcsInput, @CarryOverOut);
        `);

      for (let index = 0; index < jumlahLabel; index += 1) {
        if (outputCategory === "barangjadi") {
          const code = await createInjectBarangJadiLabel(tx, {
            noProduksi,
            idBJ: item.idJenis,
            pcs: pcsPerLabel,
            hourStart,
            dateCreate: docDateOnly,
            nowDateTime,
            createBy: actorUsername,
            blok: lokasi?.Blok ?? null,
            idLokasi: lokasi?.IdLokasi ?? null,
            idWarehouse: null,
          });
          barangJadi.push(code);
        } else {
          const code = await createInjectFurnitureWipLabel(tx, {
            noProduksi,
            idFurnitureWIP: item.idJenis,
            pcs: pcsPerLabel,
            hourStart,
            idWarna: pcsInfo.idWarna,
            dateCreate: docDateOnly,
            nowDateTime,
            createBy: actorUsername,
            blok: lokasi?.Blok ?? null,
            idLokasi: lokasi?.IdLokasi ?? null,
            idWarehouse: null,
          });
          furnitureWIP.push(code);
        }
      }

      // Pada forceClose (terminate): pakai carryOverOut sebagai pcs sisa label
      // Pada batch biasa (isLastBatch via bonggolan/reject): pakai sisaPcs
      const partialPcs = forceClose ? item.carryOverOut : sisaPcs;
      if (isLastBatch && partialPcs > 0) {
        if (outputCategory === "barangjadi") {
          const partialCode = await createInjectBarangJadiLabel(tx, {
            noProduksi,
            idBJ: item.idJenis,
            pcs: partialPcs,
            hourStart,
            dateCreate: docDateOnly,
            nowDateTime,
            createBy: actorUsername,
            blok: lokasi?.Blok ?? null,
            idLokasi: lokasi?.IdLokasi ?? null,
            idWarehouse: null,
          });
          barangJadi.push(partialCode);
        } else {
          const partialCode = await createInjectFurnitureWipLabel(tx, {
            noProduksi,
            idFurnitureWIP: item.idJenis,
            pcs: partialPcs,
            hourStart,
            idWarna: pcsInfo.idWarna,
            dateCreate: docDateOnly,
            nowDateTime,
            createBy: actorUsername,
            blok: lokasi?.Blok ?? null,
            idLokasi: lokasi?.IdLokasi ?? null,
            idWarehouse: null,
          });
          furnitureWIP.push(partialCode);
        }
      }
    }

    if (idMesin) {
      await new sql.Request(tx)
        .input("IdMesin", sql.Int, idMesin)
        .input("Counter", sql.BigInt, counter)
        .input("Now", sql.DateTime, nowDateTime).query(`
          UPDATE dbo.MstMesinInject
          SET CounterCurrent   = @Counter,
              CounterUpdatedAt = @Now
          WHERE IdMesin = @IdMesin;
        `);
    }

    // Batch terakhir = hourStart batch + 1 jam == HourEnd produksi → set IsComplete
    const batchHourStart = hourStart.substring(0, 8);
    const prodHourEnd = header.HourEnd
      ? typeof header.HourEnd === "string"
        ? header.HourEnd.substring(0, 8)
        : new Date(header.HourEnd).toTimeString().substring(0, 8)
      : null;

    const shouldComplete =
      forceClose ||
      (() => {
        if (!prodHourEnd) return false;
        const toSec = (t) => {
          const [h, m, s] = t.split(":").map(Number);
          return h * 3600 + (m || 0) * 60 + (s || 0);
        };
        return toSec(batchHourStart) >= toSec(prodHourEnd) - 3600;
      })();
    if (shouldComplete) {
      await new sql.Request(tx).input("NoProduksi", sql.VarChar(50), noProduksi)
        .query(`
          UPDATE dbo.InjectProduksi_h
          SET IsComplete = 1
          WHERE NoProduksi = @NoProduksi;
        `);
    }

    const createdBonggolan = bonggolan
      ? await createInjectBonggolanLabel(tx, {
          noProduksi,
          idBonggolan: Number(bonggolan.idBonggolan),
          berat: Number(bonggolan.berat),
          dateCreate: docDateOnly,
          nowDateTime,
          createBy: actorUsername,
          blok: lokasi?.Blok ?? null,
          idLokasi: lokasi?.IdLokasi ?? null,
          idWarehouse: null,
        })
      : null;

    const createdReject = reject
      ? await createInjectRejectLabel(tx, {
          noProduksi,
          idReject: Number(reject.idReject),
          berat: Number(reject.berat),
          hourStart,
          dateCreate: docDateOnly,
          nowDateTime,
          createBy: actorUsername,
          blok: lokasi?.Blok ?? null,
          idLokasi: lokasi?.IdLokasi ?? null,
          idWarehouse: null,
        })
      : null;

    await tx.commit();

    return {
      batch: {
        id: batchRow.Id ?? null,
        hourStart: formatHourStartForResponse(batchRow.HourStart || hourStart),
      },
      outputCategory: header.OutputCategory ?? null,
      furnitureWIP,
      barangJadi,
      bonggolan: createdBonggolan,
      reject: createdReject,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw error;
  }
}

async function terminateInjectProduksi(payload, hourEnd, ctx) {
  // 1. Update HourEnd produksi
  // 2. Insert batch dengan HourStart = hourEnd
  // 3. IsComplete = 1 (forceClose)
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const actorIdNum = Number(ctx?.actorId);
    const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
    const requestId = String(ctx?.requestId || "").trim();
    await applyAuditContext(new sql.Request(tx), {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    });

    const noProduksi = String(payload?.noProduksi || "").trim();
    if (!noProduksi) throw badReq("noProduksi wajib");

    // Cek produksi ada dan lock
    const checkRes = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      noProduksi,
    ).query(`
        SELECT TOP 1 NoProduksi, IsComplete
        FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoProduksi = @NoProduksi;
      `);
    if (!checkRes.recordset?.length)
      throw notFound(`NoProduksi tidak ditemukan: ${noProduksi}`);
    if (checkRes.recordset[0].IsComplete)
      throw conflict(`Produksi ${noProduksi} sudah complete.`);

    // Update HourEnd
    await new sql.Request(tx)
      .input("NoProduksi", sql.VarChar(50), noProduksi)
      .input("HourEnd", sql.VarChar(20), hourEnd).query(`
        UPDATE dbo.InjectProduksi_h
        SET HourEnd = CASE WHEN @HourEnd IS NULL OR LTRIM(RTRIM(@HourEnd)) = '' THEN NULL ELSE CAST(@HourEnd AS time(7)) END
        WHERE NoProduksi = @NoProduksi;
      `);

    await tx.commit();
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }

  // Submit batch + forceClose dalam transaksi terpisah via submitInjectBatch
  return submitInjectBatch(payload, ctx, { forceClose: true });
}

async function completeInjectProduksi(noProduksi, ctx) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

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

    const checkRes = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      no,
    ).query(`
        SELECT TOP 1 NoProduksi, IsComplete
        FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoProduksi = @NoProduksi;
      `);

    if (!checkRes.recordset?.length) {
      throw notFound(`NoProduksi tidak ditemukan: ${no}`);
    }

    if (checkRes.recordset[0].IsComplete) {
      throw conflict(`Produksi ${no} sudah complete.`);
    }

    await new sql.Request(tx).input("NoProduksi", sql.VarChar(50), no).query(`
        UPDATE dbo.InjectProduksi_h
        SET IsComplete = 1
        WHERE NoProduksi = @NoProduksi;
      `);

    await tx.commit();

    return {
      noProduksi: no,
      isComplete: true,
      status: "complete",
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw error;
  }
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

  const normalizedOutputs = normalizeOutputs(outputs);

  return {
    noProduksi: no,
    ...(await getFormulaInputsByCategory({
      pool,
      outputCategory: header.OutputCategory,
      outputs: normalizedOutputs,
    })),
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
    // InputMode: dihitung sistem (bukan input client), agar tidak bisa
    // "dicurangi" — realtime hanya jika now berada dalam jam shift
    // (hourStart-hourEnd) pada tglProduksi efektif, selain itu backdate.
    // ===============================
    const inputMode = isCurrentProduksi({
      tglProduksi: effectiveDate,
      hourStart: body.hourStart,
      hourEnd: body.hourEnd,
      now: new Date(),
    })
      ? "realtime"
      : "backdate";

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
    // Precondition: satu mesin tidak boleh punya produksi inject aktif
    // lebih dari satu pada saat create.
    // ===============================
    await assertNoIncompleteProduksiForMesin(tx, body.idMesin);

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
      .input("HourEnd", sql.VarChar(20), body.hourEnd)
      .input("InputMode", sql.VarChar(20), inputMode);

    const insertSql = `
      DECLARE @tmp TABLE (
        NoProduksi varchar(50), IdMesin int, TglProduksi date,
        Jam int, Shift int, IdRegu int, CreateBy varchar(100), CheckBy1 varchar(100),
        CheckBy2 varchar(100), ApproveBy varchar(100), JmlhAnggota int,
        Hadir int, IdCetakan int, IdWarna int, EnableOffset bit,
        OffsetCurrent int, OffsetNext int, IdFurnitureMaterial int,
        HourMeter decimal(18,2), BeratProdukHasilTimbang decimal(18,2),
        HourStart time(7), HourEnd time(7), InputMode varchar(20)
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
        HourStart, HourEnd, InputMode
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
        INSERTED.HourEnd,
        INSERTED.InputMode
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
        CASE WHEN @HourEnd   IS NULL OR LTRIM(RTRIM(@HourEnd))   = '' THEN NULL ELSE CAST(@HourEnd   AS time(7)) END,
        @InputMode
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
async function assertNoReferencedInjectInputs(tx, noProduksi) {
  const req = new sql.Request(tx);
  req.input("NoProduksi", sql.VarChar(50), noProduksi);

  // Single source of truth: mapping tabel input/partial/upsert/output dari config.
  const referenced = getReferencedTables("injectProduksi");

  // Tabel input khusus inject yang belum masuk shared config
  // (punya jalur delete tersendiri berbasis IdCabinetWIP).
  const EXTRA_REFERENCED = [
    { mappingTable: "InjectProduksiInputCabinetWIP", codeColumn: "NoProduksi" },
  ];

  const seen = new Set(referenced.map((r) => r.mappingTable));
  const allRefs = [
    ...referenced,
    ...EXTRA_REFERENCED.filter((r) => !seen.has(r.mappingTable)),
  ];

  // Nama tabel & kolom berasal dari config statis (bukan input user) → aman.
  const unionSql = allRefs
    .map(
      ({ mappingTable, codeColumn }) =>
        `SELECT '${mappingTable}' AS SourceTable\n` +
        `      FROM dbo.${mappingTable} WITH (NOLOCK)\n` +
        `      WHERE ${codeColumn} = @NoProduksi`,
    )
    .join("\n\n      UNION ALL\n\n      ");

  const result = await req.query(`
    SELECT TOP 1 SourceTable
    FROM (
      ${unionSql}
    ) AS refs;
  `);

  const sourceTable = result.recordset?.[0]?.SourceTable || null;
  if (sourceTable) {
    throw conflict(
      `NoProduksi ${noProduksi} tidak boleh diubah atau dihapus karena sudah memiliki relasi input/output pada tabel ${sourceTable}. Hapus input atau output terlebih dahulu.`,
    );
  }
}

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
    const existsReq = new sql.Request(tx);
    existsReq.input("NoProduksi", sql.VarChar(50), noProduksi);
    const existsRes = await existsReq.query(`
      SELECT TOP 1 NoProduksi
      FROM dbo.InjectProduksi_h WITH (UPDLOCK, HOLDLOCK)
      WHERE NoProduksi = @NoProduksi;
    `);

    if (!existsRes.recordset?.length) {
      throw notFound(`NoProduksi tidak ditemukan: ${noProduksi}`);
    }

    await assertNoReferencedInjectInputs(tx, noProduksi);

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
    const resolvedIdOperator = hasIdOperators
      ? (normalizedOperatorIds[0] ?? null)
      : payload?.idOperator !== undefined
        ? (payload.idOperator ?? null)
        : undefined;

    if (payload.tglProduksi !== undefined) {
      if (!payload.tglProduksi) throw badReq("tglProduksi tidak boleh kosong");
      sets.push("TglProduksi = @TglProduksi");
      rqUpd.input(
        "TglProduksi",
        sql.Date,
        resolveEffectiveDateForCreate(payload.tglProduksi),
      );
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

    const shouldUpdateHeader = sets.length > 0;
    if (
      !shouldUpdateHeader &&
      !hasIdOperators &&
      resolvedIdOperator === undefined
    ) {
      throw badReq("No fields to update");
    }

    let updRes = { recordset: [] };
    if (shouldUpdateHeader) {
      rqUpd.input("NoProduksi", sql.VarChar(50), noProduksi);

      const updateSql = `
        UPDATE dbo.InjectProduksi_h
        SET ${sets.join(", ")}
        WHERE NoProduksi = @NoProduksi;

        SELECT *
        FROM dbo.InjectProduksi_h
        WHERE NoProduksi = @NoProduksi;
      `;

      await applyAuditContext(rqUpd, auditCtx);
      updRes = await rqUpd.query(updateSql);
    } else {
      const rqHeader = new sql.Request(tx);
      rqHeader.input("NoProduksi", sql.VarChar(50), noProduksi);
      updRes = await rqHeader.query(`
        SELECT *
        FROM dbo.InjectProduksi_h
        WHERE NoProduksi = @NoProduksi;
      `);
    }
    if (hasIdOperators || resolvedIdOperator !== undefined) {
      const operatorIdsToPersist = hasIdOperators
        ? normalizedOperatorIds
        : resolvedIdOperator == null
          ? []
          : [Math.trunc(Number(resolvedIdOperator))].filter(
              (value) => Number.isFinite(value) && value > 0,
            );

      const rqOpDelete = new sql.Request(tx);
      rqOpDelete.input("NoProduksi", sql.VarChar(50), noProduksi);
      await applyAuditContext(rqOpDelete, auditCtx);
      await rqOpDelete.query(`
        DELETE FROM dbo.InjectProduksiOperator_d
        WHERE NoProduksi = @NoProduksi;
      `);

      if (operatorIdsToPersist.length > 0) {
        const rqOpInsert = new sql.Request(tx);
        rqOpInsert.input("NoProduksi", sql.VarChar(50), noProduksi);
        const opValues = operatorIdsToPersist.map((opId, index) => {
          const paramName = `DetailOp${index}`;
          rqOpInsert.input(paramName, sql.Int, opId);
          return `(@NoProduksi, @${paramName})`;
        });

        await applyAuditContext(rqOpInsert, auditCtx);
        await rqOpInsert.query(`
          INSERT INTO dbo.InjectProduksiOperator_d (NoProduksi, IdOperator)
          VALUES ${opValues.join(", ")};
        `);
      }
    }

    const updatedHeader = updRes.recordset?.[0]
      ? {
          ...updRes.recordset[0],
          ...(hasIdOperators || resolvedIdOperator !== undefined
            ? {
                IdOperator: hasIdOperators
                  ? (normalizedOperatorIds[0] ?? null)
                  : (resolvedIdOperator ?? null),
                IdOperators: hasIdOperators
                  ? normalizedOperatorIds
                  : resolvedIdOperator == null
                    ? []
                    : [resolvedIdOperator],
              }
            : {}),
        }
      : null;

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
    const rq = new sql.Request(tx);
    await applyAuditContext(rq, {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    });

    rq.input("NoProduksi", sql.VarChar(50), noProduksi);

    await assertNoReferencedInjectInputs(tx, noProduksi);

    const res = await rq.query(`
      DELETE FROM dbo.InjectProduksi_h
      WHERE NoProduksi = @NoProduksi;
    `);

    if (!res.rowsAffected?.[0]) {
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
      fw.Pcs,
      fw.DateTimeCreate
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
    DateTimeCreate: r.DateTimeCreate ?? null,
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
      ISNULL(b.HasBeenPrinted, 0) AS HasBeenPrinted,
      b.DateTimeCreate
    FROM dbo.InjectProduksiOutputBonggolan o WITH (NOLOCK)
    LEFT JOIN dbo.Bonggolan b WITH (NOLOCK)
      ON b.NoBonggolan = o.NoBonggolan
    LEFT JOIN dbo.MstBonggolan mb WITH (NOLOCK)
      ON mb.IdBonggolan = b.IdBonggolan
    WHERE o.NoProduksi = @no
    ORDER BY o.NoBonggolan DESC;
  `;

  const rs = await req.query(q);
  const rows = rs.recordset || [];
  return rows.map((r) => ({
    NoProduksi: r.NoProduksi,
    NoBonggolan: r.NoBonggolan,
    IdBonggolan: r.IdBonggolan ?? null,
    NamaBonggolan: r.NamaBonggolan ?? null,
    Berat: r.Berat ?? null,
    HasBeenPrinted: r.HasBeenPrinted ?? 0,
    DateTimeCreate: r.DateTimeCreate ?? null,
  }));
}

async function fetchOutputsFurnitureWip(noProduksi) {
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
      fw.Pcs,
      fw.DateTimeCreate
    FROM dbo.InjectProduksiOutputFurnitureWIP o WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
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
    DateTimeCreate: r.DateTimeCreate ?? null,
  }));
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
      bj.Pcs,
      bj.DateTimeCreate
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
    DateTimeCreate: r.DateTimeCreate ?? null,
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
      CAST(NULL AS int) AS Pcs,
      rj.DateTimeCreate
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
    DateTimeCreate: r.DateTimeCreate ?? null,
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

  const auditCtx = {
    actorId: Math.trunc(actorIdNum),
    actorUsername,
    requestId,
  };

  const cabinetWip = Array.isArray(body.cabinetWIP) ? body.cabinetWIP : [];
  const { cabinetWIP: _cabinetWIP, ...sharedPayload } = body;

  const hasSharedPayload = Object.values(sharedPayload).some(
    (value) => Array.isArray(value) && value.length > 0,
  );

  const sharedResult = hasSharedPayload
    ? await sharedInputService.deleteInputsAndPartials(
        "injectProduksi",
        no,
        sharedPayload,
        auditCtx,
      )
    : {
        success: false,
        hasWarnings: false,
        data: {
          noProduksi: no,
          summary: {
            totalDeleted: 0,
            totalNotFound: 0,
            totalPartialsDeleted: 0,
            totalPartialsNotFound: 0,
          },
          details: {
            inputs: [],
            partials: [],
          },
          meta: {
            audit: auditCtx,
          },
        },
      };

  const cabinetWipResult =
    cabinetWip.length > 0
      ? await deleteInjectCabinetWipInputs(no, cabinetWip, auditCtx)
      : null;

  if (!cabinetWipResult) {
    return sharedResult;
  }

  const sharedData = sharedResult.data || {};
  const cabinetData = cabinetWipResult.data || {};

  const mergedData = {
    noProduksi: no,
    summary: {
      totalDeleted:
        Number(sharedData.summary?.totalDeleted || 0) +
        Number(cabinetData.summary?.totalDeleted || 0),
      totalNotFound:
        Number(sharedData.summary?.totalNotFound || 0) +
        Number(cabinetData.summary?.totalNotFound || 0),
      totalPartialsDeleted: Number(
        sharedData.summary?.totalPartialsDeleted || 0,
      ),
      totalPartialsNotFound: Number(
        sharedData.summary?.totalPartialsNotFound || 0,
      ),
    },
    details: {
      inputs: [
        ...(Array.isArray(sharedData.details?.inputs)
          ? sharedData.details.inputs
          : []),
        ...(Array.isArray(cabinetData.details?.inputs)
          ? cabinetData.details.inputs
          : []),
      ],
      partials: Array.isArray(sharedData.details?.partials)
        ? sharedData.details.partials
        : [],
    },
    meta: {
      audit: auditCtx,
    },
  };

  return {
    success: Boolean(sharedResult.success || cabinetWipResult.success),
    hasWarnings: Boolean(
      sharedResult.hasWarnings || cabinetWipResult.hasWarnings,
    ),
    data: mergedData,
  };
}

async function deleteInjectCabinetWipInputs(noProduksi, items, ctx) {
  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }

  const payload = Array.isArray(items) ? items : [];
  const requestedItems = payload
    .map((item) => ({
      idCabinetWIP: Number(item?.idCabinetWIP),
    }))
    .filter(
      (item) => Number.isInteger(item.idCabinetWIP) && item.idCabinetWIP > 0,
    );

  if (requestedItems.length === 0) {
    return {
      success: false,
      hasWarnings: false,
      data: {
        noProduksi,
        summary: {
          totalDeleted: 0,
          totalNotFound: 0,
        },
        details: {
          inputs: [],
        },
      },
    };
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const req = new sql.Request(tx);
    await applyAuditContext(req, ctx);
    req.input("NoProduksi", sql.VarChar(50), noProduksi);
    req.input(
      "jsonItems",
      sql.NVarChar(sql.MAX),
      JSON.stringify(requestedItems),
    );

    const result = await req.query(`
      DECLARE @deleted int = 0;
      DECLARE @requested int = 0;

      SELECT @requested = COUNT(*)
      FROM OPENJSON(@jsonItems)
      WITH (idCabinetWIP int '$.idCabinetWIP');

      SELECT @deleted = COUNT(*)
      FROM dbo.InjectProduksiInputCabinetWIP map
      INNER JOIN OPENJSON(@jsonItems)
      WITH (idCabinetWIP int '$.idCabinetWIP') j
        ON map.IdCabinetWIP = j.idCabinetWIP
      WHERE map.NoProduksi = @NoProduksi;

      DELETE map
      FROM dbo.InjectProduksiInputCabinetWIP map
      INNER JOIN OPENJSON(@jsonItems)
      WITH (idCabinetWIP int '$.idCabinetWIP') j
        ON map.IdCabinetWIP = j.idCabinetWIP
      WHERE map.NoProduksi = @NoProduksi;

      SELECT
        @deleted AS Deleted,
        (@requested - @deleted) AS NotFound;
    `);

    await tx.commit();

    const deleted = Number(result.recordset?.[0]?.Deleted || 0);
    const notFound = Number(result.recordset?.[0]?.NotFound || 0);

    return {
      success: deleted > 0,
      hasWarnings: notFound > 0,
      data: {
        noProduksi,
        summary: {
          totalDeleted: deleted,
          totalNotFound: notFound,
        },
        details: {
          inputs: [
            {
              section: "cabinetWIP",
              label: "Cabinet WIP",
              requested: requestedItems.length,
              deleted,
              notFound,
              status: notFound > 0 ? "warning" : "success",
              message: `Cabinet WIP: ${deleted} berhasil dihapus${notFound > 0 ? `, ${notFound} tidak ditemukan` : ""}`,
            },
          ],
        },
      },
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw error;
  }
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
  const batchPayload =
    payload?.batch && typeof payload.batch === "object" ? payload.batch : null;

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

    // ✅ InputMode: dihitung sistem untuk row hasil split, sama seperti create.
    const inputMode = isCurrentProduksi({
      tglProduksi: tanggal,
      hourStart,
      hourEnd,
      now: new Date(),
    })
      ? "realtime"
      : "backdate";

    const insReq = new sql.Request(tx);
    insReq
      .input("NewNoProduksi", sql.VarChar(50), newNoProduksi)
      .input("SourceNoProduksi", sql.VarChar(50), sourceNo)
      .input("NewHourStart", sql.VarChar(20), hourStart)
      .input("NewHourEnd", sql.VarChar(20), hourEnd)
      .input("InputMode", sql.VarChar(20), inputMode)
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
        IdRegu int,
        InputMode varchar(20)
      );

      INSERT INTO dbo.InjectProduksi_h (
        NoProduksi, IdMesin, TglProduksi, Jam, Shift, CreateBy,
        CheckBy1, CheckBy2, ApproveBy, JmlhAnggota, Hadir,
        IdCetakan, IdWarna, EnableOffset, OffsetCurrent, OffsetNext,
        IdFurnitureMaterial, HourMeter, BeratProdukHasilTimbang,
        HourStart, HourEnd, IdRegu, InputMode
      )
      OUTPUT
        INSERTED.NoProduksi, INSERTED.IdMesin, INSERTED.TglProduksi, INSERTED.Jam,
        INSERTED.Shift, INSERTED.CreateBy, INSERTED.CheckBy1, INSERTED.CheckBy2,
        INSERTED.ApproveBy, INSERTED.JmlhAnggota, INSERTED.Hadir, INSERTED.IdCetakan,
        INSERTED.IdWarna, INSERTED.EnableOffset, INSERTED.OffsetCurrent, INSERTED.OffsetNext,
        INSERTED.IdFurnitureMaterial, INSERTED.HourMeter, INSERTED.BeratProdukHasilTimbang,
        INSERTED.HourStart, INSERTED.HourEnd, INSERTED.IdRegu, INSERTED.InputMode
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
        h.IdRegu,
        @InputMode
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

    // Source produksi selesai saat di-split — set IsComplete = 1 langsung
    await new sql.Request(tx).input(
      "SourceNoProduksi",
      sql.VarChar(50),
      sourceNo,
    ).query(`
        UPDATE dbo.InjectProduksi_h
        SET IsComplete = 1
        WHERE NoProduksi = @SourceNoProduksi;
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

    let sourceBatchResult = null;
    if (batchPayload) {
      sourceBatchResult = await submitInjectBatch(
        {
          ...batchPayload,
          noProduksi: sourceNo,
          hourStart: batchPayload.hourStart ?? hourStart,
        },
        ctx,
        { forceClose: true },
      );
    }

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
      sourceBatch: sourceBatchResult,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

// ============================================================
// ✅ QC counter checkpoint per mesin (independen dari MstMesinInject)
// ============================================================
async function getInjectQcCounters() {
  const pool = await poolPromise;
  const res = await new sql.Request(pool).query(`
    SELECT
      mi.IdMesin,
      mi.NamaMesin,
      ISNULL(qc.CounterCurrent, 0) AS CounterCurrent,
      qc.UpdatedBy,
      qc.DateTimeUpdate
    FROM dbo.MstMesinInject mi WITH (NOLOCK)
    LEFT JOIN dbo.InjectProduksiQcCounter qc WITH (NOLOCK)
      ON qc.IdMesin = mi.IdMesin
    ORDER BY mi.IdMesin;
  `);
  return (res.recordset || []).map((row) => ({
    idMesin: row.IdMesin ?? null,
    namaMesin: row.NamaMesin ?? null,
    counterCurrent: row.CounterCurrent == null ? 0 : Number(row.CounterCurrent),
    updatedBy: row.UpdatedBy ?? null,
    dateTimeUpdate: row.DateTimeUpdate ?? null,
  }));
}

async function getInjectQcCounterByMesin(idMesin) {
  const id = Number(idMesin);
  if (!Number.isInteger(id) || id <= 0) throw badReq("idMesin tidak valid");

  const pool = await poolPromise;
  const res = await new sql.Request(pool).input("IdMesin", sql.Int, id).query(`
    SELECT
      mi.IdMesin,
      mi.NamaMesin,
      ISNULL(qc.CounterCurrent, 0) AS CounterCurrent,
      qc.UpdatedBy,
      qc.DateTimeUpdate
    FROM dbo.MstMesinInject mi WITH (NOLOCK)
    LEFT JOIN dbo.InjectProduksiQcCounter qc WITH (NOLOCK)
      ON qc.IdMesin = mi.IdMesin
    WHERE mi.IdMesin = @IdMesin;
  `);
  const row = res.recordset?.[0];
  if (!row) throw notFound(`Mesin inject IdMesin ${id} tidak ditemukan`);
  return {
    idMesin: row.IdMesin ?? null,
    namaMesin: row.NamaMesin ?? null,
    counterCurrent: row.CounterCurrent == null ? 0 : Number(row.CounterCurrent),
    updatedBy: row.UpdatedBy ?? null,
    dateTimeUpdate: row.DateTimeUpdate ?? null,
  };
}

async function getInjectQcCounterByNoProduksi(noProduksi) {
  const no = String(noProduksi || "").trim();
  if (!no) throw badReq("noProduksi wajib");

  const pool = await poolPromise;
  const res = await new sql.Request(pool).input(
    "NoProduksi",
    sql.VarChar(50),
    no,
  ).query(`
      SELECT
        h.NoProduksi,
        h.IdMesin,
        mi.NamaMesin,
        ISNULL(qc.CounterCurrent, 0) AS CounterCurrent,
        qc.UpdatedBy,
        qc.DateTimeUpdate
      FROM dbo.InjectProduksi_h h WITH (NOLOCK)
      LEFT JOIN dbo.MstMesinInject mi WITH (NOLOCK)
        ON mi.IdMesin = h.IdMesin
      LEFT JOIN dbo.InjectProduksiQcCounter qc WITH (NOLOCK)
        ON qc.IdMesin = h.IdMesin
      WHERE h.NoProduksi = @NoProduksi;
    `);
  const row = res.recordset?.[0];
  if (!row) throw notFound(`InjectProduksi ${no} tidak ditemukan`);

  const counterCurrent =
    row.CounterCurrent == null ? 0 : Number(row.CounterCurrent);
  return {
    noProduksi: row.NoProduksi,
    idMesin: row.IdMesin ?? null,
    namaMesin: row.NamaMesin ?? null,
    counterCurrent,
    // Batas minimum untuk input counter QC berikutnya (save harus >= nilai ini).
    minCounter: counterCurrent,
    updatedBy: row.UpdatedBy ?? null,
    dateTimeUpdate: row.DateTimeUpdate ?? null,
  };
}

async function resetInjectQcCounter(idMesin, payload, ctx) {
  const id = Number(idMesin);
  if (!Number.isInteger(id) || id <= 0) throw badReq("idMesin tidak valid");

  const value =
    payload?.value === null || payload?.value === undefined
      ? 0
      : Number(payload.value);
  if (!Number.isInteger(value) || value < 0) {
    throw badReq("value harus integer >= 0");
  }

  const actorId = Number(ctx?.actorId);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    // Pastikan mesin terdaftar di master mesin inject.
    const mesinRes = await new sql.Request(tx).input("IdMesin", sql.Int, id)
      .query(`
        SELECT TOP 1 IdMesin
        FROM dbo.MstMesinInject WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin;
      `);
    if (!mesinRes.recordset?.length) {
      throw notFound(`Mesin inject IdMesin ${id} tidak ditemukan`);
    }

    await new sql.Request(tx)
      .input("IdMesin", sql.Int, id)
      .input("Counter", sql.Int, value)
      .input("UpdatedBy", sql.VarChar(50), actorUsername).query(`
        MERGE dbo.InjectProduksiQcCounter AS t
        USING (SELECT @IdMesin AS IdMesin) AS s
          ON t.IdMesin = s.IdMesin
        WHEN MATCHED THEN
          UPDATE SET CounterCurrent = @Counter,
                     UpdatedBy = @UpdatedBy,
                     DateTimeUpdate = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (IdMesin, CounterCurrent, UpdatedBy, DateTimeUpdate)
          VALUES (@IdMesin, @Counter, @UpdatedBy, GETDATE());
      `);

    await tx.commit();

    return {
      idMesin: id,
      counterCurrent: value,
      updatedBy: actorUsername,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw error;
  }
}

module.exports = {
  getAllProduksi,
  getProduksiByDate,
  getFurnitureWipListByNoProduksi,
  getPackingListByNoProduksi,
  getInjectPcsPerLabelByNoProduksi,
  getInjectPcsPerLabelListByNoProduksi,
  getInjectBatchByNoProduksi,
  getInjectQcByNoProduksi,
  createInjectQc,
  updateInjectQc,
  getInjectQcCounters,
  getInjectQcCounterByMesin,
  getInjectQcCounterByNoProduksi,
  resetInjectQcCounter,
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
  submitInjectBatch,
  terminateInjectProduksi,
  completeInjectProduksi,
  upsertInputsAndPartials,
  deleteInputsAndPartials,
  splitProduksiTime,
};
