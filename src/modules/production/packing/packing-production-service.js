// services/packing-production-service.js
const { sql, poolPromise } = require("../../../core/config/db");
const {
  resolveEffectiveDateForCreate,
  toDateOnly,
  assertNotLocked,
  formatYMD,
  loadDocDateOnlyFromConfig,
} = require("../../../core/shared/tutup-transaksi-guard");
const sharedInputService = require("../../../core/shared/produksi-input.service");
const { badReq, conflict, notFound } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const {
  parseJamToInt,
  calcJamKerjaFromStartEnd,
} = require("../../../core/utils/jam-kerja-helper");

// ✅ NEW: GET ALL (paging + search + optional date range)
async function getAllProduksi(
  page = 1,
  pageSize = 20,
  search = "",
  dateFrom = null,
  dateTo = null,
) {
  const pool = await poolPromise;

  const offset = (Math.max(page, 1) - 1) * Math.max(pageSize, 1);
  const s = String(search || "").trim();

  const rqCount = pool.request();
  const rqData = pool.request();

  rqCount.input("search", sql.VarChar(50), s);
  rqData.input("search", sql.VarChar(50), s);

  // optional dates
  rqCount.input("dateFrom", sql.Date, dateFrom);
  rqCount.input("dateTo", sql.Date, dateTo);

  rqData.input("dateFrom", sql.Date, dateFrom);
  rqData.input("dateTo", sql.Date, dateTo);

  rqData.input("offset", sql.Int, offset);
  rqData.input("pageSize", sql.Int, pageSize);

  const qWhere = `
    WHERE (@search = '' OR h.NoPacking LIKE '%' + @search + '%')
      AND (@dateFrom IS NULL OR CONVERT(date, h.Tanggal) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(date, h.Tanggal) <= @dateTo)
  `;

  const qCount = `
    SELECT COUNT(1) AS Total
    FROM dbo.PackingProduksi_h h WITH (NOLOCK)
    ${qWhere};
  `;

  const qData = `
    SELECT
      h.NoPacking,
      h.Tanggal,
      h.IdMesin,
      m.NamaMesin,
      h.IdOperator,
      o.NamaOperator,
      h.OutputJenisId,
      bj.NamaBJ AS OutputJenisNama,
      h.Shift,
      h.JamKerja,
      h.CreateBy,
      h.CheckBy1,
      h.CheckBy2,
      h.ApproveBy,
      h.HourMeter,
      h.HourStart,
      h.HourEnd
    FROM dbo.PackingProduksi_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstMesin m WITH (NOLOCK) ON h.IdMesin = m.IdMesin
    LEFT JOIN dbo.MstOperator o WITH (NOLOCK) ON h.IdOperator = o.IdOperator
    LEFT JOIN dbo.MstBarangJadi bj WITH (NOLOCK) ON bj.IdBJ = h.OutputJenisId
    ${qWhere}
    ORDER BY h.Tanggal DESC, h.NoPacking DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `;

  const countRes = await rqCount.query(qCount);
  const total = countRes.recordset?.[0]?.Total ?? 0;

  const dataRes = await rqData.query(qData);
  const data = dataRes.recordset || [];

  return { data, total };
}

async function getProduksiByDate(date) {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT 
      h.NoPacking,
      h.Tanggal,
      h.IdMesin,
      m.NamaMesin,
      h.IdOperator,
      o.NamaOperator,
      h.OutputJenisId,
      bj.NamaBJ AS OutputJenisNama,
      h.Shift,
      h.JamKerja,
      h.CreateBy,
      h.CheckBy1,
      h.CheckBy2,
      h.ApproveBy,
      h.HourMeter,
      h.HourStart,
      h.HourEnd
    FROM [dbo].[PackingProduksi_h] h
    LEFT JOIN [dbo].[MstMesin] m
      ON h.IdMesin = m.IdMesin
    LEFT JOIN [dbo].[MstOperator] o
      ON h.IdOperator = o.IdOperator
    LEFT JOIN [dbo].[MstBarangJadi] bj
      ON bj.IdBJ = h.OutputJenisId
    WHERE CONVERT(date, h.Tanggal) = @date
    ORDER BY h.JamKerja ASC;
  `;

  request.input("date", sql.Date, date);
  const result = await request.query(query);
  return result.recordset;
}

async function createPackingProduksi(payload, ctx) {
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

  const must = [];
  if (!body?.tglProduksi) must.push("tglProduksi");
  if (body?.idMesin == null) must.push("idMesin");
  if (operatorIds.length === 0) must.push("idOperators");
  if (body?.outputJenisId == null) must.push("outputJenisId");
  if (body?.idRegu == null) must.push("idRegu");
  if (body?.shift == null) must.push("shift");
  if (!body?.hourStart) must.push("hourStart");
  if (!body?.hourEnd) must.push("hourEnd");
  if (must.length) throw badReq(`Field wajib: ${must.join(", ")}`);

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
    // Normalize date + lock guard
    // ===============================
    const effectiveDate = resolveEffectiveDateForCreate(body.tglProduksi);

    await assertNotLocked({
      date: effectiveDate,
      runner: tx,
      action: "create PackingProduksi",
      useLock: true,
    });

    // ===============================
    // Generate NoPacking unik
    // ===============================
    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.PackingProduksi_h",
        columnName: "NoPacking",
        prefix: "BD.",
        width: 10,
      });

    let noPacking = await gen();

    // anti-race double check
    const exist = await new sql.Request(tx).input(
      "NoPacking",
      sql.VarChar(50),
      noPacking,
    ).query(`
        SELECT 1
        FROM dbo.PackingProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoPacking = @NoPacking
      `);

    if (exist.recordset.length > 0) {
      noPacking = await gen();
    }

    // ===============================
    // JamKerja
    // ===============================
    let jamKerjaInt = null;
    if (
      body.jamKerja !== null &&
      body.jamKerja !== undefined &&
      body.jamKerja !== ""
    ) {
      jamKerjaInt = parseJamToInt(body.jamKerja);
    } else {
      jamKerjaInt = calcJamKerjaFromStartEnd(body.hourStart, body.hourEnd);
    }

    // ===============================
    // Insert header dengan OUTPUT INTO
    // ===============================
    const rqIns = new sql.Request(tx);
    rqIns
      .input("NoPacking", sql.VarChar(50), noPacking)
      .input("Tanggal", sql.Date, effectiveDate)
      .input("IdMesin", sql.Int, body.idMesin)
      .input("OutputJenisId", sql.Int, body.outputJenisId ?? null)
      .input("IdRegu", sql.Int, body.idRegu ?? null)
      .input("Shift", sql.Int, body.shift)
      .input("JamKerja", sql.Int, jamKerjaInt)
      .input("CreateBy", sql.VarChar(100), body.createBy)
      .input("CheckBy1", sql.VarChar(100), body.checkBy1 ?? null)
      .input("CheckBy2", sql.VarChar(100), body.checkBy2 ?? null)
      .input("ApproveBy", sql.VarChar(100), body.approveBy ?? null)
      .input("HourMeter", sql.Decimal(18, 2), body.hourMeter ?? null)
      .input("HourStart", sql.VarChar(20), body.hourStart)
      .input("HourEnd", sql.VarChar(20), body.hourEnd);

    const insertSql = `
      DECLARE @tmp TABLE (
        NoPacking varchar(50),
        Tanggal date,
        IdMesin int,
        OutputJenisId int,
        IdRegu int,
        Shift int,
        JamKerja int,
        CreateBy varchar(100),
        CheckBy1 varchar(100),
        CheckBy2 varchar(100),
        ApproveBy varchar(100),
        HourMeter decimal(18,2),
        HourStart time(7),
        HourEnd time(7)
      );

      INSERT INTO dbo.PackingProduksi_h (
        NoPacking, Tanggal, IdMesin, Shift, JamKerja,
        CreateBy, CheckBy1, CheckBy2, ApproveBy,
        HourMeter, HourStart, HourEnd, OutputJenisId, IdRegu
      )
      OUTPUT
        INSERTED.NoPacking,
        INSERTED.Tanggal,
        INSERTED.IdMesin,
        INSERTED.OutputJenisId,
        INSERTED.IdRegu,
        INSERTED.Shift,
        INSERTED.JamKerja,
        INSERTED.CreateBy,
        INSERTED.CheckBy1,
        INSERTED.CheckBy2,
        INSERTED.ApproveBy,
        INSERTED.HourMeter,
        INSERTED.HourStart,
        INSERTED.HourEnd
      INTO @tmp
      VALUES (
        @NoPacking, @Tanggal, @IdMesin, @Shift, @JamKerja,
        @CreateBy, @CheckBy1, @CheckBy2, @ApproveBy, @HourMeter,
        CASE
          WHEN @HourStart IS NULL OR LTRIM(RTRIM(@HourStart)) = ''
          THEN NULL ELSE CAST(@HourStart AS time(7))
        END,
        CASE
          WHEN @HourEnd IS NULL OR LTRIM(RTRIM(@HourEnd)) = ''
          THEN NULL ELSE CAST(@HourEnd AS time(7))
        END,
        @OutputJenisId,
        @IdRegu
      );

      SELECT * FROM @tmp;
    `;

    const insRes = await rqIns.query(insertSql);

    if (operatorIds.length > 0) {
      const rqOp = new sql.Request(tx);
      rqOp.input("NoPacking", sql.VarChar(50), noPacking);
      const opValues = operatorIds.map((opId, i) => {
        const p = `DetailOp${i}`;
        rqOp.input(p, sql.Int, opId);
        return `(@NoPacking, @${p})`;
      });
      await rqOp.query(`
        INSERT INTO dbo.PackingProduksiOperator_d (NoPacking, IdOperator)
        VALUES ${opValues.join(", ")};
      `);
    }

    await tx.commit();

    return {
      header: {
        ...(insRes.recordset?.[0] || {}),
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

/**
 * Update PackingProduksi_h by NoPacking (BD.0000000138)
 * - Dynamic SET (only fields provided)
 * - Guard closing/locking by date (old + new date if changing)
 * - If date changed -> sync FurnitureWIP.DateUsage via:
 *   - PackingProduksiInputLabelFWIP
 *   - PackingProduksiInputLabelFWIPPartial -> FurnitureWIPPartial -> FurnitureWIP
 */
async function updatePackingProduksi(noPacking, payload, ctx = {}) {
  if (!noPacking) throw badReq("noPacking wajib");

  // ===============================
  // Validasi ctx / audit
  // ===============================
  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib");
  }

  const auditCtx = {
    actorId: Math.trunc(actorIdNum),
    actorUsername: String(ctx?.actorUsername || "system"),
    requestId: String(ctx?.requestId || ""),
  };

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // ===============================
    // Apply audit context ✅ FIX
    // ===============================
    const auditReq = new sql.Request(tx);
    const audit = await applyAuditContext(auditReq, auditCtx);

    // ===============================
    // 0) lock header + ambil tanggal lama
    // ===============================
    const { docDateOnly: oldDocDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "packingProduksi",
      codeValue: noPacking,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });

    // ===============================
    // 1) detect perubahan tanggal
    // ===============================
    const isChangingDate = payload?.tglProduksi !== undefined;
    let newDocDateOnly = null;

    if (isChangingDate) {
      if (!payload.tglProduksi) {
        throw badReq("tglProduksi tidak boleh kosong");
      }
      newDocDateOnly = resolveEffectiveDateForCreate(payload.tglProduksi);
    }

    // ===============================
    // 2) guard tutup transaksi
    // ===============================
    await assertNotLocked({
      date: oldDocDateOnly,
      runner: tx,
      action: "update PackingProduksi (current date)",
      useLock: true,
    });

    if (isChangingDate) {
      await assertNotLocked({
        date: newDocDateOnly,
        runner: tx,
        action: "update PackingProduksi (new date)",
        useLock: true,
      });
    }

    // ===============================
    // 3) build dynamic SET
    // ===============================
    const sets = [];
    const rqUpd = new sql.Request(tx);

    if (isChangingDate) {
      sets.push("Tanggal = @Tanggal");
      rqUpd.input("Tanggal", sql.Date, newDocDateOnly);
    }

    if (payload.idMesin !== undefined) {
      sets.push("IdMesin = @IdMesin");
      rqUpd.input("IdMesin", sql.Int, payload.idMesin);
    }

    if (payload.idOperator !== undefined) {
      sets.push("IdOperator = @IdOperator");
      rqUpd.input("IdOperator", sql.Int, payload.idOperator);
    }

    if (payload.shift !== undefined) {
      sets.push("Shift = @Shift");
      rqUpd.input("Shift", sql.Int, payload.shift);
    }

    if (payload.jamKerja !== undefined) {
      const jamKerjaInt =
        payload.jamKerja === null ? null : parseJamToInt(payload.jamKerja);
      sets.push("JamKerja = @JamKerja");
      rqUpd.input("JamKerja", sql.Int, jamKerjaInt);
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

    if (payload.hourMeter !== undefined) {
      sets.push("HourMeter = @HourMeter");
      rqUpd.input("HourMeter", sql.Decimal(18, 2), payload.hourMeter ?? null);
    }

    if (payload.hourStart !== undefined) {
      sets.push(`
        HourStart =
          CASE
            WHEN @HourStart IS NULL OR LTRIM(RTRIM(@HourStart)) = ''
            THEN NULL
            ELSE CAST(@HourStart AS time(7))
          END
      `);
      rqUpd.input("HourStart", sql.VarChar(20), payload.hourStart ?? null);
    }

    if (payload.hourEnd !== undefined) {
      sets.push(`
        HourEnd =
          CASE
            WHEN @HourEnd IS NULL OR LTRIM(RTRIM(@HourEnd)) = ''
            THEN NULL
            ELSE CAST(@HourEnd AS time(7))
          END
      `);
      rqUpd.input("HourEnd", sql.VarChar(20), payload.hourEnd ?? null);
    }

    if (sets.length === 0) throw badReq("No fields to update");

    rqUpd.input("NoPacking", sql.VarChar(50), noPacking);

    const updateSql = `
      UPDATE dbo.PackingProduksi_h
      SET ${sets.join(", ")}
      WHERE NoPacking = @NoPacking;

      SELECT *
      FROM dbo.PackingProduksi_h
      WHERE NoPacking = @NoPacking;
    `;

    const updRes = await rqUpd.query(updateSql);
    const updatedHeader = updRes.recordset?.[0] || null;

    // ===============================
    // 4) sync FurnitureWIP jika tanggal berubah
    // ===============================
    if (isChangingDate && updatedHeader) {
      const usageDate = resolveEffectiveDateForCreate(updatedHeader.Tanggal);

      const rqUsage = new sql.Request(tx);
      rqUsage
        .input("NoPacking", sql.VarChar(50), noPacking)
        .input("Tanggal", sql.Date, usageDate);

      await rqUsage.query(`
        UPDATE fw
        SET fw.DateUsage = @Tanggal
        FROM dbo.FurnitureWIP fw
        WHERE fw.DateUsage IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.PackingProduksiInputLabelFWIP map
            WHERE map.NoPacking = @NoPacking
              AND map.NoFurnitureWIP = fw.NoFurnitureWIP
          );

        UPDATE fw
        SET fw.DateUsage = @Tanggal
        FROM dbo.FurnitureWIP fw
        WHERE fw.DateUsage IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.PackingProduksiInputLabelFWIPPartial mp
            JOIN dbo.FurnitureWIPPartial fwp
              ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
            WHERE mp.NoPacking = @NoPacking
              AND fwp.NoFurnitureWIP = fw.NoFurnitureWIP
          );
      `);
    }

    await tx.commit();
    return { header: updatedHeader, audit };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function deletePackingProduksi(noPacking, ctx) {
  if (!noPacking) throw badReq("noPacking wajib");

  // ===============================
  // Audit context
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
    // 0) LOCK HEADER + AMBIL docDateOnly
    // ===============================
    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "packingProduksi",
      codeValue: noPacking,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });

    // ===============================
    // 1) GUARD TUTUP TRANSAKSI
    // ===============================
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete PackingProduksi",
      useLock: true,
    });

    // ===============================
    // 2) CEK OUTPUT BJ
    // ===============================
    const rqOut = new sql.Request(tx);
    const outRes = await rqOut.input("NoPacking", sql.VarChar(50), noPacking)
      .query(`
        SELECT COUNT(1) AS CntOutputBJ
        FROM dbo.PackingProduksiOutputLabelBJ WITH (NOLOCK)
        WHERE NoPacking = @NoPacking;
      `);

    const row = outRes.recordset?.[0] || { CntOutputBJ: 0 };
    if ((row.CntOutputBJ || 0) > 0) {
      throw badReq(
        "Tidak dapat menghapus NoPacking ini karena sudah memiliki data output (Label BJ).",
      );
    }

    // ===============================
    // 3) DELETE INPUT + RESET DATEUSAGE + DELETE HEADER
    // ===============================
    const rqDel = new sql.Request(tx);
    rqDel.input("NoPacking", sql.VarChar(50), noPacking);

    // ✅ apply audit context (BENAR)
    await applyAuditContext(rqDel, auditCtx);

    const sqlDelete = `
      DECLARE @FWIPKeys TABLE (NoFurnitureWIP varchar(50) PRIMARY KEY);

      /* =======================
         A) collect FWIP keys (FULL)
         ======================= */
      INSERT INTO @FWIPKeys (NoFurnitureWIP)
      SELECT DISTINCT map.NoFurnitureWIP
      FROM dbo.PackingProduksiInputLabelFWIP AS map
      WHERE map.NoPacking = @NoPacking
        AND map.NoFurnitureWIP IS NOT NULL;

      /* =======================
         B) collect FWIP keys (PARTIAL)
         ======================= */
      INSERT INTO @FWIPKeys (NoFurnitureWIP)
      SELECT DISTINCT fwp.NoFurnitureWIP
      FROM dbo.PackingProduksiInputLabelFWIPPartial AS mp
      JOIN dbo.FurnitureWIPPartial AS fwp
        ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
      WHERE mp.NoPacking = @NoPacking
        AND fwp.NoFurnitureWIP IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM @FWIPKeys k WHERE k.NoFurnitureWIP = fwp.NoFurnitureWIP
        );

      /* =======================
         C) delete partial rows
         ======================= */
      DELETE fwp
      FROM dbo.FurnitureWIPPartial AS fwp
      JOIN dbo.PackingProduksiInputLabelFWIPPartial AS mp
        ON mp.NoFurnitureWIPPartial = fwp.NoFurnitureWIPPartial
      WHERE mp.NoPacking = @NoPacking;

      /* =======================
         D) delete mappings + material
         ======================= */
      DELETE FROM dbo.PackingProduksiInputLabelFWIPPartial WHERE NoPacking = @NoPacking;
      DELETE FROM dbo.PackingProduksiInputLabelFWIP WHERE NoPacking = @NoPacking;
      DELETE FROM dbo.PackingProduksiInputMaterial WHERE NoPacking = @NoPacking;

      /* =======================
         E) reset DateUsage + IsPartial
         ======================= */
      UPDATE fw
      SET fw.DateUsage = NULL,
          fw.IsPartial =
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM dbo.FurnitureWIPPartial p
                WHERE p.NoFurnitureWIP = fw.NoFurnitureWIP
              ) THEN 1 ELSE 0 END
      FROM dbo.FurnitureWIP AS fw
      JOIN @FWIPKeys AS k
        ON k.NoFurnitureWIP = fw.NoFurnitureWIP;

      /* =======================
         F) delete header
         ======================= */
      DELETE FROM dbo.PackingProduksi_h
      WHERE NoPacking = @NoPacking;
    `;

    await rqDel.query(sqlDelete);
    await tx.commit();

    return { success: true, audit: auditCtx };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}

    // penting: attach audit agar controller bisa kirim meta.audit
    throw Object.assign(e, auditCtx);
  }
}

/**
 * ✅ GET Inputs for PackingProduksi
 * - FULL mapping: PackingProduksiInputLabelFWIP
 * - PARTIAL mapping: PackingProduksiInputLabelFWIPPartial -> FurnitureWIPPartial -> FurnitureWIP
 * - MATERIAL: PackingProduksiInputMaterial
 *
 * Output shape sama dengan spanner supaya Flutter bisa reuse:
 * {
 *   furnitureWip: [...full + partial merged...],
 *   cabinetMaterial: [...],
 *   summary: { furnitureWip: n, cabinetMaterial: n }
 * }
 */
async function fetchInputs(noPacking) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noPacking);

  const q = `
    /* ===================== [1] MAIN INPUTS (UNION) ===================== */

    -- FurnitureWIP FULL (BB...)
    SELECT
      'fwip' AS Src,
      map.NoPacking,
      map.NoFurnitureWIP AS Ref1,
      CAST(NULL AS varchar(50)) AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      fw.Berat,
      fw.Pcs,
      fw.IsPartial,
      fw.IDFurnitureWIP AS IdJenis,
      mw.Nama           AS NamaJenis,
      uom.NamaUOM       AS NamaUOM,
      CAST(NULL AS datetime) AS DatetimeInput
    FROM dbo.PackingProduksiInputLabelFWIP map WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = map.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mw WITH (NOLOCK)
      ON mw.IdCabinetWIP = fw.IDFurnitureWIP
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mw.IdUOM
    WHERE map.NoPacking = @no

    UNION ALL

    -- Cabinet Material (Packing)
    SELECT
      'material' AS Src,
      im.NoPacking,
      CAST(im.IdCabinetMaterial AS varchar(50)) AS Ref1,
      CAST(NULL AS varchar(50)) AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      CAST(NULL AS decimal(18,3)) AS Berat,
      CAST(im.Jumlah AS int)      AS Pcs,
      CAST(NULL AS bit)           AS IsPartial,
      CAST(NULL AS int)           AS IdJenis,
      mm.Nama                     AS NamaJenis,
      uom.NamaUOM                 AS NamaUOM,
      CAST(NULL AS datetime)      AS DatetimeInput
    FROM dbo.PackingProduksiInputMaterial im WITH (NOLOCK)
    LEFT JOIN dbo.MstCabinetMaterial mm WITH (NOLOCK)
      ON mm.IdCabinetMaterial = im.IdCabinetMaterial
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mm.IdUOM
    WHERE im.NoPacking = @no

    ORDER BY Ref1 DESC, Ref2 ASC;

    /* ===================== [2] PARTIALS ===================== */

    -- FurnitureWIP Partial (BC...)
    SELECT
      mp.NoFurnitureWIPPartial,
      fwp.NoFurnitureWIP,
      fwp.Pcs                AS PcsPartial,
      fw.Pcs                 AS PcsHeader,
      fw.Berat,
      fw.IDFurnitureWIP      AS IdJenis,
      mw.Nama                AS NamaJenis,
      uom.NamaUOM            AS NamaUOM
    FROM dbo.PackingProduksiInputLabelFWIPPartial mp WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIPPartial fwp WITH (NOLOCK)
      ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = fwp.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mw WITH (NOLOCK)
      ON mw.IdCabinetWIP = fw.IDFurnitureWIP
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mw.IdUOM
    WHERE mp.NoPacking = @no
    ORDER BY mp.NoFurnitureWIPPartial DESC;
  `;

  const rs = await req.query(q);

  const mainRows = rs.recordsets?.[0] || [];
  const fwipPartial = rs.recordsets?.[1] || [];

  const out = {
    furnitureWip: [],
    cabinetMaterial: [],
    summary: { furnitureWip: 0, cabinetMaterial: 0 },
  };

  // MAIN rows
  for (const r of mainRows) {
    const base = {
      pcs: r.Pcs ?? null,
      isPartial: r.IsPartial ?? null,
      idJenis: r.IdJenis ?? null,
      namaJenis: r.NamaJenis ?? null,
      namaUom: r.NamaUOM ?? null,
      datetimeInput: r.DatetimeInput ?? null,
    };

    switch (r.Src) {
      case "fwip":
        out.furnitureWip.push({
          noFurnitureWip: r.Ref1,
          ...base,
        });
        break;

      case "material":
        out.cabinetMaterial.push({
          idCabinetMaterial: r.Ref1, // string cast (konsisten)
          jumlah: r.Pcs ?? null, // jumlah disimpan ke jumlah
          berat: r.Berat ?? null,
          ...base,
        });
        break;
    }
  }

  // PARTIALS (merge into furnitureWip bucket)
  for (const p of fwipPartial) {
    out.furnitureWip.push({
      noFurnitureWipPartial: p.NoFurnitureWIPPartial, // wajib
      noFurnitureWip: p.NoFurnitureWIP ?? null, // header
      pcs: p.PcsPartial ?? null, // pcs partial
      pcsHeader: p.PcsHeader ?? null, // optional
      idJenis: p.IdJenis ?? null,
      namaJenis: p.NamaJenis ?? null,
      namaUom: p.NamaUOM ?? null,
      isPartial: true,
      isPartialRow: true,
    });
  }

  out.summary.furnitureWip = out.furnitureWip.length;
  out.summary.cabinetMaterial = out.cabinetMaterial.length;

  return out;
}

async function fetchOutputs(noPacking) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noPacking);

  const q = `
    SELECT DISTINCT
      o.NoPacking,
      o.NoBJ,
      bj.IdBJ AS IdJenis,
      mbj.NamaBJ AS NamaJenis,
      ISNULL(bj.HasBeenPrinted, 0) AS HasBeenPrinted,
      bj.Pcs
    FROM dbo.PackingProduksiOutputLabelBJ o WITH (NOLOCK)
    INNER JOIN dbo.BarangJadi bj WITH (NOLOCK)
      ON bj.NoBJ = o.NoBJ
    LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
      ON mbj.IdBJ = bj.IdBJ
    WHERE o.NoPacking = @no
    ORDER BY o.NoBJ DESC;
  `;

  const rs = await req.query(q);
  const rows = rs.recordset || [];
  return rows.map((r) => ({
    NoPacking: r.NoPacking,
    NoBJ: r.NoBJ,
    IdJenis: r.IdJenis ?? null,
    NamaJenis: r.NamaJenis ?? null,
    HasBeenPrinted: r.HasBeenPrinted ?? 0,
    Pcs: r.Pcs ?? null,
  }));
}

/**
 * Payload shape (arrays optional):
 * {
 *   furnitureWip:           [{ noFurnitureWip }],
 *   cabinetMaterial:        [{ idCabinetMaterial, jumlah }],
 *   furnitureWipPartialNew: [{ noFurnitureWip, pcs }]
 * }
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
    "packingProduksi",
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
    "packingProduksi",
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
  const outputJenisId = Number(payload?.outputJenisId);
  if (!hourStart) throw badReq("hourStart wajib diisi");
  if (!Number.isInteger(outputJenisId) || outputJenisId <= 0) {
    throw badReq("outputJenisId wajib integer positif");
  }

  const toSeconds = (hhmmss) => {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      String(hhmmss || "").trim(),
    );
    if (!match) return null;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    const ss = Number(match[3] || "0");
    if (hh > 23 || mm > 59 || ss > 59) return null;
    return hh * 3600 + mm * 60 + ss;
  };
  const normalizeTimeValue = (value) => {
    if (value == null) return null;
    if (value instanceof Date) {
      const hh = String(value.getUTCHours()).padStart(2, "0");
      const mm = String(value.getUTCMinutes()).padStart(2, "0");
      const ss = String(value.getUTCSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    const raw = String(value).trim();
    const match = /(\d{2}):(\d{2}):(\d{2})/.exec(raw);
    return match ? `${match[1]}:${match[2]}:${match[3]}` : null;
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

    const srcRes = await new sql.Request(tx)
      .input("IdMesin", sql.Int, idMesin)
      .input("Tanggal", sql.Date, tanggal).query(`
        SELECT TOP 1 *
        FROM dbo.PackingProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin
          AND CONVERT(date, Tanggal) = @Tanggal
        ORDER BY HourStart DESC, NoPacking DESC
      `);

    const src = srcRes.recordset?.[0];
    if (!src) {
      throw notFound(
        `Produksi packing tidak ditemukan untuk idMesin ${idMesin} dan tanggal ${tanggal}`,
      );
    }
    const sourceNo = String(src.NoPacking || "").trim();
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
        SELECT TOP 1 NoPacking
        FROM dbo.PackingProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin
          AND CONVERT(date, Tanggal) = @Tanggal
          AND HourStart = CAST(@HourStart AS time(7))
          AND HourEnd = CAST(@HourEnd AS time(7))
        ORDER BY NoPacking DESC
      `);
    if (duplicateRes.recordset?.length) {
      const existingNo = duplicateRes.recordset[0].NoPacking;
      throw conflict(
        `Rentang waktu ${hourStart}-${hourEnd} sudah ada pada produksi ${existingNo}.`,
      );
    }

    const docDateOnly = toDateOnly(src.Tanggal);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: `split time Packing ${sourceNo}`,
      useLock: true,
    });

    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.PackingProduksi_h",
        columnName: "NoPacking",
        prefix: "BD.",
        width: 10,
      });

    let newNoPacking = await gen();
    const exists = await new sql.Request(tx)
      .input("NoPacking", sql.VarChar(50), newNoPacking)
      .query(`
        SELECT 1 FROM dbo.PackingProduksi_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoPacking = @NoPacking
      `);
    if (exists.recordset.length > 0) {
      const retry = await gen();
      const exists2 = await new sql.Request(tx)
        .input("NoPacking", sql.VarChar(50), retry)
        .query(`
          SELECT 1 FROM dbo.PackingProduksi_h WITH (UPDLOCK, HOLDLOCK)
          WHERE NoPacking = @NoPacking
        `);
      if (exists2.recordset.length > 0) {
        throw conflict("Gagal generate NoPacking unik, coba lagi.");
      }
      newNoPacking = retry;
    }

    const insReq = new sql.Request(tx);
    insReq
      .input("NewNoPacking", sql.VarChar(50), newNoPacking)
      .input("SourceNoPacking", sql.VarChar(50), sourceNo)
      .input("NewHourStart", sql.VarChar(20), hourStart)
      .input("NewHourEnd", sql.VarChar(20), hourEnd)
      .input("OutputJenisId", sql.Int, outputJenisId);

    const insertRes = await insReq.query(`
      DECLARE @out TABLE (
        NoPacking varchar(50),
        Tanggal date,
        IdMesin int,
        IdOperator int,
        OutputJenisId int,
        IdRegu int,
        Shift int,
        JamKerja int,
        CreateBy varchar(100),
        CheckBy1 varchar(100),
        CheckBy2 varchar(100),
        ApproveBy varchar(100),
        HourMeter decimal(18,2),
        HourStart time(7),
        HourEnd time(7)
      );

      INSERT INTO dbo.PackingProduksi_h (
        NoPacking, Tanggal, IdMesin, IdOperator, OutputJenisId, IdRegu,
        Shift, JamKerja, CreateBy, CheckBy1, CheckBy2, ApproveBy,
        HourMeter, HourStart, HourEnd
      )
      OUTPUT
        INSERTED.NoPacking, INSERTED.Tanggal, INSERTED.IdMesin, INSERTED.IdOperator,
        INSERTED.OutputJenisId, INSERTED.IdRegu, INSERTED.Shift, INSERTED.JamKerja,
        INSERTED.CreateBy, INSERTED.CheckBy1, INSERTED.CheckBy2, INSERTED.ApproveBy,
        INSERTED.HourMeter, INSERTED.HourStart, INSERTED.HourEnd
      INTO @out
      SELECT
        @NewNoPacking,
        h.Tanggal,
        h.IdMesin,
        h.IdOperator,
        @OutputJenisId,
        h.IdRegu,
        h.Shift,
        h.JamKerja,
        h.CreateBy,
        h.CheckBy1,
        h.CheckBy2,
        h.ApproveBy,
        h.HourMeter,
        CAST(@NewHourStart AS time(7)),
        CAST(@NewHourEnd AS time(7))
      FROM dbo.PackingProduksi_h h WITH (UPDLOCK, HOLDLOCK)
      WHERE h.NoPacking = @SourceNoPacking;

      SELECT
        o.*,
        bj.NamaBJ AS OutputJenisNama
      FROM @out o
      LEFT JOIN dbo.MstBarangJadi bj WITH (NOLOCK)
        ON bj.IdBJ = o.OutputJenisId;
    `);

    await new sql.Request(tx)
      .input("SourceNoPacking", sql.VarChar(50), sourceNo)
      .input("NewHourStart", sql.VarChar(20), hourStart)
      .query(`
        UPDATE dbo.PackingProduksi_h
        SET HourEnd = CAST(@NewHourStart AS time(7))
        WHERE NoPacking = @SourceNoPacking
      `);

    await new sql.Request(tx)
      .input("SourceNoPacking", sql.VarChar(50), sourceNo)
      .input("NewNoPacking", sql.VarChar(50), newNoPacking)
      .query(`
        INSERT INTO dbo.PackingProduksiOperator_d (NoPacking, IdOperator)
        SELECT @NewNoPacking, od.IdOperator
        FROM dbo.PackingProduksiOperator_d od
        WHERE od.NoPacking = @SourceNoPacking;
      `);

    const opRes = await new sql.Request(tx)
      .input("NoPacking", sql.VarChar(50), newNoPacking)
      .query(`
        SELECT IdOperator
        FROM dbo.PackingProduksiOperator_d
        WHERE NoPacking = @NoPacking
        ORDER BY IdOperator;
      `);
    const idOperators = (opRes.recordset || [])
      .map((row) => Number(row.IdOperator))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.trunc(value));

    await tx.commit();
    return {
      idMesin,
      tanggal,
      sourceNoPacking: sourceNo,
      newNoPacking,
      sourceHourEndUpdatedTo: hourStart,
      newHourStart: hourStart,
      newHourEnd: hourEnd,
      header: {
        ...(insertRes.recordset?.[0] || {}),
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
  createPackingProduksi,
  updatePackingProduksi,
  deletePackingProduksi,
  fetchInputs,
  fetchOutputs,
  upsertInputsAndPartials,
  deleteInputsAndPartials,
  splitProduksiTime,
};
