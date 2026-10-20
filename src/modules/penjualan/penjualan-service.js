const { sql, poolPromise } = require("../../core/config/db");
const { badReq, notFound, conflict } = require("../../core/utils/http-error");
const { scanLabel } = require("./handlers/scan-label.handler");
const { applyAuditContext } = require("../../core/utils/db-audit-context");
const {
  assertNotLocked,
  loadDocDateOnlyFromConfig,
} = require("../../core/shared/tutup-transaksi-guard");
const { PARTIAL_CONFIG } = require("../../core/shared/label-partial.helper");

// Kategori yang boleh dijual — sama dengan scan-label.category-registry.
const ITEM_CATEGORIES = {
  barangjadi: { table: "dbo.MstBarangJadi", column: "IdBJ" },
  furniturewip: { table: "dbo.MstCabinetWIP", column: "IdCabinetWIP" },
  barangdagang: { table: "dbo.MstBarangDagang", column: "IdBarangDagang" },
};

function normalizeLineInput(body) {
  const b = body && typeof body === "object" ? body : {};

  const kodeKategori = String(b.kodeKategori ?? "").trim().toLowerCase();
  if (!ITEM_CATEGORIES[kodeKategori]) {
    throw badReq(
      "kodeKategori tidak valid (harus furniturewip/barangjadi/barangdagang)",
    );
  }

  const idJenis = Number(b.idJenis);
  if (!Number.isInteger(idJenis) || idJenis <= 0) {
    throw badReq("idJenis harus angka > 0");
  }

  const pcs = Number(b.pcs);
  if (!Number.isInteger(pcs) || pcs <= 0) {
    throw badReq("pcs harus bilangan bulat > 0");
  }

  return { kodeKategori, idJenis, pcs };
}

// Header wajib ada dan belum complete agar line boleh diubah.
async function getEditableHeader(noBJJual) {
  const pool = await poolPromise;
  const res = await pool
    .request()
    .input("No", sql.VarChar(50), noBJJual)
    .query(
      `SELECT NoBJJual, IsComplete FROM dbo.BJJual_h WITH (UPDLOCK)
       WHERE NoBJJual = @No`,
    );

  const header = res.recordset?.[0];
  if (!header) throw notFound(`BJJual ${noBJJual} tidak ditemukan`);
  if (Number(header.IsComplete) === 1) {
    throw conflict("DO sudah complete, item tidak bisa diubah");
  }
  return header;
}

async function getLineScanPcs(noBJJual, kodeKategori, idJenis) {
  const pool = await poolPromise;
  const res = await pool
    .request()
    .input("NoBJJual", sql.VarChar(50), noBJJual)
    .input("KodeKategori", sql.VarChar(50), kodeKategori)
    .input("IdJenis", sql.Int, idJenis)
    .query(
      `SELECT ISNULL(SUM(Pcs), 0) AS PcsScanned
       FROM dbo.BJJualScanLabel_d WITH (NOLOCK)
       WHERE NoBJJual = @NoBJJual AND KodeKategori = @KodeKategori AND IdJenis = @IdJenis`,
    );
  return Number(res.recordset?.[0]?.PcsScanned ?? 0);
}

async function assertJenisExists(kodeKategori, idJenis) {
  const pool = await poolPromise;
  const { table, column } = ITEM_CATEGORIES[kodeKategori];
  const res = await pool
    .request()
    .input("IdJenis", sql.Int, idJenis)
    .query(`SELECT 1 AS Ok FROM ${table} WHERE ${column} = @IdJenis`);
  if (!res.recordset?.[0]) {
    throw badReq(
      `idJenis tidak ditemukan di master ${kodeKategori} (${idJenis})`,
    );
  }
}

async function addItem(noBJJual, body, ctx) {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");
  const line = normalizeLineInput(body);
  const createBy =
    String(ctx?.actorUsername || "").trim() || "system";

  await getEditableHeader(no);
  await assertJenisExists(line.kodeKategori, line.idJenis);

  const pool = await poolPromise;
  const dup = await pool
    .request()
    .input("NoBJJual", sql.VarChar(50), no)
    .input("KodeKategori", sql.VarChar(50), line.kodeKategori)
    .input("IdJenis", sql.Int, line.idJenis)
    .query(
      `SELECT 1 AS Ok FROM dbo.BJJualItem_d
       WHERE NoBJJual = @NoBJJual AND KodeKategori = @KodeKategori AND IdJenis = @IdJenis`,
    );
  if (dup.recordset?.[0]) {
    throw conflict(
      `Item sudah ada (${line.kodeKategori} / ${line.idJenis}) — ubah pcs-nya saja`,
    );
  }

  await pool
    .request()
    .input("NoBJJual", sql.VarChar(50), no)
    .input("KodeKategori", sql.VarChar(50), line.kodeKategori)
    .input("IdJenis", sql.Int, line.idJenis)
    .input("Pcs", sql.Int, line.pcs)
    .input("CreateBy", sql.VarChar(50), createBy)
    .query(
      `INSERT INTO dbo.BJJualItem_d (NoBJJual, KodeKategori, IdJenis, Pcs, CreateBy, DateTimeCreate)
       VALUES (@NoBJJual, @KodeKategori, @IdJenis, @Pcs, @CreateBy, GETDATE())`,
    );

  return { noBJJual: no, ...line };
}

async function updateItem(noBJJual, body) {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");
  const line = normalizeLineInput(body);

  await getEditableHeader(no);

  const scanned = await getLineScanPcs(no, line.kodeKategori, line.idJenis);
  if (scanned > 0) {
    throw conflict(
      "Baris sudah ada label yang discan — pcs tidak bisa diubah",
    );
  }

  const pool = await poolPromise;
  const res = await pool
    .request()
    .input("NoBJJual", sql.VarChar(50), no)
    .input("KodeKategori", sql.VarChar(50), line.kodeKategori)
    .input("IdJenis", sql.Int, line.idJenis)
    .input("Pcs", sql.Int, line.pcs)
    .query(
      `UPDATE dbo.BJJualItem_d SET Pcs = @Pcs
       WHERE NoBJJual = @NoBJJual AND KodeKategori = @KodeKategori AND IdJenis = @IdJenis`,
    );
  if (!res.rowsAffected?.[0]) {
    throw notFound(
      `Item tidak ditemukan (${line.kodeKategori} / ${line.idJenis})`,
    );
  }

  return { noBJJual: no, ...line };
}

async function deleteItem(noBJJual, query) {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");

  const b = query && typeof query === "object" ? query : {};
  const kodeKategori = String(b.kodeKategori ?? "").trim().toLowerCase();
  if (!ITEM_CATEGORIES[kodeKategori]) {
    throw badReq(
      "kodeKategori tidak valid (harus furniturewip/barangjadi/barangdagang)",
    );
  }
  const idJenis = Number(b.idJenis);
  if (!Number.isInteger(idJenis) || idJenis <= 0) {
    throw badReq("idJenis harus angka > 0");
  }

  await getEditableHeader(no);

  const scanned = await getLineScanPcs(no, kodeKategori, idJenis);
  if (scanned > 0) {
    throw conflict("Baris sudah ada label yang discan — tidak bisa dihapus");
  }

  const pool = await poolPromise;
  const res = await pool
    .request()
    .input("NoBJJual", sql.VarChar(50), no)
    .input("KodeKategori", sql.VarChar(50), kodeKategori)
    .input("IdJenis", sql.Int, idJenis)
    .query(
      `DELETE FROM dbo.BJJualItem_d
       WHERE NoBJJual = @NoBJJual AND KodeKategori = @KodeKategori AND IdJenis = @IdJenis`,
    );
  if (!res.rowsAffected?.[0]) {
    throw notFound(`Item tidak ditemukan (${kodeKategori} / ${idJenis})`);
  }

  return { noBJJual: no, kodeKategori, idJenis };
}

// Hapus seluruh DO beserta jejak scan-nya. Label yang pernah discan
// dikembalikan ke kondisi sebelum scan:
//  - baris partial yang dibuat scan (NoPartial) dihapus,
//  - parent.DateUsage di-NULL-kan bila setelah itu masih ada sisa pcs
//    (dan tidak ada DO lain yang memakai label itu secara penuh),
//  - parent.IsPartial di-reset ke 0 bila tidak ada partial tersisa.
async function deletePenjualan(noBJJual, ctx) {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");

  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const auditCtx = {
    actorId: Math.trunc(actorIdNum),
    actorUsername: String(ctx?.actorUsername || "").trim() || "system",
    requestId: String(ctx?.requestId || "").trim(),
  };

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    await applyAuditContext(new sql.Request(tx), auditCtx);

    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "bjJual",
      codeValue: no,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete BJJual",
      useLock: true,
    });

    const scansRes = await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .query(`
        SELECT Id, KodeKategori, NoLabel, NoPartial
        FROM dbo.BJJualScanLabel_d WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBJJual = @No
      `);
    const scans = scansRes.recordset || [];

    // 1) Hapus jejak scan, lalu item, lalu header (urutan sesuai FK).
    await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .query(`DELETE FROM dbo.BJJualScanLabel_d WHERE NoBJJual = @No`);

    // 2) Hapus partial yang dibuat scan ini.
    for (const s of scans) {
      const cfg = PARTIAL_CONFIG[s.KodeKategori];
      if (!cfg || !s.NoPartial) continue;
      await new sql.Request(tx)
        .input("Code", sql.VarChar(50), s.NoPartial)
        .query(
          `DELETE FROM dbo.${cfg.partialTable} WHERE ${cfg.partialColumn} = @Code`,
        );
    }

    // 3) Kembalikan parent: DateUsage NULL + IsPartial sesuai sisa partial.
    const seen = new Set();
    for (const s of scans) {
      const cfg = PARTIAL_CONFIG[s.KodeKategori];
      const key = `${s.KodeKategori}|${s.NoLabel}`;
      if (!cfg || seen.has(key)) continue;
      seen.add(key);

      const qtyCol = cfg.parentQtyColumn || "Pcs";
      const partialQtyCol = cfg.partialQtyColumn || "Pcs";
      await new sql.Request(tx)
        .input("NoLabel", sql.VarChar(50), s.NoLabel)
        .input("Kategori", sql.VarChar(20), s.KodeKategori)
        .query(`
          UPDATE p
          SET p.DateUsage = CASE
                WHEN p.DateUsage IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM dbo.BJJualScanLabel_d x
                   WHERE x.NoLabel = @NoLabel AND x.KodeKategori = @Kategori
                     AND x.NoPartial IS NULL)
                 AND p.${qtyCol} - ISNULL((
                   SELECT SUM(pt.${partialQtyCol}) FROM dbo.${cfg.partialTable} pt
                   WHERE pt.${cfg.partialParentColumn} = p.${cfg.parentColumn}), 0) > 0
                THEN NULL ELSE p.DateUsage END,
              p.IsPartial = CASE
                WHEN EXISTS (
                   SELECT 1 FROM dbo.${cfg.partialTable} pt
                   WHERE pt.${cfg.partialParentColumn} = p.${cfg.parentColumn})
                THEN p.IsPartial ELSE 0 END
          FROM dbo.${cfg.parentTable} p
          WHERE p.${cfg.parentColumn} = @NoLabel
        `);
    }

    await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .query(`DELETE FROM dbo.BJJualItem_d WHERE NoBJJual = @No`);
    await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .query(`DELETE FROM dbo.BJJual_h WHERE NoBJJual = @No`);

    await tx.commit();
    return {
      noBJJual: no,
      labelsReleased: seen.size,
      partialsDeleted: scans.filter((s) => s.NoPartial).length,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

async function getHeaders(
  page = 1,
  pageSize = 20,
  search = "",
  dateFrom = null,
  dateTo = null,
  status = "incomplete",
) {
  const pool = await poolPromise;

  const offset = (Math.max(page, 1) - 1) * Math.max(pageSize, 1);
  const s = String(search || "").trim();
  const st = ["incomplete", "complete", "all"].includes(status)
    ? status
    : "incomplete";

  const rqCount = pool.request();
  const rqData = pool.request();

  rqCount.input("search", sql.VarChar(50), s);
  rqData.input("search", sql.VarChar(50), s);

  rqCount.input("dateFrom", sql.Date, dateFrom);
  rqCount.input("dateTo", sql.Date, dateTo);
  rqData.input("dateFrom", sql.Date, dateFrom);
  rqData.input("dateTo", sql.Date, dateTo);

  rqData.input("offset", sql.Int, offset);
  rqData.input("pageSize", sql.Int, pageSize);

  const statusFilter =
    st === "incomplete"
      ? "AND h.IsComplete = 0"
      : st === "complete"
        ? "AND h.IsComplete = 1"
        : "";

  const qWhere = `
    WHERE 1 = 1
      ${statusFilter}
      AND (@search = '' OR h.NoBJJual LIKE '%' + @search + '%')
      AND (@dateFrom IS NULL OR CONVERT(date, h.Tanggal) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(date, h.Tanggal) <= @dateTo)
  `;

  const qCount = `
    SELECT COUNT(1) AS Total
    FROM dbo.BJJual_h h WITH (NOLOCK)
    ${qWhere};
  `;

  const qData = `
    SELECT
      h.NoBJJual,
      h.Tanggal,
      h.IdPembeli,
      p.NamaPembeli,
      h.Remark,
      h.InvoiceType,
      h.IsComplete,
      h.DateComplete,
      (SELECT COUNT(1) FROM dbo.BJJualItem_d d WITH (NOLOCK) WHERE d.NoBJJual = h.NoBJJual) AS TotalLines,
      (
        SELECT COUNT(1) FROM dbo.BJJualItem_d d WITH (NOLOCK)
        WHERE d.NoBJJual = h.NoBJJual
          AND ISNULL((
            SELECT SUM(s.Pcs) FROM dbo.BJJualScanLabel_d s WITH (NOLOCK)
            WHERE s.NoBJJual = d.NoBJJual AND s.KodeKategori = d.KodeKategori AND s.IdJenis = d.IdJenis
          ), 0) >= d.Pcs
      ) AS CompletedLines
    FROM dbo.BJJual_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstPembeli p WITH (NOLOCK)
      ON h.IdPembeli = p.IdPembeli
    ${qWhere}
    ORDER BY h.Tanggal DESC, h.NoBJJual DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `;

  const countRes = await rqCount.query(qCount);
  const total = countRes.recordset?.[0]?.Total ?? 0;

  const dataRes = await rqData.query(qData);
  const data = dataRes.recordset || [];

  return { data, total };
}

async function getHeaderDetail(noBJJual) {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");

  const pool = await poolPromise;

  const headerRes = await pool
    .request()
    .input("No", sql.VarChar(13), no).query(`
      SELECT h.NoBJJual, h.Tanggal, h.IdPembeli, p.NamaPembeli, h.Remark,
             h.InvoiceType, h.IsComplete, h.DateComplete
      FROM dbo.BJJual_h h WITH (NOLOCK)
      LEFT JOIN dbo.MstPembeli p WITH (NOLOCK) ON h.IdPembeli = p.IdPembeli
      WHERE h.NoBJJual = @No
    `);

  const header = headerRes.recordset?.[0];
  if (!header) throw notFound(`BJJual ${no} tidak ditemukan`);

  const linesRes = await pool
    .request()
    .input("No", sql.VarChar(13), no).query(`
      SELECT
        d.KodeKategori,
        d.IdJenis,
        CASE
          WHEN d.KodeKategori = 'furniturewip' THEN mw.Nama
          WHEN d.KodeKategori = 'barangjadi' THEN mbj.NamaBJ
          WHEN d.KodeKategori = 'barangdagang' THEN mbd.NamaBarangDagang
          ELSE NULL
        END AS NamaJenis,
        d.Pcs AS PcsRequired,
        ISNULL((
          SELECT SUM(s.Pcs) FROM dbo.BJJualScanLabel_d s WITH (NOLOCK)
          WHERE s.NoBJJual = d.NoBJJual AND s.KodeKategori = d.KodeKategori AND s.IdJenis = d.IdJenis
        ), 0) AS PcsScanned,
        d.DateTimeCreate
      FROM dbo.BJJualItem_d d WITH (NOLOCK)
      LEFT JOIN dbo.MstCabinetWIP mw WITH (NOLOCK)
        ON d.KodeKategori = 'furniturewip' AND mw.IdCabinetWIP = d.IdJenis
      LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
        ON d.KodeKategori = 'barangjadi' AND mbj.IdBJ = d.IdJenis
      LEFT JOIN dbo.MstBarangDagang mbd WITH (NOLOCK)
        ON d.KodeKategori = 'barangdagang' AND mbd.IdBarangDagang = d.IdJenis
      WHERE d.NoBJJual = @No
      ORDER BY d.KodeKategori, d.IdJenis
    `);

  const scansRes = await pool
    .request()
    .input("No", sql.VarChar(13), no).query(`
      SELECT Id, KodeKategori, IdJenis, NoLabel, NoPartial, Pcs, DateTimeScan
      FROM dbo.BJJualScanLabel_d WITH (NOLOCK)
      WHERE NoBJJual = @No
      ORDER BY DateTimeScan ASC, Id ASC
    `);

  const lines = (linesRes.recordset || []).map((r) => ({
    kodeKategori: r.KodeKategori,
    idJenis: r.IdJenis,
    namaJenis: r.NamaJenis,
    pcsRequired: r.PcsRequired,
    pcsScanned: r.PcsScanned,
    isComplete: r.PcsScanned >= r.PcsRequired,
    dateTimeCreate: r.DateTimeCreate,
    scans: (scansRes.recordset || [])
      .filter(
        (s) => s.KodeKategori === r.KodeKategori && s.IdJenis === r.IdJenis,
      )
      .map((s) => ({
        id: s.Id,
        noLabel: s.NoLabel,
        noPartial: s.NoPartial ?? null,
        pcs: s.Pcs,
        dateTimeScan: s.DateTimeScan,
      })),
  }));

  return { header, lines };
}

module.exports = {
  getHeaders,
  getHeaderDetail,
  scanLabel,
  addItem,
  updateItem,
  deleteItem,
  deletePenjualan,
};
