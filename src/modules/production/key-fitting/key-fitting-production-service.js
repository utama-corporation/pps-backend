// services/key-fitting-production-service.js
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
const {
  parseJamToInt,
  calcJamKerjaFromStartEnd,
} = require("../../../core/utils/jam-kerja-helper");

// =====================================================
// GET ALL (paged + search)
// =====================================================
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
  const s = String(search || "").trim();

  const rqCount = pool.request();
  const rqData = pool.request();

  rqCount.input("search", sql.VarChar(50), s);
  rqCount.input("idMesin", sql.Int, idMesin);
  rqCount.input("tanggal", sql.Date, tanggal);
  rqCount.input("shift", sql.Int, shift);
  rqData.input("search", sql.VarChar(50), s);
  rqData.input("idMesin", sql.Int, idMesin);
  rqData.input("tanggal", sql.Date, tanggal);
  rqData.input("shift", sql.Int, shift);
  rqData.input("offset", sql.Int, offset);
  rqData.input("pageSize", sql.Int, ps);

  const qCount = `
    SELECT COUNT(1) AS Total
    FROM dbo.PasangKunci_h h WITH (NOLOCK)
    WHERE (@search = '' OR h.NoProduksi LIKE '%' + @search + '%')
      AND (@idMesin IS NULL OR h.IdMesin = @idMesin)
      AND (@tanggal IS NULL OR CONVERT(date, h.Tanggal) = @tanggal)
      AND (@shift IS NULL OR h.Shift = @shift);
  `;

  const qData = `
    ;WITH LastClosed AS (
      SELECT TOP 1
        CONVERT(date, PeriodHarian) AS LastClosedDate
      FROM dbo.MstTutupTransaksiHarian WITH (NOLOCK)
      WHERE [Lock] = 1
      ORDER BY CONVERT(date, PeriodHarian) DESC, Id DESC
    )
    SELECT
      h.NoProduksi,
      h.Tanggal,
      h.IdMesin,
      m.NamaMesin,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      cw.Nama AS OutputJenisNama,
      cw.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.PasangKunciOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op2.NamaOperator, ', ')
          FROM dbo.PasangKunciOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op2 WITH (NOLOCK)
            ON op2.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS NamaOperators,
      h.Shift,
      h.JamKerja,
      h.CreateBy,
      h.CheckBy1,
      h.CheckBy2,
      h.ApproveBy,
      h.HourMeter,
      CONVERT(VARCHAR(8), h.HourStart, 108) AS HourStart,
      CONVERT(VARCHAR(8), h.HourEnd,   108) AS HourEnd,
      lc.LastClosedDate,
      CASE
        WHEN lc.LastClosedDate IS NOT NULL
         AND CONVERT(date, h.Tanggal) <= lc.LastClosedDate
        THEN CAST(1 AS bit)
        ELSE CAST(0 AS bit)
      END AS IsLocked
    FROM dbo.PasangKunci_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstMesin m WITH (NOLOCK)
      ON h.IdMesin = m.IdMesin
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
      ON cw.IdCabinetWIP = h.OutputJenisId
    OUTER APPLY (SELECT TOP 1 LastClosedDate FROM LastClosed) lc
    WHERE (@search = '' OR h.NoProduksi LIKE '%' + @search + '%')
      AND (@idMesin IS NULL OR h.IdMesin = @idMesin)
      AND (@tanggal IS NULL OR CONVERT(date, h.Tanggal) = @tanggal)
      AND (@shift IS NULL OR h.Shift = @shift)
    ORDER BY h.Tanggal DESC, h.NoProduksi DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `;

  const countRes = await rqCount.query(qCount);
  const total = countRes.recordset?.[0]?.Total ?? 0;

  const dataRes = await rqData.query(qData);
  const data = (dataRes.recordset || []).map((row) => ({
    ...row,
    IdOperators:
      typeof row.IdOperators === "string"
        ? JSON.parse(row.IdOperators).map((x) => x.value)
        : (row.IdOperators ?? []),
  }));

  return { data, total };
}

// =====================================================
// GET BY DATE
// =====================================================
async function getProductionByDate(date) {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    ;WITH LastClosed AS (
      SELECT TOP 1
        CONVERT(date, PeriodHarian) AS LastClosedDate
      FROM dbo.MstTutupTransaksiHarian WITH (NOLOCK)
      WHERE [Lock] = 1
      ORDER BY CONVERT(date, PeriodHarian) DESC, Id DESC
    )
    SELECT
      h.NoProduksi,
      h.Tanggal,
      h.IdMesin,
      m.NamaMesin,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      cw.Nama AS OutputJenisNama,
      cw.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.PasangKunciOperator_d od WITH (NOLOCK)
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
          FROM dbo.PasangKunciOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS NamaOperators,
      h.Shift,
      h.JamKerja,
      h.CreateBy,
      h.CheckBy1,
      h.CheckBy2,
      h.ApproveBy,
      h.HourMeter,
      CONVERT(VARCHAR(8), h.HourStart, 108) AS HourStart,
      CONVERT(VARCHAR(8), h.HourEnd,   108) AS HourEnd,
      lc.LastClosedDate,
      CASE
        WHEN lc.LastClosedDate IS NOT NULL
         AND CONVERT(date, h.Tanggal) <= lc.LastClosedDate
        THEN CAST(1 AS bit)
        ELSE CAST(0 AS bit)
      END AS IsLocked
    FROM dbo.PasangKunci_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstMesin m WITH (NOLOCK)
      ON h.IdMesin = m.IdMesin
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
      ON cw.IdCabinetWIP = h.OutputJenisId
    OUTER APPLY (SELECT TOP 1 LastClosedDate FROM LastClosed) lc
    WHERE CONVERT(date, h.Tanggal) = @date
    ORDER BY h.JamKerja ASC;
  `;

  request.input("date", sql.Date, date);
  const result = await request.query(query);
  return (result.recordset || []).map((row) => ({
    ...row,
    IdOperators:
      typeof row.IdOperators === "string"
        ? JSON.parse(row.IdOperators).map((x) => x.value)
        : (row.IdOperators ?? []),
  }));
}

// =====================================================
// CREATE PasangKunci_h
// =====================================================
async function createKeyFittingProduksi(payload, ctx) {
  const body = payload && typeof payload === "object" ? payload : {};
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

  // ===============================
  // Validasi wajib
  // ===============================
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
    // Lock tanggal produksi
    // ===============================
    const effectiveDate = resolveEffectiveDateForCreate(body.tglProduksi);
    await assertNotLocked({
      date: effectiveDate,
      runner: tx,
      action: "create PasangKunci",
      useLock: true,
    });

    // ===============================
    // Generate NoProduksi unik
    // ===============================
    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.PasangKunci_h",
        columnName: "NoProduksi",
        prefix: "BI.",
        width: 10,
      });

    let noProduksi = await gen();

    // double check anti-race
    const exist = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      noProduksi,
    ).query(`
        SELECT 1
        FROM dbo.PasangKunci_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoProduksi = @NoProduksi
      `);

    if (exist.recordset.length > 0) {
      noProduksi = await gen();
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
    // Insert header dengan OUTPUT
    // ===============================
    const rqIns = new sql.Request(tx);
    rqIns
      .input("NoProduksi", sql.VarChar(50), noProduksi)
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
        NoProduksi varchar(50), Tanggal date, IdMesin int,
        Shift int, JamKerja int, CreateBy varchar(100),
        CheckBy1 varchar(100), CheckBy2 varchar(100), ApproveBy varchar(100),
        HourMeter decimal(18,2), HourStart time(7), HourEnd time(7),
        OutputJenisId int, IdRegu int
      );

      INSERT INTO dbo.PasangKunci_h (
        NoProduksi, Tanggal, IdMesin, OutputJenisId, IdRegu, Shift, JamKerja,
        CreateBy, CheckBy1, CheckBy2, ApproveBy,
        HourMeter, HourStart, HourEnd
      )
      OUTPUT
        INSERTED.NoProduksi,
        INSERTED.Tanggal,
        INSERTED.IdMesin,
        INSERTED.Shift,
        INSERTED.JamKerja,
        INSERTED.CreateBy,
        INSERTED.CheckBy1,
        INSERTED.CheckBy2,
        INSERTED.ApproveBy,
        INSERTED.HourMeter,
        INSERTED.HourStart,
        INSERTED.HourEnd,
        INSERTED.OutputJenisId,
        INSERTED.IdRegu
      INTO @tmp
      VALUES (
        @NoProduksi, @Tanggal, @IdMesin, @OutputJenisId, @IdRegu, @Shift, @JamKerja,
        @CreateBy, @CheckBy1, @CheckBy2, @ApproveBy, @HourMeter,
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
        INSERT INTO dbo.PasangKunciOperator_d (NoProduksi, IdOperator)
        VALUES ${opValues.join(", ")};
      `);
    }

    await tx.commit();
    return {
      header: {
        ...(insRes.recordset?.[0] || null),
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

// =====================================================
// UPDATE PasangKunci_h (dynamic) + sync DateUsage jika Tanggal berubah
// =====================================================
async function updateKeyFittingProduksi(noProduksi, payload, ctx) {
  if (!noProduksi) throw badReq("noProduksi wajib");

  const body = payload && typeof payload === "object" ? payload : {};

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
    // Lock header + ambil tanggal lama
    // ===============================
    const { docDateOnly: oldDocDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "keyFitting",
      codeValue: noProduksi,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });

    // ===============================
    // Handle perubahan tanggal
    // ===============================
    const isChangingDate = body.tglProduksi !== undefined;
    let newDocDateOnly = null;

    if (isChangingDate) {
      if (!body.tglProduksi) throw badReq("tglProduksi tidak boleh kosong");
      newDocDateOnly = resolveEffectiveDateForCreate(body.tglProduksi);
    }

    // ===============================
    // Guard tutup transaksi
    // ===============================
    await assertNotLocked({
      date: oldDocDateOnly,
      runner: tx,
      action: "update PasangKunci (current date)",
      useLock: true,
    });

    if (isChangingDate) {
      await assertNotLocked({
        date: newDocDateOnly,
        runner: tx,
        action: "update PasangKunci (new date)",
        useLock: true,
      });
    }

    // ===============================
    // Build dynamic SET
    // ===============================
    const sets = [];
    const rqUpd = new sql.Request(tx);

    if (isChangingDate) {
      sets.push("Tanggal = @Tanggal");
      rqUpd.input("Tanggal", sql.Date, newDocDateOnly);
    }

    if (body.idMesin !== undefined) {
      sets.push("IdMesin = @IdMesin");
      rqUpd.input("IdMesin", sql.Int, body.idMesin);
    }

    if (body.shift !== undefined) {
      sets.push("Shift = @Shift");
      rqUpd.input("Shift", sql.Int, body.shift);
    }

    if (body.outputJenisId !== undefined) {
      sets.push("OutputJenisId = @OutputJenisId");
      rqUpd.input("OutputJenisId", sql.Int, body.outputJenisId ?? null);
    }

    if (body.idRegu !== undefined) {
      sets.push("IdRegu = @IdRegu");
      rqUpd.input("IdRegu", sql.Int, body.idRegu ?? null);
    }

    if (body.jamKerja !== undefined) {
      const jamKerjaInt =
        body.jamKerja === null ? null : parseJamToInt(body.jamKerja);
      sets.push("JamKerja = @JamKerja");
      rqUpd.input("JamKerja", sql.Int, jamKerjaInt);
    }

    if (body.checkBy1 !== undefined) {
      sets.push("CheckBy1 = @CheckBy1");
      rqUpd.input("CheckBy1", sql.VarChar(100), body.checkBy1 ?? null);
    }

    if (body.checkBy2 !== undefined) {
      sets.push("CheckBy2 = @CheckBy2");
      rqUpd.input("CheckBy2", sql.VarChar(100), body.checkBy2 ?? null);
    }

    if (body.approveBy !== undefined) {
      sets.push("ApproveBy = @ApproveBy");
      rqUpd.input("ApproveBy", sql.VarChar(100), body.approveBy ?? null);
    }

    if (body.hourMeter !== undefined) {
      sets.push("HourMeter = @HourMeter");
      rqUpd.input("HourMeter", sql.Decimal(18, 2), body.hourMeter ?? null);
    }

    if (body.hourStart !== undefined) {
      sets.push(`
        HourStart =
          CASE WHEN @HourStart IS NULL OR LTRIM(RTRIM(@HourStart)) = ''
               THEN NULL ELSE CAST(@HourStart AS time(7)) END
      `);
      rqUpd.input("HourStart", sql.VarChar(20), body.hourStart ?? null);
    }

    if (body.hourEnd !== undefined) {
      sets.push(`
        HourEnd =
          CASE WHEN @HourEnd IS NULL OR LTRIM(RTRIM(@HourEnd)) = ''
               THEN NULL ELSE CAST(@HourEnd AS time(7)) END
      `);
      rqUpd.input("HourEnd", sql.VarChar(20), body.hourEnd ?? null);
    }

    if (sets.length === 0) throw badReq("No fields to update");

    rqUpd.input("NoProduksi", sql.VarChar(50), noProduksi);

    const updateSql = `
      UPDATE dbo.PasangKunci_h
      SET ${sets.join(", ")}
      WHERE NoProduksi = @NoProduksi;

      SELECT *
      FROM dbo.PasangKunci_h
      WHERE NoProduksi = @NoProduksi;
    `;

    const updRes = await rqUpd.query(updateSql);
    let updatedHeader = updRes.recordset?.[0] || null;

    if (body.idOperators !== undefined) {
      const operatorIds = [
        ...new Set(
          (Array.isArray(body.idOperators) ? body.idOperators : [])
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n) && n > 0)
            .map((n) => Math.trunc(n)),
        ),
      ];

      await new sql.Request(tx).input("NoProduksi", sql.VarChar(50), noProduksi)
        .query(`
          DELETE FROM dbo.PasangKunciOperator_d
          WHERE NoProduksi = @NoProduksi;
        `);

      if (operatorIds.length > 0) {
        const rqOp = new sql.Request(tx);
        rqOp.input("NoProduksi", sql.VarChar(50), noProduksi);
        const opValues = operatorIds.map((opId, i) => {
          const p = `DetailOp${i}`;
          rqOp.input(p, sql.Int, opId);
          return `(@NoProduksi, @${p})`;
        });
        await rqOp.query(`
          INSERT INTO dbo.PasangKunciOperator_d (NoProduksi, IdOperator)
          VALUES ${opValues.join(", ")};
        `);
      }

      updatedHeader = {
        ...updatedHeader,
        IdOperators: operatorIds,
      };
    }

    // ===============================
    // Sync DateUsage jika tanggal berubah
    // ===============================
    if (isChangingDate && updatedHeader) {
      const usageDate = resolveEffectiveDateForCreate(updatedHeader.Tanggal);

      const rqUsage = new sql.Request(tx);
      rqUsage
        .input("NoProduksi", sql.VarChar(50), noProduksi)
        .input("Tanggal", sql.Date, usageDate);

      await rqUsage.query(`
        UPDATE fw
        SET fw.DateUsage = @Tanggal
        FROM dbo.FurnitureWIP fw
        WHERE fw.DateUsage IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM dbo.PasangKunciInputLabelFWIP map
            WHERE map.NoProduksi = @NoProduksi
              AND map.NoFurnitureWIP = fw.NoFurnitureWIP
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

// =====================================================
// DELETE PasangKunci (cek output dulu) + reset DateUsage
// =====================================================
async function deleteKeyFittingProduksi(noProduksi, ctx) {
  if (!noProduksi) throw badReq("noProduksi wajib");

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
      entityKey: "keyFitting",
      codeValue: noProduksi,
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
      action: "delete PasangKunci",
      useLock: true,
    });

    // ===============================
    // 2) CEK OUTPUT FWIP / REJECT
    // ===============================
    const rqOut = new sql.Request(tx);
    const outRes = await rqOut.input("NoProduksi", sql.VarChar(50), noProduksi)
      .query(`
        SELECT
          SUM(CASE WHEN Src = 'FWIP'   THEN Cnt ELSE 0 END) AS CntOutputFWIP,
          SUM(CASE WHEN Src = 'REJECT' THEN Cnt ELSE 0 END) AS CntOutputReject
        FROM (
          SELECT 'FWIP' AS Src, COUNT(1) AS Cnt
          FROM dbo.PasangKunciOutputLabelFWIP WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
          UNION ALL
          SELECT 'REJECT' AS Src, COUNT(1) AS Cnt
          FROM dbo.PasangKunciOutputRejectV2 WITH (NOLOCK)
          WHERE NoProduksi = @NoProduksi
        ) X;
      `);

    const row = outRes.recordset?.[0] || {
      CntOutputFWIP: 0,
      CntOutputReject: 0,
    };

    if ((row.CntOutputFWIP || 0) > 0 || (row.CntOutputReject || 0) > 0) {
      throw badReq(
        "Tidak dapat menghapus Nomor Produksi ini karena sudah memiliki data output.",
      );
    }

    // ===============================
    // 3) DELETE INPUT + RESET DATEUSAGE + DELETE HEADER
    // ===============================
    const rqDel = new sql.Request(tx);
    rqDel.input("NoProduksi", sql.VarChar(50), noProduksi);

    // apply audit context sebelum eksekusi
    await applyAuditContext(rqDel, auditCtx);

    const sqlDelete = `
      DECLARE @FWIPKeys TABLE (NoFurnitureWIP varchar(50) PRIMARY KEY);

      -- keys FULL
      INSERT INTO @FWIPKeys (NoFurnitureWIP)
      SELECT DISTINCT map.NoFurnitureWIP
      FROM dbo.PasangKunciInputLabelFWIP AS map
      WHERE map.NoProduksi = @NoProduksi
        AND map.NoFurnitureWIP IS NOT NULL;

      -- keys PARTIAL
      INSERT INTO @FWIPKeys (NoFurnitureWIP)
      SELECT DISTINCT fwp.NoFurnitureWIP
      FROM dbo.PasangKunciInputLabelFWIPPartial AS mp
      JOIN dbo.FurnitureWIPPartial AS fwp
        ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
      WHERE mp.NoProduksi = @NoProduksi
        AND fwp.NoFurnitureWIP IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM @FWIPKeys k WHERE k.NoFurnitureWIP = fwp.NoFurnitureWIP
        );

      DELETE FROM dbo.PasangKunciInputMaterial WHERE NoProduksi = @NoProduksi;

      DELETE fwp
      FROM dbo.FurnitureWIPPartial AS fwp
      JOIN dbo.PasangKunciInputLabelFWIPPartial AS mp
        ON mp.NoFurnitureWIPPartial = fwp.NoFurnitureWIPPartial
      WHERE mp.NoProduksi = @NoProduksi;

      DELETE FROM dbo.PasangKunciInputLabelFWIPPartial WHERE NoProduksi = @NoProduksi;
      DELETE FROM dbo.PasangKunciInputLabelFWIP WHERE NoProduksi = @NoProduksi;

      UPDATE fw
      SET fw.DateUsage = NULL,
          fw.IsPartial = CASE
            WHEN EXISTS (
              SELECT 1 FROM dbo.FurnitureWIPPartial p
              WHERE p.NoFurnitureWIP = fw.NoFurnitureWIP
            )
            THEN 1 ELSE 0 END
      FROM dbo.FurnitureWIP AS fw
      JOIN @FWIPKeys AS k
        ON k.NoFurnitureWIP = fw.NoFurnitureWIP;

      DELETE FROM dbo.PasangKunci_h WHERE NoProduksi = @NoProduksi;
    `;

    await rqDel.query(sqlDelete);
    await tx.commit();

    return { success: true, audit: auditCtx };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}

    // attach audit context agar controller tetap bisa kirim meta.audit
    throw Object.assign(e, auditCtx);
  }
}

async function fetchInputs(noProduksi) {
  const pool = await poolPromise;
  const req = pool.request();
  req.input("no", sql.VarChar(50), noProduksi);

  const q = `
    /* ===================== [1] MAIN INPUTS (UNION) ===================== */

    -- FurnitureWIP FULL (BB...)
    SELECT
      'fwip' AS Src,
      map.NoProduksi,
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
    FROM dbo.PasangKunciInputLabelFWIP map WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = map.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mw WITH (NOLOCK)
      ON mw.IdCabinetWIP = fw.IDFurnitureWIP
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mw.IdUOM
    WHERE map.NoProduksi = @no

    UNION ALL

    -- Cabinet Material
    SELECT
      'material' AS Src,
      im.NoProduksi,
      CAST(im.IdCabinetMaterial AS varchar(50)) AS Ref1,
      CAST(NULL AS varchar(50)) AS Ref2,
      CAST(NULL AS varchar(50)) AS Ref3,

      CAST(NULL AS decimal(18,3)) AS Berat,
      CAST(im.Jumlah AS int)      AS Pcs,
      CAST(NULL AS bit)           AS IsPartial,
      CAST(NULL AS int)           AS IdJenis,
      mm.Nama                     AS NamaJenis,
      uom.NamaUOM                 AS NamaUOM,
      CAST(NULL AS datetime) AS DatetimeInput
    FROM dbo.PasangKunciInputMaterial im WITH (NOLOCK)
    LEFT JOIN dbo.MstCabinetMaterial mm WITH (NOLOCK)
      ON mm.IdCabinetMaterial = im.IdCabinetMaterial
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mm.IdUOM
    WHERE im.NoProduksi = @no

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
    FROM dbo.PasangKunciInputLabelFWIPPartial mp WITH (NOLOCK)
    LEFT JOIN dbo.FurnitureWIPPartial fwp WITH (NOLOCK)
      ON fwp.NoFurnitureWIPPartial = mp.NoFurnitureWIPPartial
    LEFT JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = fwp.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP mw WITH (NOLOCK)
      ON mw.IdCabinetWIP = fw.IDFurnitureWIP
    LEFT JOIN dbo.MstUOM uom WITH (NOLOCK)
      ON uom.IdUOM = mw.IdUOM
    WHERE mp.NoProduksi = @no
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

  // MAIN (seperti gilingan: base object)
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
        out.furnitureWip.push({ noFurnitureWip: r.Ref1, ...base });
        break;

      case "material":
        out.cabinetMaterial.push({
          idCabinetMaterial: r.Ref1, // string cast
          jumlah: r.Pcs ?? null,
          berat: r.Berat ?? null,
          ...base,
        });
        break;
    }
  }

  // PARTIALS (merge into SAME bucket seperti gilingan broker/reject)
  for (const p of fwipPartial) {
    out.furnitureWip.push({
      noFurnitureWipPartial: p.NoFurnitureWIPPartial, // ✅ nomor partial wajib ada
      noFurnitureWip: p.NoFurnitureWIP ?? null, // header
      pcs: p.PcsPartial ?? null, // pcs partial
      pcsHeader: p.PcsHeader ?? null, // opsional
      idJenis: p.IdJenis ?? null,
      namaJenis: p.NamaJenis ?? null,
      namaUom: p.NamaUOM ?? null,
      isPartial: true, // optional marker
      isPartialRow: true, // optional marker (mirip VM kamu)
    });
  }

  // Summary
  out.summary.furnitureWip = out.furnitureWip.length;
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
      fw.Pcs
    FROM dbo.PasangKunciOutputLabelFWIP o WITH (NOLOCK)
    INNER JOIN dbo.FurnitureWIP fw WITH (NOLOCK)
      ON fw.NoFurnitureWIP = o.NoFurnitureWIP
    LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
      ON cw.IdCabinetWIP = fw.IDFurnitureWIP
    WHERE o.NoProduksi = @no
    ORDER BY o.NoFurnitureWIP DESC;
  `;

  const rs = await req.query(q);
  return (rs.recordset || []).map((r) => ({
    NoProduksi: r.NoProduksi,
    NoFurnitureWIP: r.NoFurnitureWIP,
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
    ;WITH RejectPartialAgg AS (
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
      END AS Berat
    FROM dbo.PasangKunciOutputRejectV2 o WITH (NOLOCK)
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
  return (rs.recordset || []).map((r) => ({
    NoProduksi: r.NoProduksi,
    NoReject: r.NoReject,
    IdJenis: r.IdJenis ?? null,
    NamaJenis: r.NamaJenis ?? null,
    HasBeenPrinted: r.HasBeenPrinted ?? 0,
    Berat: r.Berat ?? null,
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
  return sharedInputService.upsertInputsAndPartials("keyFitting", no, body, {
    actorId: Math.trunc(actorIdNum),
    actorUsername,
    requestId,
  });
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
  return sharedInputService.deleteInputsAndPartials("keyFitting", no, body, {
    actorId: Math.trunc(actorIdNum),
    actorUsername,
    requestId,
  });
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

    const srcRes = await new sql.Request(tx)
      .input("IdMesin", sql.Int, idMesin)
      .input("Tanggal", sql.Date, tanggal).query(`
        SELECT TOP 1 *
        FROM dbo.PasangKunci_h WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin
          AND CONVERT(date, Tanggal) = @Tanggal
        ORDER BY HourStart DESC, NoProduksi DESC
      `);

    const src = srcRes.recordset?.[0];
    if (!src) {
      throw notFound(
        `Produksi key fitting tidak ditemukan untuk idMesin ${idMesin} dan tanggal ${tanggal}`,
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
        FROM dbo.PasangKunci_h WITH (UPDLOCK, HOLDLOCK)
        WHERE IdMesin = @IdMesin
          AND CONVERT(date, Tanggal) = @Tanggal
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

    const docDateOnly = toDateOnly(src.Tanggal);
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: `split time PasangKunci ${sourceNo}`,
      useLock: true,
    });

    const gen = async () =>
      generateNextCode(tx, {
        tableName: "dbo.PasangKunci_h",
        columnName: "NoProduksi",
        prefix: "BI.",
        width: 10,
      });

    let newNoProduksi = await gen();
    const exists = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      newNoProduksi,
    ).query(`
        SELECT 1 FROM dbo.PasangKunci_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoProduksi = @NoProduksi
      `);
    if (exists.recordset.length > 0) {
      const retry = await gen();
      const exists2 = await new sql.Request(tx).input(
        "NoProduksi",
        sql.VarChar(50),
        retry,
      ).query(`
          SELECT 1 FROM dbo.PasangKunci_h WITH (UPDLOCK, HOLDLOCK)
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
      .input("OutputJenisId", sql.Int, outputJenisId);

    const insertRes = await insReq.query(`
      DECLARE @out TABLE (
        NoProduksi varchar(50),
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

      INSERT INTO dbo.PasangKunci_h (
        NoProduksi, Tanggal, IdMesin, OutputJenisId, IdRegu,
        Shift, JamKerja, CreateBy, CheckBy1, CheckBy2, ApproveBy,
        HourMeter, HourStart, HourEnd
      )
      OUTPUT
        INSERTED.NoProduksi, INSERTED.Tanggal, INSERTED.IdMesin,
        INSERTED.OutputJenisId, INSERTED.IdRegu, INSERTED.Shift, INSERTED.JamKerja,
        INSERTED.CreateBy, INSERTED.CheckBy1, INSERTED.CheckBy2, INSERTED.ApproveBy,
        INSERTED.HourMeter, INSERTED.HourStart, INSERTED.HourEnd
      INTO @out
      SELECT
        @NewNoProduksi,
        h.Tanggal,
        h.IdMesin,
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
      FROM dbo.PasangKunci_h h WITH (UPDLOCK, HOLDLOCK)
      WHERE h.NoProduksi = @SourceNoProduksi;

      SELECT
        o.*,
        cw.Nama AS OutputJenisNama
      FROM @out o
      LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
        ON cw.IdCabinetWIP = o.OutputJenisId;
    `);

    await new sql.Request(tx)
      .input("SourceNoProduksi", sql.VarChar(50), sourceNo)
      .input("NewHourStart", sql.VarChar(20), hourStart).query(`
        UPDATE dbo.PasangKunci_h
        SET HourEnd = CAST(@NewHourStart AS time(7))
        WHERE NoProduksi = @SourceNoProduksi
      `);

    await new sql.Request(tx)
      .input("SourceNoProduksi", sql.VarChar(50), sourceNo)
      .input("NewNoProduksi", sql.VarChar(50), newNoProduksi).query(`
        INSERT INTO dbo.PasangKunciOperator_d (NoProduksi, IdOperator)
        SELECT @NewNoProduksi, od.IdOperator
        FROM dbo.PasangKunciOperator_d od
        WHERE od.NoProduksi = @SourceNoProduksi;
      `);

    const opRes = await new sql.Request(tx).input(
      "NoProduksi",
      sql.VarChar(50),
      newNoProduksi,
    ).query(`
        SELECT IdOperator
        FROM dbo.PasangKunciOperator_d
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
  getProductionByDate,
  createKeyFittingProduksi,
  updateKeyFittingProduksi,
  deleteKeyFittingProduksi,
  fetchInputs,
  fetchOutputs,
  fetchOutputsReject,
  upsertInputsAndPartials,
  deleteInputsAndPartials,
  splitProduksiTime,
};
