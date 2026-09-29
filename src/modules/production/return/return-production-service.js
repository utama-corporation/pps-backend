// services/return-production-service.js
const { sql, poolPromise } = require("../../../core/config/db");
const {
  resolveEffectiveDateForCreate,
  assertNotLocked,
  loadDocDateOnlyFromConfig,
} = require("../../../core/shared/tutup-transaksi-guard");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const {
  parseJamToInt,
  calcJamKerjaFromStartEnd,
} = require("../../../core/utils/jam-kerja-helper");
const { badReq } = require("../../../core/utils/http-error");
const { formatDate } = require("../../../core/utils/date-helper");

const IMPORT_AS_GSU_CUTOFF_DATE = "2026-07-01";

async function getAllReturns(
  page = 1,
  pageSize = 20,
  search = "",
  dateFrom = null,
  dateTo = null,
) {
  const pool = await poolPromise;

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;

  const searchTerm = String(search || "").trim();

  // normalize date strings
  const df =
    typeof dateFrom === "string" && dateFrom.trim() ? dateFrom.trim() : null;
  const dt = typeof dateTo === "string" && dateTo.trim() ? dateTo.trim() : null;

  const whereClause = `
    WHERE 1=1
      AND (
        @search = ''
        OR h.NoRetur LIKE '%' + @search + '%'
        OR ISNULL(h.Invoice, '') LIKE '%' + @search + '%'
        OR ISNULL(h.NoBJSortir, '') LIKE '%' + @search + '%'
        OR ISNULL(p.NamaPembeli, '') LIKE '%' + @search + '%'
      )
      AND (@dateFrom IS NULL OR CONVERT(date, h.Tanggal) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(date, h.Tanggal) <= @dateTo)
  `;

  // 1) Count
  const countQry = `
    SELECT COUNT(1) AS total
    FROM dbo.BJRetur_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstPembeli p WITH (NOLOCK)
      ON p.IdPembeli = h.IdPembeli
    ${whereClause};
  `;

  const countReq = pool.request();
  countReq.input("search", sql.VarChar(100), searchTerm);
  countReq.input("dateFrom", sql.Date, df);
  countReq.input("dateTo", sql.Date, dt);

  const countRes = await countReq.query(countQry);
  const total = countRes.recordset?.[0]?.total || 0;
  if (total === 0) return { data: [], total: 0 };

  // 2) Data + lock flag
  const dataQry = `
    ;WITH LastClosed AS (
      SELECT TOP 1
        CONVERT(date, PeriodHarian) AS LastClosedDate
      FROM dbo.MstTutupTransaksiHarian WITH (NOLOCK)
      WHERE [Lock] = 1
      ORDER BY CONVERT(date, PeriodHarian) DESC, Id DESC
    )
    SELECT
      h.NoRetur,
      h.Invoice,
      h.Tanggal,
      h.IdPembeli,
      p.NamaPembeli,
      h.NoBJSortir,

      lc.LastClosedDate AS LastClosedDate,

      CASE
        WHEN lc.LastClosedDate IS NOT NULL
         AND CONVERT(date, h.Tanggal) <= lc.LastClosedDate
        THEN CAST(1 AS bit)
        ELSE CAST(0 AS bit)
      END AS IsLocked

    FROM dbo.BJRetur_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstPembeli p WITH (NOLOCK)
      ON p.IdPembeli = h.IdPembeli

    OUTER APPLY (
      SELECT TOP 1 LastClosedDate
      FROM LastClosed
    ) lc

    ${whereClause}

    ORDER BY h.Tanggal DESC, h.NoRetur DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;

  const dataReq = pool.request();
  dataReq.input("search", sql.VarChar(100), searchTerm);
  dataReq.input("dateFrom", sql.Date, df);
  dataReq.input("dateTo", sql.Date, dt);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("limit", sql.Int, ps);

  const dataRes = await dataReq.query(dataQry);
  return { data: dataRes.recordset || [], total };
}

async function getReturnsByDate(date) {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      h.NoRetur,
      h.Invoice,
      h.Tanggal,
      h.IdPembeli,
      p.NamaPembeli,
      h.NoBJSortir
    FROM [dbo].[BJRetur_h] h
    LEFT JOIN [dbo].[MstPembeli] p
      ON h.IdPembeli = p.IdPembeli
    WHERE CONVERT(date, h.Tanggal) = @date
    ORDER BY h.NoRetur ASC;
  `;

  request.input("date", sql.Date, date);
  const result = await request.query(query);
  return result.recordset;
}

async function createReturn(payload) {
  const must = [];
  if (!payload?.tanggal) must.push("tanggal");
  if (payload?.idPembeli == null) must.push("idPembeli");
  if (must.length) throw badReq(`Field wajib: ${must.join(", ")}`);

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // 0) normalize date + lock guard
    const effectiveDate = resolveEffectiveDateForCreate(payload.tanggal);

    await assertNotLocked({
      date: effectiveDate,
      runner: tx,
      action: "create BJRetur",
      useLock: true,
    });

    // 1) generate NoRetur
    // ✅ adjust prefix/width to your standard
    const no1 = await generateNextCode(tx, {
      tableName: "dbo.BJRetur_h",
      columnName: "NoRetur",
      prefix: "L.", // <--- change if needed
      width: 10,
    });

    // optional anti-race double check
    const rqCheck = new sql.Request(tx);
    const exist = await rqCheck.input("NoRetur", sql.VarChar(50), no1).query(`
        SELECT 1
        FROM dbo.BJRetur_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoRetur = @NoRetur
      `);

    const noRetur = exist.recordset.length
      ? await generateNextCode(tx, {
          tableName: "dbo.BJRetur_h",
          columnName: "NoRetur",
          prefix: "L.",
          width: 10,
        })
      : no1;

    // 2) insert header
    const rqIns = new sql.Request(tx);
    rqIns
      .input("NoRetur", sql.VarChar(50), noRetur)
      .input("Invoice", sql.VarChar(50), payload.invoice) // adjust length if needed
      .input("Tanggal", sql.Date, effectiveDate)
      .input("IdPembeli", sql.Int, payload.idPembeli)
      .input("NoBJSortir", sql.VarChar(50), payload.noBJSortir);

    // If your table has IdUsername, uncomment:
    // rqIns.input('IdUsername', sql.Int, payload.idUsername);

    const insertSql = `
      INSERT INTO dbo.BJRetur_h (
        NoRetur,
        Invoice,
        Tanggal,
        IdPembeli,
        NoBJSortir
        -- ,IdUsername
      )
      OUTPUT INSERTED.*
      VALUES (
        @NoRetur,
        @Invoice,
        @Tanggal,
        @IdPembeli,
        @NoBJSortir
        -- ,@IdUsername
      );
    `;

    const insRes = await rqIns.query(insertSql);

    await tx.commit();
    return { header: insRes.recordset?.[0] || null };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function updateReturn(noRetur, payload) {
  if (!noRetur) throw badReq("noRetur wajib");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // 0) lock header + get old doc date
    const { docDateOnly: oldDocDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "return", // ✅ ensure this exists in your config
      codeValue: noRetur, // ✅ NoRetur
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });

    // 1) determine date change
    const isChangingDate = payload?.tanggal !== undefined;
    let newDocDateOnly = null;

    if (isChangingDate) {
      if (!payload.tanggal) throw badReq("tanggal tidak boleh kosong");
      newDocDateOnly = resolveEffectiveDateForCreate(payload.tanggal);
    }

    // 2) tutup transaksi guard (old and new if changed)
    await assertNotLocked({
      date: oldDocDateOnly,
      runner: tx,
      action: "update BJRetur (current date)",
      useLock: true,
    });

    if (isChangingDate) {
      await assertNotLocked({
        date: newDocDateOnly,
        runner: tx,
        action: "update BJRetur (new date)",
        useLock: true,
      });
    }

    // 3) dynamic SET (HEADER ONLY)
    const sets = [];
    const rqUpd = new sql.Request(tx);

    if (isChangingDate) {
      sets.push("Tanggal = @Tanggal");
      rqUpd.input("Tanggal", sql.Date, newDocDateOnly);
    }

    if (payload.invoice !== undefined) {
      const inv =
        payload.invoice === null ? null : String(payload.invoice || "").trim();
      sets.push("Invoice = @Invoice");
      rqUpd.input("Invoice", sql.VarChar(50), inv || null);
    }

    if (payload.idPembeli !== undefined) {
      if (payload.idPembeli == null)
        throw badReq("idPembeli tidak boleh kosong");
      sets.push("IdPembeli = @IdPembeli");
      rqUpd.input("IdPembeli", sql.Int, payload.idPembeli);
    }

    if (payload.noBJSortir !== undefined) {
      const nb =
        payload.noBJSortir === null
          ? null
          : String(payload.noBJSortir || "").trim();
      sets.push("NoBJSortir = @NoBJSortir");
      rqUpd.input("NoBJSortir", sql.VarChar(50), nb || null);
    }

    if (sets.length === 0) throw badReq("No fields to update");

    rqUpd.input("NoRetur", sql.VarChar(50), noRetur);

    const updateSql = `
      UPDATE dbo.BJRetur_h
      SET ${sets.join(", ")}
      WHERE NoRetur = @NoRetur;

      SELECT *
      FROM dbo.BJRetur_h
      WHERE NoRetur = @NoRetur;
    `;

    const updRes = await rqUpd.query(updateSql);
    const updatedHeader = updRes.recordset?.[0] || null;
    if (!updatedHeader) throw badReq(`NoRetur ${noRetur} tidak ditemukan`);

    // 4) if tanggal changed -> sync DateUsage for labels mapped by this NoRetur
    //    (details tables are used ONLY internally for sync)
    if (isChangingDate && updatedHeader) {
      const usageDate = resolveEffectiveDateForCreate(updatedHeader.Tanggal);

      const rqUsage = new sql.Request(tx);
      rqUsage
        .input("NoRetur", sql.VarChar(50), noRetur)
        .input("Tanggal", sql.Date, usageDate);

      await rqUsage.query(`
        /* =======================
           RETURN -> DateUsage Sync
           Rule: update only if DateUsage already exists (NOT NULL)
           ======================= */

        -- BARANG JADI (via BJReturBarangJadi_d)
        UPDATE bj
        SET bj.DateUsage = @Tanggal
        FROM dbo.BarangJadi AS bj
        WHERE bj.DateUsage IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.BJReturBarangJadi_d AS d
            WHERE d.NoRetur = @NoRetur
              AND d.NoBJ = bj.NoBJ
          );

        -- FURNITURE WIP (via BJReturFurnitureWIP_d)
        UPDATE fw
        SET fw.DateUsage = @Tanggal
        FROM dbo.FurnitureWIP AS fw
        WHERE fw.DateUsage IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.BJReturFurnitureWIP_d AS d
            WHERE d.NoRetur = @NoRetur
              AND d.NoFurnitureWIP = fw.NoFurnitureWIP
          );
      `);
    }

    await tx.commit();
    return { header: updatedHeader };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function deleteReturn(noRetur) {
  if (!noRetur) throw badReq("noRetur wajib");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // 0) ambil docDateOnly dari config (lock header)
    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "return", // ✅ must exist in your config
      codeValue: noRetur, // ✅ NoRetur
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });

    // 1) guard tutup transaksi
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete BJRetur",
      useLock: true,
    });

    // 2) cek detail input dulu (block delete if exists)
    const rqChk = new sql.Request(tx);
    rqChk.input("NoRetur", sql.VarChar(50), noRetur);

    const chkRes = await rqChk.query(`
      SELECT
        (SELECT COUNT(1) FROM dbo.BJReturBarangJadi_d WITH (NOLOCK) WHERE NoRetur = @NoRetur) AS CntBJ,
        (SELECT COUNT(1) FROM dbo.BJReturFurnitureWIP_d WITH (NOLOCK) WHERE NoRetur = @NoRetur) AS CntFWIP;
    `);

    const row = chkRes.recordset?.[0] || { CntBJ: 0, CntFWIP: 0 };
    const cntBJ = Number(row.CntBJ || 0);
    const cntFWIP = Number(row.CntFWIP || 0);

    if (cntBJ > 0 || cntFWIP > 0) {
      throw badReq(
        `Tidak dapat menghapus NoRetur ini karena masih memiliki detail input: ` +
          `Barang Jadi=${cntBJ}, FurnitureWIP=${cntFWIP}. ` +
          `Hapus detailnya terlebih dahulu.`,
      );
    }

    // 3) delete header (details already must be empty)
    const rqDel = new sql.Request(tx);
    rqDel.input("NoRetur", sql.VarChar(50), noRetur);

    await rqDel.query(`
      DELETE FROM dbo.BJRetur_h
      WHERE NoRetur = @NoRetur;
    `);

    await tx.commit();
    return { success: true };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

// Bentuk kolom output disamakan dgn label/all (label-service.js, CTE "BB"
// furniturewip) — LabelCode/DateCreate/NamaJenis/KodeKategori/Kategori/Uom/
// Blok/IdLokasi/Qty — supaya FE bisa pakai komponen render label yang sama.
// HasBeenPrinted dipertahankan (field lama, sudah dipakai konsumen existing).
async function fetchOutputsFurnitureWip(noRetur) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("noRetur", sql.VarChar(50), noRetur);

  const q = `
    SELECT DISTINCT
      d.NoRetur,
      d.NoFurnitureWIP,
      fw.NoFurnitureWIP AS LabelCode,
      fw.DateCreate,
      mcw.Nama AS NamaJenis,
      N'furniturewip' AS KodeKategori,
      N'Furniture WIP' AS Kategori,
      N'pcs' AS Uom,
      fw.Blok,
      fw.IdLokasi,
      ISNULL(fwAgg.TotalPcs, 0) AS Qty,
      ISNULL(fw.HasBeenPrinted, 0) AS HasBeenPrinted
    FROM dbo.BJReturFurnitureWIP_d d WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = d.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mcw WITH (NOLOCK)
      ON mcw.IdCabinetWIP = fw.IdFurnitureWIP
    LEFT JOIN (
        SELECT
          x.NoFurnitureWIP,
          SUM(
              CASE
                  WHEN x.IsPartial = 1
                      THEN ISNULL(x.Pcs,0) - ISNULL(p.TotalPartialPcs,0)
                  ELSE ISNULL(x.Pcs,0)
              END
          ) AS TotalPcs
        FROM dbo.FurnitureWIP x WITH (NOLOCK)
        LEFT JOIN (
            SELECT NoFurnitureWIP, SUM(Pcs) AS TotalPartialPcs
            FROM dbo.FurnitureWIPPartial
            GROUP BY NoFurnitureWIP
        ) p ON p.NoFurnitureWIP = x.NoFurnitureWIP
        GROUP BY x.NoFurnitureWIP
    ) fwAgg ON fwAgg.NoFurnitureWIP = fw.NoFurnitureWIP
    WHERE d.NoRetur = @noRetur
    ORDER BY fw.NoFurnitureWIP DESC;
  `;

  const rs = await req.query(q);
  return (rs.recordset || []).map((r) => ({
    ...r,
    ...(r.DateCreate && { DateCreate: formatDate(r.DateCreate) }),
  }));
}

function buildImportAsGsuGroupedQuery(
  comparisonOperator,
  { excludeExistingInvoices = false } = {},
) {
  if (!["=", ">"].includes(comparisonOperator)) {
    throw new Error("Unsupported InvoiceDate comparison operator");
  }

  const existingInvoiceFilter = excludeExistingInvoices
    ? `
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.BJRetur_h R
          WHERE R.Invoice = B.InvoiceNumber
        )`
    : "";

  return `
    SELECT
      A.InvoiceNumber,
      A.InvoiceType,
      A.ItemName,
      A.StockCategoryName,
      A.ItemCode,
      SUM(A.Quantity) AS Quantity,
      A.CODE,
      A.SumberCode,
      A.CustomerName,
      A.IdPembeli
    FROM (
      SELECT
        B.InvoiceNumber,
        B.InvoiceType,
        C.ItemName,
        D.StockCategoryName,
        C.ItemCode,
        A.Quantity,
        B.InvoiceDate,
        COALESCE(E.IDBJ, F.IDCABINETWIP, G.IDCABINETMATERIAL) AS CODE,
        CASE
          WHEN E.ItemCode IS NOT NULL THEN 'BARANG JADI'
          WHEN F.ItemCode IS NOT NULL THEN 'WORK IN PROGRESS'
          WHEN G.ItemCode IS NOT NULL THEN 'BAHAN PENDUKUNG'
          ELSE 'Tidak Ada'
        END AS SumberCode,
        H.CustomerName,
        I.IdPembeli
      FROM AS_GSU.DBO.AR_InvoiceDetails A
      LEFT JOIN AS_GSU.DBO.AR_Invoices B ON B.InvoiceID = A.InvoiceID
      LEFT JOIN AS_GSU.DBO.IC_ITEMS C ON C.ItemID = A.ItemID
      LEFT JOIN AS_GSU.DBO.IC_StockCategories D ON D.StockCategoryID = C.CategoryID
      LEFT JOIN MstBarangJadi E ON E.ItemCode = C.ItemCode
      LEFT JOIN MstCabinetWIP F ON F.ItemCode = C.ItemCode
      LEFT JOIN MstCabinetMaterial G ON G.ItemCode = C.ItemCode
      LEFT JOIN AS_GSU.dbo.AR_Customers H ON H.CustomerID = B.CustomerID
      LEFT JOIN MstPembeli I ON I.CustomerCode = H.CustomerCode
      WHERE IsInvoice = 0
        AND CONVERT(date, B.InvoiceDate) ${comparisonOperator} @date
        AND B.Void = 0
        ${existingInvoiceFilter}
    ) A
    GROUP BY
      A.InvoiceNumber, A.InvoiceType, A.ItemName, A.StockCategoryName, A.ItemCode,
      A.CODE, A.SumberCode, A.CustomerName, A.IdPembeli
  `;
}

async function fetchImportAsGsuByDateComparison(date, comparisonOperator) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("date", sql.Date, date);

  const groupedQuery = buildImportAsGsuGroupedQuery(comparisonOperator);
  const result = await req.query(`
    ${groupedQuery}
    ORDER BY A.InvoiceNumber, A.ItemName
  `);
  return result.recordset || [];
}

async function fetchImportAsGsuByDate(date) {
  return fetchImportAsGsuByDateComparison(date, "=");
}

function groupImportAsGsuRowsByInvoice(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = JSON.stringify([
      row.InvoiceNumber ?? null,
      row.InvoiceType ?? null,
    ]);

    if (!groups.has(key)) {
      groups.set(key, {
        InvoiceNumber: row.InvoiceNumber ?? null,
        InvoiceType: row.InvoiceType ?? null,
        items: [],
      });
    }

    groups.get(key).items.push(row);
  }

  return Array.from(groups.values());
}

async function fetchImportAsGsuAfterDate(page = 1, pageSize = 20) {
  const pool = await poolPromise;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const groupedQuery = buildImportAsGsuGroupedQuery(">", {
    excludeExistingInvoices: true,
  });

  const countReq = pool.request();
  countReq.input("date", sql.Date, IMPORT_AS_GSU_CUTOFF_DATE);
  const countResult = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM (
      SELECT
        ImportItems.InvoiceNumber,
        ImportItems.InvoiceType
      FROM (
        ${groupedQuery}
      ) AS ImportItems
      GROUP BY
        ImportItems.InvoiceNumber,
        ImportItems.InvoiceType
    ) AS InvoiceGroups;
  `);
  const total = countResult.recordset?.[0]?.total || 0;

  if (total === 0) {
    return { data: [], total: 0 };
  }

  const dataReq = pool.request();
  dataReq.input("date", sql.Date, IMPORT_AS_GSU_CUTOFF_DATE);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("pageSize", sql.Int, ps);
  const dataResult = await dataReq.query(`
    ;WITH ImportItems AS (
      ${groupedQuery}
    ),
    InvoiceGroups AS (
      SELECT
        InvoiceNumber,
        InvoiceType
      FROM ImportItems
      GROUP BY
        InvoiceNumber,
        InvoiceType
    ),
    PagedInvoiceGroups AS (
      SELECT
        InvoiceNumber,
        InvoiceType
      FROM InvoiceGroups
      ORDER BY
        InvoiceNumber,
        InvoiceType
      OFFSET @offset ROWS
      FETCH NEXT @pageSize ROWS ONLY
    )
    SELECT
      I.InvoiceNumber,
      I.InvoiceType,
      I.ItemName,
      I.StockCategoryName,
      I.ItemCode,
      I.Quantity,
      I.CODE,
      I.SumberCode,
      I.CustomerName,
      I.IdPembeli
    FROM PagedInvoiceGroups P
    INNER JOIN ImportItems I
      ON (
        I.InvoiceNumber = P.InvoiceNumber
        OR (I.InvoiceNumber IS NULL AND P.InvoiceNumber IS NULL)
      )
      AND (
        I.InvoiceType = P.InvoiceType
        OR (I.InvoiceType IS NULL AND P.InvoiceType IS NULL)
      )
    ORDER BY
      I.InvoiceNumber,
      I.InvoiceType,
      I.ItemName,
      I.ItemCode;
  `);

  return {
    data: groupImportAsGsuRowsByInvoice(dataResult.recordset || []),
    total,
  };
}

async function executeImportAsGsu(date, items, username) {
  if (!items || items.length === 0) throw badReq("No items to import");
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const importedBJ = [];
    const importedFWIP = [];
    const headers = [];

    // Group by InvoiceNumber
    const groups = new Map();
    for (const item of items) {
      const key = item.InvoiceNumber || '(no invoice)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    for (const [invoice, grpItems] of groups.entries()) {
      const firstItem = grpItems[0];

      // Generate NoRetur
      const noReturRq = new sql.Request(tx);
      const noReturRes = await noReturRq.query(`
        SELECT 'L.' + FORMAT(ISNULL(MAX(RIGHT(NoRetur, 10)), 0) + 1, '0000000000') AS NoRetur
        FROM dbo.BJRetur_h
      `);
      const noRetur = noReturRes.recordset[0].NoRetur;

      // Insert BJRetur_h header
      const idPembeli = parseInt(firstItem.IdPembeli, 10) || 0;
      const hdrRq = new sql.Request(tx);
      await hdrRq
        .input('NoRetur', sql.VarChar(50), noRetur)
        .input('Invoice', sql.VarChar(100), invoice)
        .input('Tanggal', sql.Date, date)
        .input('IdPembeli', sql.Int, idPembeli)
        .input('idWarehouse', sql.Int, 4)
        .query(`
          INSERT INTO dbo.BJRetur_h (NoRetur, Invoice, Tanggal, IdPembeli, idWarehouse)
          VALUES (@NoRetur, @Invoice, @Tanggal, @IdPembeli, @idWarehouse)
        `);

      headers.push({ NoRetur: noRetur, Invoice: invoice, IdPembeli: idPembeli });

      for (const item of grpItems) {
        const sumberCode = item.SumberCode;
        const code = item.CODE;
        const quantity = item.Quantity;

        if (sumberCode === 'BARANG JADI' && code) {
          const seqRq = new sql.Request(tx);
          const bjRes = await seqRq.query(`
            SELECT ISNULL(MAX(CAST(RIGHT(NoBJ, 10) AS BIGINT)), 0) + 1 AS NextNo
            FROM dbo.BarangJadi
          `);
          const nextSeq = bjRes.recordset[0].NextNo;
          const noBJ = 'BA.' + String(nextSeq).padStart(10, '0');
          const idBJ = parseInt(code, 10);

          const insRq = new sql.Request(tx);
          await insRq
            .input('NoBJ', sql.VarChar(50), noBJ)
            .input('IdBJ', sql.Int, idBJ)
            .input('DateCreate', sql.Date, date)
            .input('Pcs', sql.Int, quantity)
            .input('CreateBy', sql.VarChar(50), username)
            .query(`
              INSERT INTO dbo.BarangJadi (NoBJ, IdBJ, DateCreate, Jam, Pcs, CreateBy, DateTimeCreate)
              VALUES (@NoBJ, @IdBJ, @DateCreate, CONVERT(TIME, GETDATE()), @Pcs, @CreateBy, GETDATE())
            `);

          const detRq = new sql.Request(tx);
          await detRq
            .input('NoBJ', sql.VarChar(50), noBJ)
            .input('NoRetur', sql.VarChar(50), noRetur)
            .query(`
              INSERT INTO dbo.BJReturBarangJadi_d (NoRetur, NoBJ)
              VALUES (@NoRetur, @NoBJ)
            `);

          importedBJ.push({ NoBJ: noBJ, IdBJ: idBJ, Pcs: quantity, NoRetur: noRetur });
        }

        if (sumberCode === 'WORK IN PROGRESS' && code) {
          const seqRq = new sql.Request(tx);
          const fwipRes = await seqRq.query(`
            SELECT ISNULL(MAX(CAST(RIGHT(NoFurnitureWIP, 10) AS BIGINT)), 0) + 1 AS NextNo
            FROM dbo.FurnitureWIP
          `);
          const nextSeq = fwipRes.recordset[0].NextNo;
          const noFWIP = 'BB.' + String(nextSeq).padStart(10, '0');
          const idFWIP = parseInt(code, 10);

          const insRq = new sql.Request(tx);
          await insRq
            .input('NoFurnitureWIP', sql.VarChar(50), noFWIP)
            .input('IdFurnitureWIP', sql.Int, idFWIP)
            .input('DateCreate', sql.Date, date)
            .input('Pcs', sql.Int, quantity)
            .input('CreateBy', sql.VarChar(50), username)
            .query(`
              INSERT INTO dbo.FurnitureWIP (NoFurnitureWIP, IDFurnitureWIP, DateCreate, Pcs, CreateBy, DateTimeCreate)
              VALUES (@NoFurnitureWIP, @IdFurnitureWIP, @DateCreate, @Pcs, @CreateBy, GETDATE())
            `);

          const detRq = new sql.Request(tx);
          await detRq
            .input('NoFurnitureWIP', sql.VarChar(50), noFWIP)
            .input('NoRetur', sql.VarChar(50), noRetur)
            .query(`
              INSERT INTO dbo.BJReturFurnitureWIP_d (NoRetur, NoFurnitureWIP)
              VALUES (@NoRetur, @NoFurnitureWIP)
            `);

          importedFWIP.push({ NoFurnitureWIP: noFWIP, IDFurnitureWIP: idFWIP, Pcs: quantity, NoRetur: noRetur });
        }
      }
    }

    await tx.commit();
    return { headers, importedBJ, importedFWIP };
  } catch (e) {
    try { await tx.rollback(); } catch (_) {}
    throw e;
  }
}

// Bentuk kolom output disamakan dgn label/all (label-service.js, CTE "BA"
// barangjadi) — lihat catatan yang sama di fetchOutputsFurnitureWip di atas.
async function fetchOutputsBarangJadi(noRetur) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("noRetur", sql.VarChar(50), noRetur);

  const q = `
    SELECT DISTINCT
      d.NoRetur,
      d.NoBJ,
      bj.NoBJ AS LabelCode,
      bj.DateCreate,
      mbj.NamaBJ AS NamaJenis,
      N'barangjadi' AS KodeKategori,
      N'Barang Jadi' AS Kategori,
      N'pcs' AS Uom,
      bj.Blok,
      bj.IdLokasi,
      ISNULL(bjAgg.TotalPcs, 0) AS Qty,
      ISNULL(bj.HasBeenPrinted, 0) AS HasBeenPrinted
    FROM dbo.BJReturBarangJadi_d d WITH (NOLOCK)
    LEFT JOIN dbo.BarangJadi bj WITH (NOLOCK)
      ON bj.NoBJ = d.NoBJ
    LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
      ON mbj.IdBJ = bj.IdBJ
    LEFT JOIN (
        SELECT
          x.NoBJ,
          SUM(
              CASE
                  WHEN x.IsPartial = 1
                      THEN ISNULL(x.Pcs,0) - ISNULL(p.TotalPartialPcs,0)
                  ELSE ISNULL(x.Pcs,0)
              END
          ) AS TotalPcs
        FROM dbo.BarangJadi x WITH (NOLOCK)
        LEFT JOIN (
            SELECT NoBJ, SUM(Pcs) AS TotalPartialPcs
            FROM dbo.BarangJadiPartial
            GROUP BY NoBJ
        ) p ON p.NoBJ = x.NoBJ
        GROUP BY x.NoBJ
    ) bjAgg ON bjAgg.NoBJ = bj.NoBJ
    WHERE d.NoRetur = @noRetur
    ORDER BY bj.NoBJ DESC;
  `;

  const rs = await req.query(q);
  return (rs.recordset || []).map((r) => ({
    ...r,
    ...(r.DateCreate && { DateCreate: formatDate(r.DateCreate) }),
  }));
}

async function fetchAllOutputs(noRetur) {
  const [furnitureWip, barangJadi] = await Promise.all([
    fetchOutputsFurnitureWip(noRetur),
    fetchOutputsBarangJadi(noRetur),
  ]);

  const data = [
    ...furnitureWip.map((r) => ({
      ...r,
      kategori: "furniture-wip",
      noOutput: r.NoFurnitureWIP,
    })),
    ...barangJadi.map((r) => ({
      ...r,
      kategori: "barang-jadi",
      noOutput: r.NoBJ,
    })),
  ];

  return {
    data,
    totalFurnitureWip: furnitureWip.length,
    totalBarangJadi: barangJadi.length,
    total: data.length,
  };
}

module.exports = {
  IMPORT_AS_GSU_CUTOFF_DATE,
  getAllReturns,
  getReturnsByDate,
  createReturn,
  updateReturn,
  deleteReturn,
  fetchOutputsFurnitureWip,
  fetchOutputsBarangJadi,
  fetchImportAsGsuByDate,
  fetchImportAsGsuAfterDate,
  executeImportAsGsu,
  fetchAllOutputs,
};
