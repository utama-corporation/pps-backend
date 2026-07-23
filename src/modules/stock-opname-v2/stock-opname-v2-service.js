const { sql, poolPromise } = require("../../core/config/db");
const {
  getAllKategori,
} = require("../master-kategori/master-kategori-service");
const { getJenisByKategori } = require("../master-jenis/master-jenis-service");
const { generateNextCode } = require("../../core/utils/sequence-code-helper");
const { applyAuditContext } = require("../../core/utils/db-audit-context");
const {
  assertNotLocked,
  toDateOnly,
  formatYMD,
} = require("../../core/shared/tutup-transaksi-guard");
const { badReq, notFound, conflict } = require("../../core/utils/http-error");
const {
  STOCK_OPNAME_SNAPSHOT_CONFIG,
} = require("../../core/config/stock-opname-snapshot.config");
const MAX_LOKASI_PER_USER = 2;

const STOCK_OPNAME_STATUS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
};

// Sentinel dipakai saat label snapshot tidak punya Blok/IdLokasi tercatat
// (mis. label belum pernah ditempatkan). Dikembalikan ke client sebagai
// grouping "Lokasi Tidak Diketahui" alih-alih disembunyikan begitu saja.
const UNKNOWN_BLOK_CODE = "TIDAK_DIKETAHUI";
const UNKNOWN_LOCATION_ID = 0;
const UNKNOWN_LOCATION_LABEL = "Lokasi Tidak Diketahui";

// ================================================================
// Penugasan lokasi (MstUserLokasiAccess) — kepala gudang menugaskan user ke
// lokasi UNTUK SATU SESI STOCK OPNAME tertentu (di-scope NoSO). Begitu NoSO
// selesai, baris terkait dihapus (lihat revokeAccessByStockOpname, dipanggil
// dari completeStockOpname di bawah).
// ================================================================

async function listAllUsers() {
  const pool = await poolPromise;
  const result = await pool.request().query(`
    SELECT TOP (1000)
      IdUsername,
      Username,
      FName,
      LName,
      DefaultPage,
      Status,
      IsEnable,
      EmployeeID,
      CompanyID,
      Nik
    FROM [dbo].[MstUsername]
    WHERE IsEnable = 1
    ORDER BY Username ASC;
  `);
  return result.recordset || [];
}

async function listUsersByLokasi(blok, idLokasi, stockOpnameNo) {
  const pool = await poolPromise;
  const noso = String(stockOpnameNo || "").trim();
  const request = pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi);
  if (noso) request.input("noso", sql.VarChar(20), noso);

  const result = await request.query(`
      SELECT a.NoSO, a.Blok, a.IdLokasi, a.IdUsername, u.Username, u.FName, u.LName, a.CreatedAt
      FROM [dbo].[MstUserLokasiAccess] a
      LEFT JOIN [dbo].[MstUsername] u ON u.IdUsername = a.IdUsername
      WHERE a.Blok = @blok AND a.IdLokasi = @idLokasi
      ${noso ? "AND a.NoSO = @noso" : ""}
      ORDER BY u.Username ASC;
    `);
  return result.recordset || [];
}

// Semua baris milik user yang MASIH ADA di tabel ini otomatis berarti
// "masih berjalan" — begitu NoSO-nya complete, baris dihapus.
async function listLokasiByUser(idUsername) {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("idUsername", sql.Int, idUsername).query(`
      SELECT a.NoSO, a.Blok, a.IdLokasi, a.IdUsername, a.CreatedAt, l.Description AS description
      FROM [dbo].[MstUserLokasiAccess] a
      LEFT JOIN [dbo].[MstLokasi] l
        ON l.Blok = a.Blok AND l.IdLokasi = a.IdLokasi
      WHERE a.IdUsername = @idUsername
      ORDER BY a.Blok ASC, a.IdLokasi ASC;
    `);
  return result.recordset || [];
}

async function assignAccess({ blok, idLokasi, idUsername, stockOpnameNo }) {
  const noso = String(stockOpnameNo || "").trim();
  if (!noso) throw badReq("stockOpnameNo wajib diisi");

  const pool = await poolPromise;

  const existingRes = await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername).query(`
      SELECT DISTINCT a.Blok, a.IdLokasi, u.Username
      FROM [dbo].[MstUserLokasiAccess] a
      LEFT JOIN [dbo].[MstUsername] u ON u.IdUsername = a.IdUsername
      WHERE a.IdUsername = @idUsername
        AND NOT (a.Blok = @blok AND a.IdLokasi = @idLokasi);
    `);

  const otherLokasi = existingRes.recordset || [];
  if (otherLokasi.length >= MAX_LOKASI_PER_USER) {
    const username = otherLokasi[0]?.Username || `#${idUsername}`;
    const lokasiList = otherLokasi
      .map((r) => `${r.Blok}${r.IdLokasi}`)
      .join(", ");
    throw conflict(
      `User ${username} sudah memiliki ${MAX_LOKASI_PER_USER} lokasi (${lokasiList}), tidak bisa menambah lokasi baru`,
    );
  }

  await pool
    .request()
    .input("noso", sql.VarChar(20), noso)
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername).query(`
      IF NOT EXISTS (
        SELECT 1 FROM [dbo].[MstUserLokasiAccess]
        WHERE NoSO = @noso AND Blok = @blok AND IdLokasi = @idLokasi AND IdUsername = @idUsername
      )
      INSERT INTO [dbo].[MstUserLokasiAccess] (NoSO, Blok, IdLokasi, IdUsername)
      VALUES (@noso, @blok, @idLokasi, @idUsername);
    `);
  return { stockOpnameNo: noso, blok, idLokasi, idUsername };
}

async function revokeAccess({ blok, idLokasi, idUsername, stockOpnameNo }) {
  const noso = String(stockOpnameNo || "").trim();
  if (!noso) throw badReq("stockOpnameNo wajib diisi");

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("noso", sql.VarChar(20), noso)
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername).query(`
      DELETE FROM [dbo].[MstUserLokasiAccess]
      WHERE NoSO = @noso AND Blok = @blok AND IdLokasi = @idLokasi AND IdUsername = @idUsername;
    `);

  if (result.rowsAffected[0] === 0) {
    throw notFound(
      `Assignment untuk user ${idUsername} pada lokasi ${blok}/${idLokasi} (NoSO ${noso}) tidak ditemukan`,
    );
  }

  return { stockOpnameNo: noso, blok, idLokasi, idUsername };
}

// Dipanggil dari completeStockOpname (di bawah) saat NoSO ditandai selesai —
// semua penugasan lokasi utk NoSO tsb sudah tidak relevan. `tx` opsional:
// kalau dikirim (sql.Transaction), DELETE ikut transaksi yang sama supaya
// atomic dengan proses complete.
async function revokeAccessByStockOpname(stockOpnameNo, tx) {
  const noso = String(stockOpnameNo || "").trim();
  if (!noso) return;

  const request = tx ? new sql.Request(tx) : (await poolPromise).request();
  await request.input("noso", sql.VarChar(20), noso).query(`
    DELETE FROM [dbo].[MstUserLokasiAccess] WHERE NoSO = @noso;
  `);
}

async function listAllowedUsersGroupedByLokasi(blok, stockOpnameNo) {
  const pool = await poolPromise;
  const noso = String(stockOpnameNo || "").trim();
  const request = pool.request().input("blok", sql.VarChar(100), blok);
  if (noso) request.input("noso", sql.VarChar(20), noso);

  const result = await request.query(`
      SELECT a.IdLokasi, a.IdUsername, u.Username, u.FName, u.LName
      FROM [dbo].[MstUserLokasiAccess] a
      LEFT JOIN [dbo].[MstUsername] u ON u.IdUsername = a.IdUsername
      WHERE a.Blok = @blok
      ${noso ? "AND a.NoSO = @noso" : ""}
      ORDER BY a.IdLokasi ASC, u.Username ASC;
    `);

  const map = new Map();
  for (const row of result.recordset || []) {
    if (!map.has(row.IdLokasi)) map.set(row.IdLokasi, []);
    map.get(row.IdLokasi).push({
      idUsername: row.IdUsername,
      username: row.Username,
      fullName: [row.FName, row.LName].filter(Boolean).join(" ") || null,
    });
  }
  return map;
}

async function isUserAllowedForLokasi({ blok, idLokasi, idUsername, stockOpnameNo }) {
  const pool = await poolPromise;
  const noso = String(stockOpnameNo || "").trim();
  const request = pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("idUsername", sql.Int, idUsername);
  if (noso) request.input("noso", sql.VarChar(20), noso);

  const result = await request.query(`
      SELECT TOP 1 1 AS found
      FROM [dbo].[MstUserLokasiAccess]
      WHERE Blok = @blok AND IdLokasi = @idLokasi AND IdUsername = @idUsername
      ${noso ? "AND NoSO = @noso" : ""};
    `);
  return (result.recordset || []).length > 0;
}

async function getAllKategoriWithStatus({ year, month } = {}) {
  const kategoriList = await getAllKategori();
  if (!kategoriList.length) return kategoriList;

  const pool = await poolPromise;
  const now = new Date();

  const yearNum =
    year !== undefined && year !== null && year !== "" ? Number(year) : now.getFullYear();
  if (!Number.isInteger(yearNum)) {
    throw badReq("year wajib berupa integer valid");
  }
  const monthNum =
    month !== undefined && month !== null && month !== ""
      ? Number(month)
      : now.getMonth() + 1;
  if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw badReq("month wajib berupa integer 1-12");
  }

  const ranked = await pool
    .request()
    .input("year", sql.Int, yearNum)
    .input("month", sql.Int, monthNum).query(`
      ;WITH ranked AS (
        SELECT
          NoSO, IdKategori, Tanggal, IsComplete, DateComplete,
          ROW_NUMBER() OVER (PARTITION BY IdKategori ORDER BY Tanggal DESC, NoSO DESC) AS rn
        FROM dbo.StockOpname_h
        WHERE IdKategori IS NOT NULL
          AND YEAR(Tanggal) = @year
          AND MONTH(Tanggal) = @month
      )
      SELECT IdKategori, NoSO, Tanggal, IsComplete, DateComplete FROM ranked WHERE rn = 1;
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
          startDate: null,
          completedAt: null,
        };
      }

      const categoryCode = String(k.KodeKategori || "")
        .trim()
        .toLowerCase();
      const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];

      let labelCount = 0;
      let scannedCount = 0;
      if (cfg) {
        const scannedMatchSql = [
          "h.NoSO = src.NoSO",
          ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
        ].join(" AND ");

        const countRes = await pool
          .request()
          .input("stockOpnameNo", sql.VarChar, row.NoSO).query(`
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
        status: row.IsComplete
          ? STOCK_OPNAME_STATUS.COMPLETED
          : STOCK_OPNAME_STATUS.IN_PROGRESS,
        labelCount,
        scannedCount,
        startDate: row.Tanggal ?? null,
        completedAt: row.DateComplete ?? null,
      };
    }),
  );
}

// Riwayat sesi stock opname per kategori (termasuk yang sudah lewat bulan/completed).
// Endpoint kategori (getAllKategoriWithStatus) cuma nunjukin status TERKINI (1 SO
// teraktif per kategori) — untuk lihat SO bulan-bulan sebelumnya pakai fungsi ini.
async function getStockOpnameRiwayat({ categoryId, year, month, page = 1, pageSize = 20 }) {
  const categoryIdNum = Number(categoryId);
  if (!Number.isInteger(categoryIdNum) || categoryIdNum <= 0) {
    throw badReq("categoryId wajib berupa integer valid");
  }

  const pool = await poolPromise;

  const categoryRes = await pool
    .request()
    .input("categoryId", sql.Int, categoryIdNum).query(`
      SELECT KodeKategori, NamaKategori FROM dbo.MstKategori WHERE IdKategori = @categoryId;
    `);
  const categoryRow = categoryRes.recordset?.[0];
  if (!categoryRow) {
    throw notFound(`MstKategori tidak ditemukan untuk categoryId: ${categoryIdNum}`);
  }
  const categoryCode = String(categoryRow.KodeKategori || "").trim().toLowerCase();
  const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];

  const yearNum =
    year !== undefined && year !== null && year !== "" ? Number(year) : null;
  if (
    year !== undefined && year !== null && year !== "" &&
    !Number.isInteger(yearNum)
  ) {
    throw badReq("year wajib berupa integer valid");
  }
  const monthNum =
    month !== undefined && month !== null && month !== "" ? Number(month) : null;
  if (
    month !== undefined && month !== null && month !== "" &&
    (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12)
  ) {
    throw badReq("month wajib berupa integer 1-12");
  }
  if (monthNum !== null && yearNum === null) {
    throw badReq("year wajib diisi kalau month diisi");
  }

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (p - 1) * ps;

  const whereYear = yearNum !== null ? "AND YEAR(h.Tanggal) = @year" : "";
  const whereMonth = monthNum !== null ? "AND MONTH(h.Tanggal) = @month" : "";

  const bindInputs = (req) => {
    req.input("categoryId", sql.Int, categoryIdNum);
    if (yearNum !== null) req.input("year", sql.Int, yearNum);
    if (monthNum !== null) req.input("month", sql.Int, monthNum);
    return req;
  };

  const [listRes, countRes] = await Promise.all([
    bindInputs(pool.request()).query(`
      SELECT h.NoSO, h.Tanggal, h.IsComplete, h.DateComplete
      FROM dbo.StockOpname_h AS h
      WHERE h.IdKategori = @categoryId ${whereYear} ${whereMonth}
      ORDER BY h.Tanggal DESC, h.NoSO DESC
      OFFSET ${offset} ROWS FETCH NEXT ${ps} ROWS ONLY;
    `),
    bindInputs(pool.request()).query(`
      SELECT COUNT(*) AS total
      FROM dbo.StockOpname_h AS h
      WHERE h.IdKategori = @categoryId ${whereYear} ${whereMonth};
    `),
  ]);
  const total = countRes.recordset?.[0]?.total || 0;
  const rows = listRes.recordset || [];

  const data = await Promise.all(
    rows.map(async (row) => {
      let labelCount = 0;
      let scannedCount = 0;
      if (cfg) {
        const scannedMatchSql = [
          "hasil.NoSO = src.NoSO",
          ...cfg.labelColumns.map((col) => `hasil.${col} = src.${col}`),
        ].join(" AND ");

        const summaryRes = await pool
          .request()
          .input("stockOpnameNo", sql.VarChar, row.NoSO).query(`
            SELECT
              COUNT(*) AS labelCount,
              SUM(CASE WHEN hasil.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
            FROM dbo.${cfg.snapshotTable} AS src
            LEFT JOIN dbo.${cfg.hasilTable} AS hasil ON ${scannedMatchSql}
            WHERE src.NoSO = @stockOpnameNo;
          `);
        labelCount = summaryRes.recordset?.[0]?.labelCount || 0;
        scannedCount = summaryRes.recordset?.[0]?.scannedCount || 0;
      }

      return {
        stockOpnameNo: row.NoSO,
        startDate: row.Tanggal,
        status: row.IsComplete
          ? STOCK_OPNAME_STATUS.COMPLETED
          : STOCK_OPNAME_STATUS.IN_PROGRESS,
        labelCount,
        scannedCount,
        completedAt: row.DateComplete ?? null,
      };
    }),
  );

  return {
    categoryId: categoryIdNum,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    data,
    currentPage: p,
    pageSize: ps,
    totalRecords: total,
    totalPages: Math.ceil(total / ps) || 0,
  };
}

async function resolveStockOpnameCategory(pool, stockOpnameNo) {
  const no = String(stockOpnameNo || "").trim();
  if (!no) throw badReq("stockOpnameNo wajib diisi");

  const headerRes = await pool.request().input("stockOpnameNo", sql.VarChar, no)
    .query(`
    SELECT NoSO, Tanggal, IdKategori, IsComplete, DateComplete FROM dbo.StockOpname_h WHERE NoSO = @stockOpnameNo;
  `);
  const header = headerRes.recordset?.[0];
  if (!header) throw notFound(`Stock opname tidak ditemukan: ${no}`);
  if (!header.IdKategori) {
    throw badReq(
      `Stock opname ${no} belum punya categoryId (bukan sesi stock-opname-v2)`,
    );
  }

  const categoryRes = await pool
    .request()
    .input("categoryId", sql.Int, header.IdKategori)
    .query(
      `SELECT KodeKategori, NamaKategori FROM dbo.MstKategori WHERE IdKategori = @categoryId;`,
    );
  const categoryRow = categoryRes.recordset?.[0];
  const categoryCode = categoryRow?.KodeKategori
    ? String(categoryRow.KodeKategori).trim().toLowerCase()
    : null;
  if (!categoryCode) {
    throw badReq(
      `MstKategori tidak ditemukan untuk categoryId: ${header.IdKategori}`,
    );
  }

  const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];
  if (!cfg) throw badReq(`categoryCode tidak dikenali: ${categoryCode}`);

  return { no, header, categoryRow, categoryCode, cfg };
}

async function previewStockOpnameLabelCount({ categoryId }) {
  const categoryIdNum = Number(categoryId);
  if (!Number.isInteger(categoryIdNum) || categoryIdNum <= 0) {
    throw badReq("categoryId wajib berupa integer valid");
  }

  // Tanggal acuan sama seperti generate: selalu H-1 (UTC).
  const todayUtc = toDateOnly(new Date());
  const docDateOnly = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);

  const pool = await poolPromise;

  const categoryRes = await pool
    .request()
    .input("categoryId", sql.Int, categoryIdNum).query(`
    SELECT KodeKategori, NamaKategori FROM dbo.MstKategori WHERE IdKategori = @categoryId;
  `);
  const categoryRow = categoryRes.recordset?.[0];
  const categoryCode = categoryRow?.KodeKategori
    ? String(categoryRow.KodeKategori).trim().toLowerCase()
    : null;
  if (!categoryCode) {
    throw badReq(
      `MstKategori tidak ditemukan untuk categoryId: ${categoryIdNum}`,
    );
  }
  const categoryName = categoryRow?.NamaKategori || categoryCode;

  const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];
  if (!cfg) throw badReq(`categoryCode tidak dikenali: ${categoryCode}`);

  // Reuse persis query sumber yang dipakai generateStockOpname (cteSql + finalSelectSql),
  // dibungkus COUNT(*) supaya tidak perlu insert apa pun untuk sekadar preview jumlah.
  const countReq = pool.request();
  countReq.input("noso", sql.VarChar, "");
  countReq.input("tanggal", sql.Date, docDateOnly);

  const result = await countReq.query(`
    ${cfg.cteSql || ""}
    SELECT COUNT(*) AS labelCount FROM (
      ${cfg.finalSelectSql}
    ) AS src;
  `);

  return {
    categoryId: categoryIdNum,
    categoryCode,
    categoryName,
    date: formatYMD(docDateOnly),
    hasDateFilter: cfg.hasDateCreateFilter,
    labelCount: result.recordset?.[0]?.labelCount || 0,
  };
}

async function generateStockOpname({ categoryId, ctx }) {
  const categoryIdNum = Number(categoryId);
  if (!Number.isInteger(categoryIdNum) || categoryIdNum <= 0) {
    throw badReq("categoryId wajib berupa integer valid");
  }

  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();

  // Tanggal snapshot selalu H-1 (UTC), tidak lagi menerima input dari client.
  const todayUtc = toDateOnly(new Date());
  const docDateOnly = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);

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
      throw badReq(
        `MstKategori tidak ditemukan untuk categoryId: ${categoryIdNum}`,
      );
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

    const checkRes = await new sql.Request(tx).input(
      "stockOpnameNo",
      sql.VarChar,
      no,
    ).query(`
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

    const completeRes = await new sql.Request(tx)
      .input("stockOpnameNo", sql.VarChar, no).query(`
      UPDATE dbo.StockOpname_h
      SET IsComplete = 1, DateComplete = GETDATE()
      OUTPUT INSERTED.DateComplete
      WHERE NoSO = @stockOpnameNo;
    `);

    // Penugasan lokasi (MstUserLokasiAccess) sifatnya per-sesi — begitu NoSO
    // ini selesai, semua penugasannya sudah tidak relevan dan dihapus.
    await revokeAccessByStockOpname(no, tx);

    await tx.commit();

    return {
      stockOpnameNo: no,
      isComplete: true,
      completedAt: completeRes.recordset?.[0]?.DateComplete ?? null,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function getTypesInStockOpname({ stockOpnameNo }) {
  const pool = await poolPromise;
  const { no, header, categoryRow, categoryCode, cfg } =
    await resolveStockOpnameCategory(pool, stockOpnameNo);

  const jenisColumn = cfg.jenisColumn;
  const scannedMatchSql = [
    "h.NoSO = src.NoSO",
    ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
  ].join(" AND ");

  // Furniture WIP dihitung per pcs, bukan berat.
  const showWeight = categoryCode !== "furniturewip";

  const summaryRes = await pool
    .request()
    .input("stockOpnameNo", sql.VarChar, no).query(`
    SELECT
      src.${jenisColumn} AS typeId,
      COUNT(*) AS labelCount,
      ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
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
    ...(showWeight ? { totalWeight: row.totalWeight } : { totalPcs: row.totalPcs }),
  }));

  return {
    stockOpnameNo: no,
    date: header.Tanggal,
    categoryId: header.IdKategori,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    isComplete: !!header.IsComplete,
    completedAt: header.DateComplete ?? null,
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
  const { no, header, categoryRow, categoryCode, cfg } =
    await resolveStockOpnameCategory(pool, stockOpnameNo);

  const typeIdNum =
    typeId !== undefined && typeId !== null && typeId !== ""
      ? Number(typeId)
      : null;
  if (
    typeId !== undefined &&
    typeId !== null &&
    typeId !== "" &&
    !Number.isInteger(typeIdNum)
  ) {
    throw badReq("typeId wajib berupa integer valid");
  }

  const locationIdNum =
    locationId !== undefined && locationId !== null && locationId !== ""
      ? Number(locationId)
      : null;
  if (
    locationId !== undefined &&
    locationId !== null &&
    locationId !== "" &&
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

  const isUnknownBlok = blokTrim === UNKNOWN_BLOK_CODE;
  const isUnknownLocation = locationIdNum === UNKNOWN_LOCATION_ID;

  // Furniture WIP dihitung per pcs, bukan berat — Berat tidak relevan
  // ditampilkan untuk kategori ini.
  const showWeight = categoryCode !== "furniturewip";
  const displayColumns = showWeight
    ? cfg.insertColumns
    : cfg.insertColumns.filter((c) => c !== "Berat");

  const selectColumnsSql = displayColumns.map((c) => `src.${c}`).join(", ");
  const whereSearch = searchTerm ? `AND src.${labelColumn} LIKE @search` : "";
  const whereType =
    typeIdNum !== null ? `AND src.${cfg.jenisColumn} = @typeId` : "";
  const whereLocation =
    locationIdNum !== null
      ? `AND ${isUnknownBlok ? "src.Blok IS NULL" : "src.Blok = @blok"} AND ${
          isUnknownLocation ? "src.IdLokasi IS NULL" : "src.IdLokasi = @locationId"
        }`
      : "";

  const bindInputs = (req) => {
    req.input("stockOpnameNo", sql.VarChar, no);
    if (searchTerm) req.input("search", sql.VarChar, `%${searchTerm}%`);
    if (locationIdNum !== null && !isUnknownBlok)
      req.input("blok", sql.VarChar, blokTrim);
    if (typeIdNum !== null) req.input("typeId", sql.Int, typeIdNum);
    if (locationIdNum !== null && !isUnknownLocation)
      req.input("locationId", sql.Int, locationIdNum);
    return req;
  };

  const scannedMatchSql = [
    "h.NoSO = src.NoSO",
    ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
  ].join(" AND ");

  const dataQuery = `
    SELECT
      src.NoSO, ${selectColumnsSql},
      CASE WHEN EXISTS (
        SELECT 1 FROM dbo.${cfg.hasilTable} h WHERE ${scannedMatchSql}
      ) THEN 1 ELSE 0 END AS isScanned,
      (SELECT TOP 1 h.ScannedBlok FROM dbo.${cfg.hasilTable} h WHERE ${scannedMatchSql}) AS ScannedBlok,
      (SELECT TOP 1 h.ScannedIdLokasi FROM dbo.${cfg.hasilTable} h WHERE ${scannedMatchSql}) AS ScannedIdLokasi
    FROM dbo.${cfg.snapshotTable} AS src
    WHERE src.NoSO = @stockOpnameNo ${whereType} ${whereLocation} ${whereSearch}
    ORDER BY src.${labelColumn} ASC
    OFFSET ${offset} ROWS FETCH NEXT ${ps} ROWS ONLY;
  `;
  const countQuery = `
    SELECT
      COUNT(*) AS total,
      ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
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

  const rows = (dataRes.recordset || []).map((row) => ({
    ...row,
    isLocationMismatch: row.isScanned
      ? normBlokValue(row.ScannedBlok) !== normBlokValue(row.Blok) ||
        (row.ScannedIdLokasi ?? null) !== (row.IdLokasi ?? null)
      : false,
  }));

  // Kelompokkan label pada halaman ini per jenis, dengan nama jenis
  // di-join dari master jenis kategori ini (mis. MstBonggolan untuk
  // kategori bonggolan) lewat getJenisByKategori — sama seperti dipakai
  // getTypesInStockOpname, jadi konsisten untuk semua kategori.
  const typeMaster = await getJenisByKategori(header.IdKategori);
  const typeNameById = new Map(
    (typeMaster?.jenis || []).map((j) => [j.IdJenis, j.NamaJenis]),
  );

  const groupsByTypeId = new Map();
  for (const row of rows) {
    const rowTypeId = row[cfg.jenisColumn] ?? null;
    if (!groupsByTypeId.has(rowTypeId)) {
      groupsByTypeId.set(rowTypeId, {
        typeId: rowTypeId,
        typeName: rowTypeId !== null ? typeNameById.get(rowTypeId) ?? null : null,
        labelCount: 0,
        ...(showWeight ? { totalWeight: 0 } : { totalPcs: 0 }),
        labels: [],
      });
    }
    const group = groupsByTypeId.get(rowTypeId);
    group.labelCount += 1;
    if (showWeight) {
      group.totalWeight = Math.round((group.totalWeight + (row.Berat ?? 0)) * 100) / 100;
    } else {
      group.totalPcs += row.Pcs ?? 0;
    }
    group.labels.push(row);
  }

  const data = Array.from(groupsByTypeId.values()).sort((a, b) => {
    const an = a.typeName ?? "";
    const bn = b.typeName ?? "";
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

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
    completedAt: header.DateComplete ?? null,
    data,
    currentPage: p,
    pageSize: ps,
    totalRecords: total,
    totalPages: Math.ceil(total / ps) || 0,
    ...(showWeight
      ? { totalWeight: countRes.recordset?.[0]?.totalWeight ?? 0 }
      : { totalPcs: countRes.recordset?.[0]?.totalPcs ?? 0 }),
    totalScanned: countRes.recordset?.[0]?.totalScanned ?? 0,
  };
}

async function getAllBlok({ stockOpnameNo }) {
  const pool = await poolPromise;
  const { no, header, categoryCode, cfg } =
    await resolveStockOpnameCategory(pool, stockOpnameNo);

  const scannedMatchSql = [
    "h.NoSO = src.NoSO",
    ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
  ].join(" AND ");

  // Furniture WIP dihitung per pcs, bukan berat.
  const showWeight = categoryCode !== "furniturewip";

  // locationCount dihitung dari snapshot stock opname, bukan dari master lokasi.
  // Ini menjaga daftar blok tetap mengikuti data acuan yang benar-benar
  // ter-snapshot, termasuk lokasi yang belum punya mapping master.
  const res = await pool
    .request()
    .input("stockOpnameNo", sql.VarChar, no)
    .query(`
      SELECT
        src.Blok AS blok,
        COUNT(DISTINCT CASE WHEN src.IdLokasi IS NOT NULL THEN src.IdLokasi END)
          + MAX(CASE WHEN src.IdLokasi IS NULL THEN 1 ELSE 0 END) AS locationCount,
        COUNT(*) AS labelCount,
        ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
        SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
      FROM dbo.${cfg.snapshotTable} AS src
      LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
      WHERE src.NoSO = @stockOpnameNo
      GROUP BY src.Blok;
    `);

  // Blok tidak diketahui: seluruh label tanpa Blok tercatat digabung jadi
  // satu bucket "Lokasi Tidak Diketahui" (IdLokasi tidak relevan tanpa Blok).
  const bloks = (res.recordset || []).map((r) => ({
    blok: r.blok ?? UNKNOWN_BLOK_CODE,
    locationCount: r.blok === null ? 1 : r.locationCount,
    labelCount: r.labelCount,
    scannedCount: r.scannedCount,
    ...(showWeight ? { totalWeight: r.totalWeight } : { totalPcs: r.totalPcs }),
  }));

  bloks.sort((a, b) => {
    if (a.blok === UNKNOWN_BLOK_CODE) return 1;
    if (b.blok === UNKNOWN_BLOK_CODE) return -1;
    return a.blok < b.blok ? -1 : a.blok > b.blok ? 1 : 0;
  });
  return bloks;
}

async function getLocationsInBlok({ stockOpnameNo, blok }) {
  const pool = await poolPromise;
  const { no, header, categoryRow, categoryCode, cfg } =
    await resolveStockOpnameCategory(pool, stockOpnameNo);

  const blokTrim = String(blok || "").trim();
  if (!blokTrim) throw badReq("blok wajib diisi");

  const isUnknownBlok = blokTrim === UNKNOWN_BLOK_CODE;

  // Dipakai FE utk nampilin siapa saja user yang boleh akses tiap lokasi
  // (lihat gating di stock-opname-v2-routes.js pada endpoint .../lokasi/:locationId/label).
  const allowedUsersByLokasi = await listAllowedUsersGroupedByLokasi(blokTrim, no);
  const getAllowedUsers = (locationId) => allowedUsersByLokasi.get(locationId) || [];

  const scannedMatchSql = [
    "h.NoSO = src.NoSO",
    ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
  ].join(" AND ");

  // Furniture WIP dihitung per pcs, bukan berat.
  const showWeight = categoryCode !== "furniturewip";

  // Blok tidak diketahui: seluruh label tanpa Blok tercatat digabung jadi
  // satu bucket "Lokasi Tidak Diketahui" (IdLokasi tidak relevan tanpa Blok).
  if (isUnknownBlok) {
    const summaryRes = await pool
      .request()
      .input("stockOpnameNo", sql.VarChar, no).query(`
        SELECT
          COUNT(*) AS labelCount,
          ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
          SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
        FROM dbo.${cfg.snapshotTable} AS src
        LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
        WHERE src.NoSO = @stockOpnameNo AND src.Blok IS NULL;
      `);

    const summary = summaryRes.recordset?.[0];
    const data =
      summary && summary.labelCount > 0
        ? [
            {
              locationId: UNKNOWN_LOCATION_ID,
              description: UNKNOWN_LOCATION_LABEL,
              labelCount: summary.labelCount,
              scannedCount: summary.scannedCount,
              allowedUsers: getAllowedUsers(UNKNOWN_LOCATION_ID),
              ...(showWeight
                ? { totalWeight: summary.totalWeight }
                : { totalPcs: summary.totalPcs }),
            },
          ]
        : [];

    return {
      stockOpnameNo: no,
      categoryId: header.IdKategori,
      categoryCode,
      categoryName: categoryRow.NamaKategori,
      isComplete: !!header.IsComplete,
      completedAt: header.DateComplete ?? null,
      blok: blokTrim,
      data,
      totalRecords: data.length,
    };
  }

  const locationRes = await pool
    .request()
    .input("stockOpnameNo", sql.VarChar, no)
    .input("blok", sql.VarChar, blokTrim).query(`
      SELECT
        src.IdLokasi AS locationId,
        MAX(l.Description) AS description,
        COUNT(*) AS labelCount,
        ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
        SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
      FROM dbo.${cfg.snapshotTable} AS src
      LEFT JOIN dbo.MstLokasi AS l
        ON l.Blok = src.Blok
        AND l.IdLokasi = src.IdLokasi
      LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
      WHERE src.NoSO = @stockOpnameNo AND src.Blok = @blok
      GROUP BY src.IdLokasi
      ORDER BY src.IdLokasi ASC;
    `);

  const summaryRows = locationRes.recordset || [];
  const data = summaryRows
    .filter((row) => row.locationId !== null)
    .map((row) => ({
      locationId: row.locationId,
      description: row.description ?? `Lokasi ${row.locationId}`,
      labelCount: row.labelCount,
      scannedCount: row.scannedCount,
      allowedUsers: getAllowedUsers(row.locationId),
      ...(showWeight ? { totalWeight: row.totalWeight } : { totalPcs: row.totalPcs }),
    }));

  const unknownLocationSummary = summaryRows.find((row) => row.locationId === null) || null;
  if (unknownLocationSummary) {
    data.push({
      locationId: UNKNOWN_LOCATION_ID,
      description: UNKNOWN_LOCATION_LABEL,
      labelCount: unknownLocationSummary.labelCount,
      scannedCount: unknownLocationSummary.scannedCount,
      allowedUsers: getAllowedUsers(UNKNOWN_LOCATION_ID),
      ...(showWeight
        ? { totalWeight: unknownLocationSummary.totalWeight }
        : { totalPcs: unknownLocationSummary.totalPcs }),
    });
  }

  data.sort((a, b) => {
    if (a.locationId === UNKNOWN_LOCATION_ID) return 1;
    if (b.locationId === UNKNOWN_LOCATION_ID) return -1;
    return a.locationId - b.locationId;
  });

  return {
    stockOpnameNo: no,
    categoryId: header.IdKategori,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    isComplete: !!header.IsComplete,
    completedAt: header.DateComplete ?? null,
    blok: blokTrim,
    data,
    totalRecords: data.length,
  };
}

// Bandingkan Blok/IdLokasi case/whitespace-insensitive, konsisten dengan
// normalizer yang sama dipakai modul stock-opname v1.
function normBlokValue(value) {
  return (value ?? "").toString().trim().toUpperCase() || null;
}

// Dipakai app scan (field worker): daftar lokasi (lintas blok) pada satu NoSO
// yang jadi tugas user yang login, berdasarkan MstUserLokasiAccess. User
// dengan bypass (super admin / "stockopname:create", lihat
// requireLokasiAccess) melihat seluruh lokasi pada NoSO tsb tanpa filter.
async function getMyLokasiForStockOpname({ stockOpnameNo, idUsername, isBypass }) {
  const pool = await poolPromise;
  const { no, header, categoryRow, categoryCode, cfg } =
    await resolveStockOpnameCategory(pool, stockOpnameNo);

  const scannedMatchSql = [
    "h.NoSO = src.NoSO",
    ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
  ].join(" AND ");

  // Furniture WIP dihitung per pcs, bukan berat.
  const showWeight = categoryCode !== "furniturewip";

  const locationRes = await pool
    .request()
    .input("stockOpnameNo", sql.VarChar, no).query(`
      SELECT
        src.Blok AS blok,
        src.IdLokasi AS locationId,
        MAX(l.Description) AS description,
        COUNT(*) AS labelCount,
        ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
        SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
      FROM dbo.${cfg.snapshotTable} AS src
      LEFT JOIN dbo.MstLokasi AS l
        ON l.Blok = src.Blok
        AND l.IdLokasi = src.IdLokasi
      LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
      WHERE src.NoSO = @stockOpnameNo AND src.Blok IS NOT NULL AND src.IdLokasi IS NOT NULL
      GROUP BY src.Blok, src.IdLokasi
      ORDER BY src.Blok ASC, src.IdLokasi ASC;
    `);

  let rows = locationRes.recordset || [];

  if (!isBypass) {
    const assigned = await listLokasiByUser(idUsername);
    const allowedKeys = new Set(
      assigned
        .filter((r) => r.NoSO === no)
        .map((r) => `${normBlokValue(r.Blok)}|${r.IdLokasi}`),
    );
    rows = rows.filter((row) =>
      allowedKeys.has(`${normBlokValue(row.blok)}|${row.locationId}`),
    );
  }

  const data = rows.map((row) => ({
    blok: row.blok,
    locationId: row.locationId,
    description: row.description ?? `Lokasi ${row.locationId}`,
    labelCount: row.labelCount,
    scannedCount: row.scannedCount,
    ...(showWeight ? { totalWeight: row.totalWeight } : { totalPcs: row.totalPcs }),
  }));

  return {
    stockOpnameNo: no,
    categoryId: header.IdKategori,
    categoryCode,
    categoryName: categoryRow.NamaKategori,
    isComplete: !!header.IsComplete,
    completedAt: header.DateComplete ?? null,
    data,
    totalRecords: data.length,
  };
}

// Lokasi milik user (lintas NoSO/kategori), digabung dengan
// labelCount/scannedCount dari NoSO yang tersimpan di masing-masing baris
// assignment MstUserLokasiAccess (bukan auto-resolve "NoSO aktif" —
// assignment sekarang SUDAH menyimpan NoSO-nya sendiri per baris).
// Dipakai FE utk "lokasi tugas saya"
// tanpa perlu tahu NoSO-nya lebih dulu.
async function listMyLokasiWithLabelCount(idUsername) {
  const myLokasi = await listLokasiByUser(idUsername);
  if (!myLokasi.length) return [];

  const pool = await poolPromise;
  const nosoList = [...new Set(myLokasi.map((r) => r.NoSO))];

  const catReq = pool.request();
  nosoList.forEach((noso, i) => catReq.input(`noso${i}`, sql.VarChar, noso));
  const catRes = await catReq.query(`
    SELECT h.NoSO, k.KodeKategori
    FROM [dbo].[StockOpname_h] h
    INNER JOIN [dbo].[MstKategori] k ON k.IdKategori = h.IdKategori
    WHERE h.NoSO IN (${nosoList.map((_, i) => `@noso${i}`).join(", ")});
  `);
  const categoryByNoso = new Map(
    (catRes.recordset || []).map((r) => [
      r.NoSO,
      String(r.KodeKategori || "").trim().toLowerCase(),
    ]),
  );

  const rowsByNoso = new Map();
  for (const loc of myLokasi) {
    if (!rowsByNoso.has(loc.NoSO)) rowsByNoso.set(loc.NoSO, []);
    rowsByNoso.get(loc.NoSO).push(loc);
  }

  const data = [];

  for (const [noso, rowsForNoso] of rowsByNoso) {
    const categoryCode = categoryByNoso.get(noso) || null;
    const cfg = categoryCode && STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];
    const showWeight = categoryCode !== "furniturewip";

    const snapshotByKey = new Map();
    if (cfg) {
      const scannedMatchSql = [
        "h.NoSO = src.NoSO",
        ...cfg.labelColumns.map((col) => `h.${col} = src.${col}`),
      ].join(" AND ");

      const snapshotRes = await pool
        .request()
        .input("stockOpnameNo", sql.VarChar, noso).query(`
          SELECT
            src.Blok AS blok,
            src.IdLokasi AS locationId,
            COUNT(*) AS labelCount,
            ${showWeight ? "ROUND(SUM(ISNULL(src.Berat, 0)), 2) AS totalWeight," : "ROUND(SUM(ISNULL(src.Pcs, 0)), 0) AS totalPcs,"}
            SUM(CASE WHEN h.${cfg.labelColumns[0]} IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount
          FROM dbo.${cfg.snapshotTable} AS src
          LEFT JOIN dbo.${cfg.hasilTable} AS h ON ${scannedMatchSql}
          WHERE src.NoSO = @stockOpnameNo AND src.Blok IS NOT NULL AND src.IdLokasi IS NOT NULL
          GROUP BY src.Blok, src.IdLokasi;
        `);

      for (const row of snapshotRes.recordset || []) {
        snapshotByKey.set(`${normBlokValue(row.blok)}|${row.locationId}`, row);
      }
    }

    // Selalu tampilkan NoSO yang di-assign, walau belum/tidak ada label
    // (labelCount 0) di lokasi tsb — supaya user tetap tahu sedang
    // ditugaskan ke NoSO mana, bukan cuma saat ada datanya saja.
    for (const assignedRow of rowsForNoso) {
      const key = `${normBlokValue(assignedRow.Blok)}|${assignedRow.IdLokasi}`;
      const snap = snapshotByKey.get(key);
      data.push({
        stockOpnameNo: noso,
        categoryCode,
        blok: assignedRow.Blok,
        locationId: assignedRow.IdLokasi,
        description: assignedRow.description ?? `Lokasi ${assignedRow.IdLokasi}`,
        labelCount: snap?.labelCount ?? 0,
        scannedCount: snap?.scannedCount ?? 0,
        ...(showWeight
          ? { totalWeight: snap?.totalWeight ?? 0 }
          : { totalPcs: snap?.totalPcs ?? 0 }),
      });
    }
  }

  return data;
}

async function insertStockOpnameHasil({
  stockOpnameNo,
  labelNo,
  palletNo,
  blok,
  locationId,
  ctx,
}) {
  const pool = await poolPromise;
  const { no, header, categoryCode, cfg } = await resolveStockOpnameCategory(
    pool,
    stockOpnameNo,
  );

  if (header.IsComplete) {
    throw conflict(
      `Stock opname ${no} sudah ditandai selesai, tidak bisa insert hasil.`,
    );
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

  // Lokasi hasil scan opsional: kalau tidak dikirim, dianggap sama dengan acuan
  // (tidak ada koreksi). Kalau dikirim, blok & locationId wajib sepasang —
  // IdLokasi bukan unique sendirian, komposit dengan Blok.
  const blokProvided = blok !== undefined && blok !== null && String(blok).trim() !== "";
  const locationIdProvided =
    locationId !== undefined && locationId !== null && locationId !== "";
  if (blokProvided !== locationIdProvided) {
    throw badReq("blok dan locationId wajib dikirim berpasangan");
  }

  let scannedBlokInput = null;
  let scannedLocationIdInput = null;
  if (blokProvided) {
    const blokTrim = String(blok).trim();
    const locationIdNum = Number(locationId);
    if (!Number.isInteger(locationIdNum)) {
      throw badReq("locationId wajib berupa integer valid");
    }
    const isUnknown =
      blokTrim === UNKNOWN_BLOK_CODE || locationIdNum === UNKNOWN_LOCATION_ID;
    scannedBlokInput = isUnknown ? null : blokTrim;
    scannedLocationIdInput = isUnknown ? null : locationIdNum;
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
    SELECT ${cfg.hasilColumns.join(", ")}, Blok, IdLokasi FROM dbo.${cfg.snapshotTable}
    WHERE NoSO = @stockOpnameNo AND ${labelWhereSql};
  `);
  const referenceRow = referenceRes.recordset?.[0];
  if (!referenceRow) {
    throw notFound(
      `Label ${labelDisplay} tidak terdaftar di acuan stock opname ini`,
    );
  }

  const dupRes = await bindLabel(pool.request()).query(`
    SELECT 1 FROM dbo.${cfg.hasilTable} WHERE NoSO = @stockOpnameNo AND ${labelWhereSql};
  `);
  if (dupRes.recordset?.length) {
    throw conflict(`Label ${labelDisplay} sudah discan sebelumnya`);
  }

  // Default ke lokasi acuan kalau operator tidak mengirim lokasi hasil scan.
  const scannedBlok = blokProvided ? scannedBlokInput : (referenceRow.Blok ?? null);
  const scannedLocationId = blokProvided
    ? scannedLocationIdInput
    : (referenceRow.IdLokasi ?? null);
  const isLocationMismatch =
    normBlokValue(scannedBlok) !== normBlokValue(referenceRow.Blok) ||
    (scannedLocationId ?? null) !== (referenceRow.IdLokasi ?? null);

  const insertReq = bindLabel(pool.request());
  insertReq.input("weight", sql.Float, referenceRow.Berat ?? 0);
  insertReq.input("username", sql.VarChar, actorUsername);
  insertReq.input("scannedBlok", sql.VarChar(3), scannedBlok);
  insertReq.input("scannedLocationId", sql.Int, scannedLocationId);
  if (hasSackCount)
    insertReq.input("sackCount", sql.Int, referenceRow.JmlhSak ?? 0);
  if (hasPieceCount)
    insertReq.input("pieceCount", sql.Float, referenceRow.Pcs ?? 0);

  const valuePlaceholder = {
    [cfg.labelColumns[0]]: "@label",
    NoPallet: "@palletNo",
    JmlhSak: "@sackCount",
    Pcs: "@pieceCount",
    Berat: "@weight",
  };
  const hasilColumnsSql = cfg.hasilColumns.join(", ");
  const valuesSql = cfg.hasilColumns
    .map((col) => valuePlaceholder[col])
    .join(", ");

  await insertReq.query(`
    INSERT INTO dbo.${cfg.hasilTable}
      (NoSO, ${hasilColumnsSql}, Username, DateTimeScan, IdDiscrepancy, ScannedBlok, ScannedIdLokasi)
    VALUES
      (@stockOpnameNo, ${valuesSql}, @username, GETDATE(), NULL, @scannedBlok, @scannedLocationId);
  `);

  return {
    stockOpnameNo: no,
    categoryCode,
    labelNo: labelDisplay,
    sackCount: hasSackCount ? (referenceRow.JmlhSak ?? 0) : undefined,
    pieceCount: hasPieceCount ? (referenceRow.Pcs ?? 0) : undefined,
    // Furniture WIP dihitung per pcs, bukan berat.
    weight: categoryCode === "furniturewip" ? undefined : (referenceRow.Berat ?? 0),
    referenceBlok: referenceRow.Blok ?? null,
    referenceLocationId: referenceRow.IdLokasi ?? null,
    scannedBlok: scannedBlok ?? UNKNOWN_BLOK_CODE,
    scannedLocationId: scannedLocationId ?? UNKNOWN_LOCATION_ID,
    isLocationMismatch,
  };
}

async function deleteStockOpname({ stockOpnameNo, ctx }) {
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

    const headerRes = await new sql.Request(tx).input(
      "stockOpnameNo",
      sql.VarChar,
      no,
    ).query(`
        SELECT TOP 1 NoSO, Tanggal, IdKategori, IsComplete
        FROM dbo.StockOpname_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoSO = @stockOpnameNo;
      `);
    const header = headerRes.recordset?.[0];
    if (!header) throw notFound(`Stock opname tidak ditemukan: ${no}`);
    if (!header.IdKategori) {
      throw badReq(
        `Stock opname ${no} belum punya categoryId (bukan sesi stock-opname-v2)`,
      );
    }

    const categoryRes = await new sql.Request(tx)
      .input("categoryId", sql.Int, header.IdKategori)
      .query(
        `SELECT KodeKategori FROM dbo.MstKategori WHERE IdKategori = @categoryId;`,
      );
    const categoryCode = categoryRes.recordset?.[0]?.KodeKategori
      ? String(categoryRes.recordset[0].KodeKategori).trim().toLowerCase()
      : null;
    if (!categoryCode) {
      throw badReq(
        `MstKategori tidak ditemukan untuk categoryId: ${header.IdKategori}`,
      );
    }

    const cfg = STOCK_OPNAME_SNAPSHOT_CONFIG[categoryCode];
    if (!cfg) throw badReq(`categoryCode tidak dikenali: ${categoryCode}`);

    await assertNotLocked({
      date: header.Tanggal,
      runner: tx,
      action: "menghapus stock opname",
      useLock: true,
    });

    // Hasil scan dulu (FK ke snapshot lewat NoSO + kolom label), baru snapshot acuan, baru header.
    const hasilRes = await new sql.Request(tx).input(
      "stockOpnameNo",
      sql.VarChar,
      no,
    ).query(`
      DELETE FROM dbo.${cfg.hasilTable} WHERE NoSO = @stockOpnameNo;
    `);

    const snapshotRes = await new sql.Request(tx).input(
      "stockOpnameNo",
      sql.VarChar,
      no,
    ).query(`
      DELETE FROM dbo.${cfg.snapshotTable} WHERE NoSO = @stockOpnameNo;
    `);

    await new sql.Request(tx).input("stockOpnameNo", sql.VarChar, no).query(`
      DELETE FROM dbo.StockOpname_h WHERE NoSO = @stockOpnameNo;
    `);

    await tx.commit();

    return {
      stockOpnameNo: no,
      categoryCode,
      deletedHasilCount: hasilRes.rowsAffected?.[0] || 0,
      deletedSnapshotCount: snapshotRes.rowsAffected?.[0] || 0,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

module.exports = {
  getAllKategori,
  getAllKategoriWithStatus,
  getStockOpnameRiwayat,
  getJenisByKategori,
  previewStockOpnameLabelCount,
  generateStockOpname,
  completeStockOpname,
  getTypesInStockOpname,
  getStockOpnameSnapshot,
  insertStockOpnameHasil,
  deleteStockOpname,
  getAllBlok,
  getLocationsInBlok,
  getMyLokasiForStockOpname,
  listMyLokasiWithLabelCount,
  listAllUsers,
  listUsersByLokasi,
  listLokasiByUser,
  assignAccess,
  revokeAccess,
  revokeAccessByStockOpname,
  listAllowedUsersGroupedByLokasi,
  isUserAllowedForLokasi,
};
