const { sql, poolPromise } = require("../../core/config/db");
const { getAllKategori } = require("../master-kategori/master-kategori-service");
const { getJenisByKategori } = require("../master-jenis/master-jenis-service");
const { generateNextCode } = require("../../core/utils/sequence-code-helper");
const { applyAuditContext } = require("../../core/utils/db-audit-context");
const {
  assertNotLocked,
  resolveEffectiveDateForCreate,
} = require("../../core/shared/tutup-transaksi-guard");
const { badReq, notFound, conflict } = require("../../core/utils/http-error");
const {
  STOCK_OPNAME_SNAPSHOT_CONFIG,
} = require("../../core/config/stock-opname-snapshot.config");

const STOCK_OPNAME_STATUS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
};

async function getAllKategoriWithStatus() {
  const kategoriList = await getAllKategori();
  if (!kategoriList.length) return kategoriList;

  const pool = await poolPromise;
  const now = new Date();

  const ranked = await pool
    .request()
    .input("year", sql.Int, now.getFullYear())
    .input("month", sql.Int, now.getMonth() + 1)
    .query(`
      ;WITH ranked AS (
        SELECT
          NoSO, IdKategori, Tanggal, IsComplete,
          ROW_NUMBER() OVER (PARTITION BY IdKategori ORDER BY Tanggal DESC, NoSO DESC) AS rn
        FROM dbo.StockOpname_h
        WHERE IdKategori IS NOT NULL
          AND YEAR(Tanggal) = @year
          AND MONTH(Tanggal) = @month
      )
      SELECT IdKategori, NoSO, IsComplete FROM ranked WHERE rn = 1;
    `);

  const statusByIdKategori = new Map(
    ranked.recordset.map((r) => [r.IdKategori, r]),
  );

  return Promise.all(
    kategoriList.map(async (k) => {
      const base = {
        categoryId: k.IdKategori,
        categoryCode: k.KodeKategori,
        categoryName: k.NamaKategori,
      };
      const row = statusByIdKategori.get(k.IdKategori);
      if (!row) {
        return {
          ...base,
          stockOpnameNo: null,
          status: STOCK_OPNAME_STATUS.NOT_STARTED,
          labelCount: 0,
          scannedCount: 0,
        };
      }

      const categoryCode = String(k.KodeKategori || "").trim().toLowerCase();
      const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];

      let labelCount = 0;
      let scannedCount = 0;
      if (cfg) {
        const scannedMatchSql = [
          "h.NoSO = src.NoSO",
          ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
        ].join(" AND ");

        const countRes = await pool.request().input("stockOpnameNo", sql.VarChar, row.NoSO).query(`
          SELECT
            COUNT(*) AS labelCount,
            SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
          FROM dbo.${cfg.snapshotTable} AS src
          LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
          WHERE src.NoSO = @stockOpnameNo;
        `);
        labelCount = countRes.recordset?.[0]?.labelCount || 0;
        scannedCount = countRes.recordset?.[0]?.scannedCount || 0;
      }

      return {
        ...base,
        stockOpnameNo: row.NoSO,
        status: row.IsComplete ? STOCK_OPNAME_STATUS.COMPLETED : STOCK_OPNAME_STATUS.IN_PROGRESS,
        labelCount,
        scannedCount,
      };
    }),
  );
}

async function resolveStockOpnameCategory(pool, stockOpnameNo) {
  const no = String(stockOpnameNo || "").trim();
  if (!no) throw badReq("stockOpnameNo wajib diisi");

  const headerRes = await pool.request().input("stockOpnameNo", sql.VarChar, no).query(`
    SELECT NoSO, Tanggal, IdKategori, IsComplete FROM dbo.StockOpname_h WHERE NoSO = @stockOpnameNo;
  `);
  const header = headerRes.recordset?.[0];
  if (!header) throw notFound(`Stock opname tidak ditemukan: ${no}`);
  if (!header.IdKategori) {
    throw badReq(`Stock opname ${no} belum punya categoryId (bukan sesi stock-opname-v2)`);
  }

  const categoryRes = await pool
    .request()
    .input("categoryId", sql.Int, header.IdKategori)
    .query(`SELECT KodeKategori, NamaKategori FROM dbo.MstKategori WHERE IdKategori = @categoryId;`);
  const categoryRow = categoryRes.recordset?.[0];
  const categoryCode = categoryRow?.KodeKategori
    ? String(categoryRow.KodeKategori).trim().toLowerCase()
    : null;
  if (!categoryCode) {
    throw badReq(`MstKategori tidak ditemukan untuk categoryId: ${header.IdKategori}`);
  }

  const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];
  if (!cfg) throw badReq(`categoryCode tidak dikenali: ${categoryCode}`);

  return { no, header, categoryRow, categoryCode, cfg };
}

async function generateStockOpname({ categoryId, date, ctx }) {
  const categoryIdNum = Number(categoryId);
  if (!Number.isInteger(categoryIdNum) || categoryIdNum <= 0) {
    throw badReq("categoryId wajib berupa integer valid");
  }
  if (!date) throw badReq("date wajib diisi");

  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  const docDateOnly = resolveEffectiveDateForCreate(date);

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const auditReq = new sql.Request(tx);
    await applyAuditContext(auditReq, {
      actorId: Math.trunc(actorIdNum),
      actorUsername,
      requestId,
    });

    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "membuat stock opname",
      useLock: true,
    });

    const categoryReq = new sql.Request(tx);
    categoryReq.input("categoryId", sql.Int, categoryIdNum);
    const categoryRes = await categoryReq.query(`
      SELECT KodeKategori FROM dbo.MstKategori WHERE IdKategori = @categoryId;
    `);
    const categoryCode = categoryRes.recordset?.[0]?.KodeKategori
      ? String(categoryRes.recordset[0].KodeKategori).trim().toLowerCase()
      : null;
    if (!categoryCode) {
      throw badReq(`MstKategori tidak ditemukan untuk categoryId: ${categoryIdNum}`);
    }

    const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];
    if (!cfg) throw badReq(`categoryCode tidak dikenali: ${categoryCode}`);

    const stockOpnameNo = await generateNextCode(tx, {
      tableName: "dbo.StockOpname_h",
      columnName: "NoSO",
      prefix: "SO.",
      width: 10,
    });

    const headerReq = new sql.Request(tx);
    headerReq.input("stockOpnameNo", sql.VarChar, stockOpnameNo);
    headerReq.input("date", sql.Date, docDateOnly);
    headerReq.input("categoryId", sql.Int, categoryIdNum);

    await headerReq.query(`
      INSERT INTO dbo.StockOpname_h (NoSO, Tanggal, IdKategori, IsComplete)
      VALUES (@stockOpnameNo, @date, @categoryId, 0);
    `);

    const snapshotReq = new sql.Request(tx);
    snapshotReq.input("noso", sql.VarChar, stockOpnameNo);
    snapshotReq.input("tanggal", sql.Date, docDateOnly);

    const insertColumnsSql = cfg.insertColumns.join(", ");
    const result = await snapshotReq.query(`
      ${cfg.cteSql || ""}
      INSERT INTO dbo.${cfg.snapshotTable} (NoSO, ${insertColumnsSql})
      ${cfg.finalSelectSql}
    `);

    await tx.commit();

    return {
      stockOpnameNo,
      date: docDateOnly,
      categoryId: categoryIdNum,
      categoryCode,
      hasDateFilter: cfg.hasDateCreateFilter,
      labelCount: result.rowsAffected?.[0] || 0,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function completeStockOpname({ stockOpnameNo, ctx }) {
  const no = String(stockOpnameNo || "").trim();
  if (!no) throw badReq("stockOpnameNo wajib diisi");

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

    const checkRes = await new sql.Request(tx).input("stockOpnameNo", sql.VarChar, no)
      .query(`
        SELECT TOP 1 NoSO, IsComplete
        FROM dbo.StockOpname_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoSO = @stockOpnameNo;
      `);

    if (!checkRes.recordset?.length) {
      throw notFound(`Stock opname tidak ditemukan: ${no}`);
    }

    if (checkRes.recordset[0].IsComplete) {
      throw conflict(`Stock opname ${no} sudah ditandai selesai.`);
    }

    await new sql.Request(tx).input("stockOpnameNo", sql.VarChar, no).query(`
      UPDATE dbo.StockOpname_h
      SET IsComplete = 1
      WHERE NoSO = @stockOpnameNo;
    `);

    await tx.commit();

    return { stockOpnameNo: no, isComplete: true };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function getTypesInStockOpname({ stockOpnameNo }) {
  const pool = await poolPromise;
  const { no, header, categoryRow, categoryCode, cfg } = await resolveStockOpnameCategory(
    pool,
    stockOpnameNo,
  );

  const jenisColumn = cfg.jenisColumn;
  const scannedMatchSql = [
    "h.NoSO = src.NoSO",
    ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
  ].join(" AND ");

  const summaryRes = await pool.request().input("stockOpnameNo", sql.VarChar, no).query(`
    SELECT
      src.${jenisColumn} AS typeId,
      COUNT(*) AS labelCount,
      ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight,
      SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
    FROM dbo.${cfg.snapshotTable} AS src
    LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
    WHERE src.NoSO = @stockOpnameNo
    GROUP BY src.${jenisColumn};
  `);

  const typeMaster = await getJenisByKategori(header.IdKategori);
  const typeNameById = new Map(
    (typeMaster?.jenis || []).map((j) => [j.IdJenis, j.NamaJenis]),
  );

  const data = (summaryRes.recordset || []).map((row) => ({
    typeId: row.typeId,
    typeName: typeNameById.get(row.typeId) ?? null,
    labelCount: row.labelCount,
    scannedCount: row.scannedCount,
    totalWeight: row.totalWeight,
  }));

  return {
    stockOpnameNo: no,
    date: header.Tanggal,
    categoryId: header.IdKategori,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    isComplete: !!header.IsComplete,
    data,
    totalRecords: data.length,
  };
}

async function getStockOpnameSnapshot({
  stockOpnameNo,
  typeId,
  blok,
  locationId,
  page = 1,
  pageSize = 20,
  search = "",
}) {
  const pool = await poolPromise;
  const { no, header, categoryRow, categoryCode, cfg } = await resolveStockOpnameCategory(
    pool,
    stockOpnameNo,
  );

  const typeIdNum = typeId !== undefined && typeId !== null && typeId !== ""
    ? Number(typeId)
    : null;
  if (typeId !== undefined && typeId !== null && typeId !== "" && !Number.isInteger(typeIdNum)) {
    throw badReq("typeId wajib berupa integer valid");
  }

  const locationIdNum = locationId !== undefined && locationId !== null && locationId !== ""
    ? Number(locationId)
    : null;
  if (
    locationId !== undefined && locationId !== null && locationId !== "" &&
    !Number.isInteger(locationIdNum)
  ) {
    throw badReq("locationId wajib berupa integer valid");
  }

  const blokTrim = String(blok || "").trim();
  if (locationIdNum !== null && !blokTrim) {
    // IdLokasi bukan unique sendirian — komposit dengan Blok (mis. IdLokasi=1 ada di banyak Blok berbeda).
    throw badReq("blok wajib diisi kalau locationId diisi");
  }

  const labelColumn = cfg.insertColumns[0];
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const searchTerm = String(search || "").trim();

  const selectColumnsSql = cfg.insertColumns.map((c) => `src.${c}`).join(", ");
  const whereSearch = searchTerm ? `AND src.${labelColumn} LIKE @search` : "";
  const whereType = typeIdNum !== null ? `AND src.${cfg.jenisColumn} = @typeId` : "";
  const whereLocation = locationIdNum !== null
    ? `AND src.Blok = @blok AND src.IdLokasi = @locationId`
    : "";

  const bindInputs = (req) => {
    req.input("stockOpnameNo", sql.VarChar, no);
    if (searchTerm) req.input("search", sql.VarChar, `%${searchTerm}%`);
    if (locationIdNum !== null) req.input("blok", sql.VarChar, blokTrim);
    if (typeIdNum !== null) req.input("typeId", sql.Int, typeIdNum);
    if (locationIdNum !== null) req.input("locationId", sql.Int, locationIdNum);
    return req;
  };

  const scannedMatchSql = ["h.NoSO = src.NoSO", ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`)].join(" AND ");

  const dataQuery = `
    SELECT
      src.NoSO, ${selectColumnsSql},
      CASE WHEN EXISTS (
        SELECT 1 FROM dbo.${cfg.hasilTable} h WHERE ${scannedMatchSql}
      ) THEN 1 ELSE 0 END AS isScanned
    FROM dbo.${cfg.snapshotTable} AS src
    WHERE src.NoSO = @stockOpnameNo ${whereType} ${whereLocation} ${whereSearch}
    ORDER BY src.${labelColumn} ASC
    OFFSET ${offset} ROWS FETCH NEXT ${ps} ROWS ONLY;
  `;
  const countQuery = `
    SELECT
      COUNT(*) AS total,
      ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight,
      SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS totalScanned
    FROM dbo.${cfg.snapshotTable} AS src
    LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
    WHERE src.NoSO = @stockOpnameNo ${whereType} ${whereLocation} ${whereSearch};
  `;

  const [dataRes, countRes] = await Promise.all([
    bindInputs(pool.request()).query(dataQuery),
    bindInputs(pool.request()).query(countQuery),
  ]);

  const total = countRes.recordset?.[0]?.total || 0;

  return {
    stockOpnameNo: no,
    date: header.Tanggal,
    categoryId: header.IdKategori,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    typeId: typeIdNum,
    blok: locationIdNum !== null ? blokTrim : null,
    locationId: locationIdNum,
    isComplete: !!header.IsComplete,
    data: dataRes.recordset || [],
    currentPage: p,
    pageSize: ps,
    totalRecords: total,
    totalPages: Math.ceil(total / ps) || 0,
    totalWeight: countRes.recordset?.[0]?.totalWeight ?? 0,
    totalScanned: countRes.recordset?.[0]?.totalScanned ?? 0,
  };
}

async function getAllBlok() {
  const pool = await poolPromise;
  const res = await pool.request().query(`
    SELECT Blok FROM dbo.MstBlok ORDER BY Blok ASC;
  `);
  return (res.recordset || []).map((r) => r.Blok);
}

async function getLocationsInBlok({ stockOpnameNo, blok }) {
  const pool = await poolPromise;
  const { no, header, categoryRow, categoryCode, cfg } = await resolveStockOpnameCategory(
    pool,
    stockOpnameNo,
  );

  const blokTrim = String(blok || "").trim();
  if (!blokTrim) throw badReq("blok wajib diisi");

  const locationRes = await pool
    .request()
    .input("blok", sql.VarChar, blokTrim)
    .input("categoryId", sql.Int, header.IdKategori)
    .query(`
      SELECT IdLokasi, Description
      FROM dbo.MstLokasi
      WHERE Blok = @blok
        AND (IdKategori IS NULL OR IdKategori = @categoryId)
        AND ISNULL(Enable, 1) = 1
      ORDER BY IdLokasi ASC;
    `);

  const locations = locationRes.recordset || [];
  if (!locations.length) {
    return {
      stockOpnameNo: no,
      categoryId: header.IdKategori,
      categoryCode,
      categoryName: categoryRow.NamaKategori,
      isComplete: !!header.IsComplete,
      blok: blokTrim,
      data: [],
      totalRecords: 0,
    };
  }

  const scannedMatchSql = ["h.NoSO = src.NoSO", ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`)].join(" AND ");

  const summaryRes = await pool
    .request()
    .input("stockOpnameNo", sql.VarChar, no)
    .input("blok", sql.VarChar, blokTrim)
    .query(`
      SELECT
        src.IdLokasi AS locationId,
        COUNT(*) AS labelCount,
        ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight,
        SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
      FROM dbo.${cfg.snapshotTable} AS src
      LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
      WHERE src.NoSO = @stockOpnameNo AND src.Blok = @blok
      GROUP BY src.IdLokasi;
    `);

  const summaryByLocationId = new Map(
    (summaryRes.recordset || []).map((r) => [r.locationId, r]),
  );

  const data = locations.map((loc) => {
    const summary = summaryByLocationId.get(loc.IdLokasi);
    return {
      locationId: loc.IdLokasi,
      description: loc.Description,
      labelCount: summary?.labelCount ?? 0,
      scannedCount: summary?.scannedCount ?? 0,
      totalWeight: summary?.totalWeight ?? 0,
    };
  });

  return {
    stockOpnameNo: no,
    categoryId: header.IdKategori,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    isComplete: !!header.IsComplete,
    blok: blokTrim,
    data,
    totalRecords: data.length,
  };
}

async function insertStockOpnameHasil({ stockOpnameNo, labelNo, palletNo, ctx }) {
  const pool = await poolPromise;
  const { no, header, categoryCode, cfg } = await resolveStockOpnameCategory(pool, stockOpnameNo);

  if (header.IsComplete) {
    throw conflict(`Stock opname ${no} sudah ditandai selesai, tidak bisa insert hasil.`);
  }

  const label = String(labelNo || "").trim();
  if (!label) throw badReq("labelNo wajib diisi");

  const needsPalletNo = cfg.labelColumns.includes("NoPallet");
  let palletNoNum = null;
  if (needsPalletNo) {
    palletNoNum = Number(palletNo);
    if (!Number.isInteger(palletNoNum)) {
      throw badReq("palletNo wajib diisi (integer) untuk kategori ini");
    }
  }

  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const labelDisplay = needsPalletNo ? `${label}-${palletNoNum}` : label;

  const labelWhereSql = needsPalletNo
    ? `${cfg.labelColumns[0]} = @label AND NoPallet = @palletNo`
    : `${cfg.labelColumns[0]} = @label`;

  const bindLabel = (req) => {
    req.input("stockOpnameNo", sql.VarChar, no);
    req.input("label", sql.VarChar, label);
    if (needsPalletNo) req.input("palletNo", sql.Int, palletNoNum);
    return req;
  };

  const hasSackCount = cfg.hasilColumns.includes("JmlhSak");
  const hasPieceCount = cfg.hasilColumns.includes("Pcs");

  // SackCount/PieceCount/Weight TIDAK diterima dari body — diambil langsung dari baris
  // acuan (StockOpname{Kategori}) yang sudah dibekukan saat generate, supaya "hasil"
  // selalu konsisten dengan apa yang dicatat sistem untuk label tersebut.
  const referenceRes = await bindLabel(pool.request()).query(`
    SELECT ${cfg.hasilColumns.join(", ")} FROM dbo.${cfg.snapshotTable}
    WHERE NoSO = @stockOpnameNo AND ${labelWhereSql};
  `);
  const referenceRow = referenceRes.recordset?.[0];
  if (!referenceRow) {
    throw notFound(`Label ${labelDisplay} tidak terdaftar di acuan stock opname ini`);
  }

  const dupRes = await bindLabel(pool.request()).query(`
    SELECT 1 FROM dbo.${cfg.hasilTable} WHERE NoSO = @stockOpnameNo AND ${labelWhereSql};
  `);
  if (dupRes.recordset?.length) {
    throw conflict(`Label ${labelDisplay} sudah discan sebelumnya`);
  }

  const insertReq = bindLabel(pool.request());
  insertReq.input("weight", sql.Float, referenceRow.Berat ?? 0);
  insertReq.input("username", sql.VarChar, actorUsername);
  if (hasSackCount) insertReq.input("sackCount", sql.Int, referenceRow.JmlhSak ?? 0);
  if (hasPieceCount) insertReq.input("pieceCount", sql.Float, referenceRow.Pcs ?? 0);

  const valuePlaceholder = {
    [cfg.labelColumns[0]]: "@label",
    NoPallet: "@palletNo",
    JmlhSak: "@sackCount",
    Pcs: "@pieceCount",
    Berat: "@weight",
  };
  const hasilColumnsSql = cfg.hasilColumns.join(", ");
  const valuesSql = cfg.hasilColumns.map((col) => valuePlaceholder[col]).join(", ");

  await insertReq.query(`
    INSERT INTO dbo.${cfg.hasilTable} (NoSO, ${hasilColumnsSql}, Username, DateTimeScan, IdDiscrepancy)
    VALUES (@stockOpnameNo, ${valuesSql}, @username, GETDATE(), NULL);
  `);

  return {
    stockOpnameNo: no,
    categoryCode,
    labelNo: labelDisplay,
    sackCount: hasSackCount ? referenceRow.JmlhSak ?? 0 : undefined,
    pieceCount: hasPieceCount ? referenceRow.Pcs ?? 0 : undefined,
    weight: referenceRow.Berat ?? 0,
  };
}

module.exports = {
  getAllKategori,
  getAllKategoriWithStatus,
  getJenisByKategori,
  generateStockOpname,
  completeStockOpname,
  getTypesInStockOpname,
  getStockOpnameSnapshot,
  insertStockOpnameHasil,
  getAllBlok,
  getLocationsInBlok,
};
