// src/modules/retur-beli/retur-beli-service.js
/* ============================================================
 * Retur Beli: retur barang ke SUPPLIER (kebalikan Retur v3 yang menerima
 * retur dari pembeli). Tahap 1: label Bahan Pendukung.
 *
 * Interface (routes/controller/service) mengikuti konvensi retur-v3:
 *   getAllRetur, getDetail, createHeader, updateHeader, deleteHeader,
 *   addItems, updateItem, deleteItem, decide, getOutputs, scanLabelAuto,
 *   undoScan, getTurnover, markComplete.
 * Nama dokumen tetap NoReturBeli (prefix RB.), tapi parameter route/controller
 * memakai `noRetur` seperti retur-v3.
 *
 * Alur:
 *  1. Buat header (tanggal, supplier, keterangan) -> Status OPEN.
 *  2. Tambah item (bisa batch) = label bahan pendukung + qty (boleh sebagian).
 *     Stok label LANGSUNG berkurang dicatat di dbo.BahanPendukungKonsumsi_d
 *     (NoProduksi = NoReturBeli), sama dengan konsumsi produksi.
 *  3. decide(): tetapkan Penyelesaian (DIGANTI/POTONG_TAGIHAN) — wewenang
 *     terpisah (returbeli:decide), status masih OPEN.
 *  4. markComplete(): kunci dokumen -> Status SELESAI.
 *
 * Hapus item / undo scan / hapus dokumen mengembalikan Qty persis dari log.
 *Supplier label wajib sama dengan supplier header. Semua tulis dijaga periode
 * tutup transaksi (tanggal dokumen).
 * ==========================================================*/

const { sql, poolPromise } = require("../../core/config/db");
const {
  resolveEffectiveDateForCreate,
  assertNotLocked,
  loadDocDateOnlyFromTable,
  formatYMD,
} = require("../../core/shared/tutup-transaksi-guard");
const { badReq, conflict, notFound } = require("../../core/utils/http-error");
const { applyAuditContext } = require("../../core/utils/db-audit-context");
const { generateNextCode } = require("../../core/utils/sequence-code-helper");

const PREFIX = "RB.";
const PENYELESAIAN = ["DIGANTI", "POTONG_TAGIHAN"];
const MAX_KETERANGAN = 500;
const MAX_REMARK = 255;
const QTY_SCALE = 3; // decimal(18,3), sama dengan BahanPendukung.Qty

/**
 * Kolom "paritas retur-v3" (IsComplete / DecisionBy / DecisionAt) ditambahkan
 * lewat migrasi terpisah. Cek keberadaannya sekali saat proses start supaya
 * service tetap jalan di database yang belum ter-migrasi, tanpa mengubah
 * kontrak response (kolom tetap dikembalikan dengan nilai default).
 */
let _v3ColumnsPromise;
async function v3Columns() {
  if (!_v3ColumnsPromise) {
    _v3ColumnsPromise = (async () => {
      const pool = await poolPromise;
      const r = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.ReturBeli_h','IsComplete') IS NOT NULL THEN 1 ELSE 0 END AS HasIsComplete,
          CASE WHEN COL_LENGTH('dbo.ReturBeli_h','DecisionBy') IS NOT NULL THEN 1 ELSE 0 END AS HasDecisionBy,
          CASE WHEN COL_LENGTH('dbo.ReturBeli_h','DecisionAt') IS NOT NULL THEN 1 ELSE 0 END AS HasDecisionAt`);
      const row = r.recordset?.[0] || {};
      return {
        isComplete: !!row.HasIsComplete,
        decisionBy: !!row.HasDecisionBy,
        decisionAt: !!row.HasDecisionAt,
      };
    })().catch((e) => {
      _v3ColumnsPromise = undefined;
      throw e;
    });
  }
  return _v3ColumnsPromise;
}

function normalizeText(value, max, field) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (s.length > max) throw badReq(`${field} maksimal ${max} karakter`);
  return s;
}

function parseIdSupplier(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badReq("idSupplier tidak valid");
  return n;
}

/** Qty positif, dibulatkan ke 3 desimal (presisi kolom). */
function parseQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badReq("qty harus lebih dari 0");
  return Math.round(n * 10 ** QTY_SCALE) / 10 ** QTY_SCALE;
}

/** Terima `penyelesaian` (native) maupun `decision` (nama field retur-v3). */
function parsePenyelesaian(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!PENYELESAIAN.includes(s)) {
    throw badReq(`penyelesaian wajib salah satu dari: ${PENYELESAIAN.join(", ")}`);
  }
  return s;
}

const num = (v) => (v == null ? null : Number(v));

async function withTx(ctx, fn) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), {
      actorId: ctx.actorId,
      actorUsername: ctx.actorUsername,
      requestId: ctx.requestId,
    });
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

/** Kunci header + cek periode tutup transaksi; opsional wajib OPEN. */
async function lockHeader(tx, no, { action } = {}) {
  const res = await new sql.Request(tx)
    .input("No", sql.VarChar(50), no)
    .query(`
      SELECT NoReturBeli, Tanggal, IdSupplier, Status, Penyelesaian
      FROM dbo.ReturBeli_h WITH (UPDLOCK, HOLDLOCK)
      WHERE NoReturBeli = @No`);
  const header = res.recordset[0];
  if (!header) throw notFound(`Retur Beli ${no} tidak ditemukan`);
  if (header.Status !== "OPEN") {
    throw conflict(`Retur Beli ${no} sudah selesai, tidak bisa diubah`);
  }
  const { docDateOnly } = await loadDocDateOnlyFromTable({
    runner: tx,
    table: "dbo.ReturBeli_h",
    codeColumn: "NoReturBeli",
    dateColumn: "Tanggal",
    codeValue: no,
    useLock: true,
  });
  await assertNotLocked({ date: docDateOnly, runner: tx, action, useLock: true });
  return header;
}

/** Kembalikan qty label dari log konsumsi retur ini, lalu hapus log-nya. */
async function restoreLabels(tx, no, noLabels) {
  if (!noLabels.length) return;
  const json = JSON.stringify(noLabels.map((code) => ({ code })));
  await new sql.Request(tx)
    .input("No", sql.VarChar(50), no)
    .input("Json", sql.NVarChar(sql.MAX), json)
    .query(`
      DECLARE @Lbl TABLE (code varchar(50) PRIMARY KEY);
      INSERT INTO @Lbl (code)
      SELECT DISTINCT j.code FROM OPENJSON(@Json) WITH (code varchar(50) '$.code') j;

      UPDATE b
      SET b.Qty = ISNULL(b.Qty, 0) + k.QtyKonsumsi,
          b.DateUsage = NULL
      FROM dbo.BahanPendukung b
      INNER JOIN dbo.BahanPendukungKonsumsi_d k
        ON k.NoBahanPendukung = b.NoBahanPendukung AND k.NoProduksi = @No
      INNER JOIN @Lbl l ON l.code = b.NoBahanPendukung;

      DELETE k
      FROM dbo.BahanPendukungKonsumsi_d k
      INNER JOIN @Lbl l ON l.code = k.NoBahanPendukung
      WHERE k.NoProduksi = @No;`);
}

// ---------------------------------------------------------------------------
// LIST / DETAIL / LOOKUP
// ---------------------------------------------------------------------------

exports.getAllRetur = async ({
  page = 1,
  pageSize = 20,
  search = "",
  status = "",
  dateFrom = null,
  dateTo = null,
} = {}) => {
  const pool = await poolPromise;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(200, Number(pageSize) || 20));
  const offset = (p - 1) * ps;
  const s = String(search || "").trim();
  const st = String(status || "").trim().toUpperCase();
  const df = typeof dateFrom === "string" && dateFrom.trim() ? dateFrom.trim() : null;
  const dt = typeof dateTo === "string" && dateTo.trim() ? dateTo.trim() : null;

  const where = `
    WHERE 1=1
      AND (@search = '' OR h.NoReturBeli LIKE '%' + @search + '%'
            OR ISNULL(sp.NmSupplier, '') LIKE '%' + @search + '%')
      AND (@status = '' OR h.Status = @status)
      AND (@dateFrom IS NULL OR CONVERT(date, h.Tanggal) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(date, h.Tanggal) <= @dateTo)`;
  const bind = (rq) =>
    rq
      .input("search", sql.VarChar(100), s)
      .input("status", sql.VarChar(20), st)
      .input("dateFrom", sql.Date, df)
      .input("dateTo", sql.Date, dt);

  const countRes = await bind(pool.request()).query(`
    SELECT COUNT(1) AS total
    FROM dbo.ReturBeli_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstSupplier sp WITH (NOLOCK) ON sp.IdSupplier = h.IdSupplier
    ${where}`);
  const total = Number(countRes.recordset?.[0]?.total) || 0;
  if (total === 0) return { data: [], total: 0 };

  const dataRes = await bind(pool.request())
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, ps)
    .query(`
      ;WITH LastClosed AS (
        SELECT TOP 1 CONVERT(date, PeriodHarian) AS LastClosedDate
        FROM dbo.MstTutupTransaksiHarian WITH (NOLOCK)
        WHERE [Lock] = 1
        ORDER BY CONVERT(date, PeriodHarian) DESC, Id DESC
      )
      SELECT h.NoReturBeli, CONVERT(varchar(10), h.Tanggal, 23) AS Tanggal,
        h.IdSupplier, sp.NmSupplier, h.Keterangan, h.Status, h.Penyelesaian,
        (SELECT COUNT(1) FROM dbo.ReturBeli_d d WHERE d.NoReturBeli = h.NoReturBeli) AS ItemCount,
        (SELECT ISNULL(SUM(d.Qty), 0) FROM dbo.ReturBeli_d d WHERE d.NoReturBeli = h.NoReturBeli) AS TotalQty,
        CASE WHEN lc.LastClosedDate IS NOT NULL AND CONVERT(date, h.Tanggal) <= lc.LastClosedDate
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsLocked,
        h.CreateBy
      FROM dbo.ReturBeli_h h WITH (NOLOCK)
      LEFT JOIN dbo.MstSupplier sp WITH (NOLOCK) ON sp.IdSupplier = h.IdSupplier
      OUTER APPLY (SELECT TOP 1 LastClosedDate FROM LastClosed) lc
      ${where}
      ORDER BY h.Tanggal DESC, h.NoReturBeli DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`);
  return {
    total,
    data: (dataRes.recordset || []).map((r) => ({
      ...r,
      ItemCount: Number(r.ItemCount) || 0,
      TotalQty: num(r.TotalQty) ?? 0,
    })),
  };
};

/** Alias backward-compat. */
exports.getAll = exports.getAllRetur;

const ITEM_SELECT = `
  SELECT d.IdItem, d.NoReturBeli, d.KodeKategori, d.NoLabel, d.Qty, d.Remark,
    mcm.Nama AS NamaBarang, mcm.ItemCode, b.QtyAwal, b.Qty AS SisaLabel,
    d.CreateBy, d.DateTimeCreate
  FROM dbo.ReturBeli_d d
  LEFT JOIN dbo.BahanPendukung b ON b.NoBahanPendukung = d.NoLabel
  LEFT JOIN dbo.MstCabinetMaterial mcm ON mcm.IdCabinetMaterial = b.IdCabinetMaterial`;

const mapItem = (r) => ({
  ...r,
  Qty: num(r.Qty),
  QtyAwal: num(r.QtyAwal),
  SisaLabel: num(r.SisaLabel),
});

exports.getDetail = async (noRetur) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;
  const cols = await v3Columns();
  const select = [
    "h.NoReturBeli, CONVERT(varchar(10), h.Tanggal, 23) AS Tanggal",
    "h.IdSupplier, sp.NmSupplier, h.Keterangan, h.Status, h.Penyelesaian",
    cols.isComplete ? "h.IsComplete" : "CAST(0 AS bit) AS IsComplete",
    cols.decisionBy
      ? "h.DecisionBy"
      : "CAST(NULL AS varchar(100)) AS DecisionBy",
    cols.decisionAt
      ? "h.DecisionAt"
      : "CAST(NULL AS datetime2(0)) AS DecisionAt",
    "h.CompletedBy, h.CompletedAt, h.CreateBy, h.DateTimeCreate",
  ].join(",\n    ");
  const h = await pool.request().input("No", sql.VarChar(50), no).query(`
    SELECT ${select}
    FROM dbo.ReturBeli_h h
    LEFT JOIN dbo.MstSupplier sp ON sp.IdSupplier = h.IdSupplier
    WHERE h.NoReturBeli = @No`);
  const header = h.recordset[0];
  if (!header) throw notFound(`Retur Beli ${no} tidak ditemukan`);
  const items = await pool
    .request()
    .input("No", sql.VarChar(50), no)
    .query(`${ITEM_SELECT} WHERE d.NoReturBeli = @No ORDER BY d.IdItem`);
  return { noRetur: no, header, items: items.recordset.map(mapItem) };
};

/** Label-item yang diretur (paritas dengan /outputs pada retur-v3). */
exports.getOutputs = async (noRetur) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;
  const res = await pool.request().input("No", sql.VarChar(50), no).query(`
    SELECT d.IdItem, d.NoLabel AS LabelCode, d.KodeKategori,
      mcm.Nama AS NamaBarang, mcm.ItemCode, d.Qty, d.Remark,
      CONVERT(varchar(10), d.DateTimeCreate, 23) AS DateCreate
    FROM dbo.ReturBeli_d d
    LEFT JOIN dbo.BahanPendukung b ON b.NoBahanPendukung = d.NoLabel
    LEFT JOIN dbo.MstCabinetMaterial mcm ON mcm.IdCabinetMaterial = b.IdCabinetMaterial
    WHERE d.NoReturBeli = @No
    ORDER BY d.IdItem`);
  return (res.recordset || []).map((r) => ({ ...r, Qty: num(r.Qty) }));
};

/** Info label bahan pendukung untuk layar scan (read-only). */
exports.lookupLabel = async (noLabel) => {
  const code = String(noLabel || "").trim();
  if (!code) throw badReq("noLabel wajib diisi");
  const pool = await poolPromise;
  const r = await pool.request().input("Code", sql.VarChar(50), code).query(`
    SELECT b.NoBahanPendukung AS NoLabel, b.IdSupplier, sp.NmSupplier,
      b.IdCabinetMaterial, mcm.Nama AS NamaBarang, mcm.ItemCode,
      b.QtyAwal, b.Qty AS Sisa, CONVERT(varchar(10), b.DateUsage, 23) AS DateUsage
    FROM dbo.BahanPendukung b
    LEFT JOIN dbo.MstSupplier sp ON sp.IdSupplier = b.IdSupplier
    LEFT JOIN dbo.MstCabinetMaterial mcm ON mcm.IdCabinetMaterial = b.IdCabinetMaterial
    WHERE b.NoBahanPendukung = @Code`);
  const row = r.recordset[0];
  if (!row) throw notFound(`Label bahan pendukung ${code} tidak ditemukan`);
  const sisa = num(row.Sisa) ?? 0;
  return {
    ...row,
    KodeKategori: "bahanpendukung",
    QtyAwal: num(row.QtyAwal),
    Sisa: sisa,
    Available: row.DateUsage == null && sisa > 0,
  };
};

// ---------------------------------------------------------------------------
// HEADER
// ---------------------------------------------------------------------------

async function assertSupplier(tx, idSupplier) {
  const r = await new sql.Request(tx)
    .input("Id", sql.Int, idSupplier)
    .query(`SELECT 1 FROM dbo.MstSupplier WHERE IdSupplier = @Id`);
  if (!r.recordset.length) throw badReq(`Supplier ${idSupplier} tidak ditemukan`);
}

exports.createHeader = async (payload, ctx) => {
  const { tanggal, idSupplier, keterangan } = payload || {};
  if (idSupplier == null || idSupplier === "") throw badReq("Field wajib: idSupplier");
  const idSup = parseIdSupplier(idSupplier);
  const ket = normalizeText(keterangan, MAX_KETERANGAN, "keterangan");

  return withTx(ctx, async (tx) => {
    const effectiveDate = resolveEffectiveDateForCreate(tanggal);
    await assertNotLocked({
      date: effectiveDate,
      runner: tx,
      action: "create Retur Beli",
      useLock: true,
    });
    await assertSupplier(tx, idSup);

    const no = await generateNextCode(tx, {
      tableName: "ReturBeli_h",
      columnName: "NoReturBeli",
      prefix: PREFIX,
      width: 10,
    });

    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("Tanggal", sql.Date, effectiveDate)
      .input("IdSupplier", sql.Int, idSup)
      .input("Keterangan", sql.NVarChar(MAX_KETERANGAN), ket)
      .input("CreateBy", sql.VarChar(100), ctx.actorUsername)
      .query(`
        INSERT INTO dbo.ReturBeli_h (NoReturBeli, Tanggal, IdSupplier, Keterangan, Status, CreateBy)
        VALUES (@No, @Tanggal, @IdSupplier, @Keterangan, 'OPEN', @CreateBy)`);

    return {
      noRetur: no,
      noReturBeli: no,
      tanggal: formatYMD(effectiveDate),
      idSupplier: idSup,
      keterangan: ket,
      status: "OPEN",
    };
  });
};

exports.updateHeader = async (noRetur, payload, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");

  return withTx(ctx, async (tx) => {
    await lockHeader(tx, no, { action: "update Retur Beli" });
    const sets = [];
    const rq = new sql.Request(tx).input("No", sql.VarChar(50), no);

    if (payload?.tanggal !== undefined) {
      if (!payload.tanggal) throw badReq("tanggal tidak boleh kosong");
      const d = resolveEffectiveDateForCreate(payload.tanggal);
      await assertNotLocked({ date: d, runner: tx, action: "update Retur Beli (tanggal baru)", useLock: true });
      sets.push("Tanggal = @Tanggal");
      rq.input("Tanggal", sql.Date, d);
    }
    if (payload?.idSupplier !== undefined) {
      const idSup = parseIdSupplier(payload.idSupplier);
      await assertSupplier(tx, idSup);
      const items = await new sql.Request(tx)
        .input("No", sql.VarChar(50), no)
        .query(`SELECT TOP 1 1 AS x FROM dbo.ReturBeli_d WHERE NoReturBeli = @No`);
      if (items.recordset.length) {
        throw conflict("Supplier tidak bisa diubah karena sudah ada item. Hapus item dulu.");
      }
      sets.push("IdSupplier = @IdSupplier");
      rq.input("IdSupplier", sql.Int, idSup);
    }
    if (payload?.keterangan !== undefined) {
      sets.push("Keterangan = @Keterangan");
      rq.input(
        "Keterangan",
        sql.NVarChar(MAX_KETERANGAN),
        normalizeText(payload.keterangan, MAX_KETERANGAN, "keterangan"),
      );
    }
    if (!sets.length) throw badReq("Tidak ada field yang diupdate");
    await rq.query(`UPDATE dbo.ReturBeli_h SET ${sets.join(", ")} WHERE NoReturBeli = @No`);
    return {
      noRetur: no,
      noReturBeli: no,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

exports.deleteHeader = async (noRetur, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");

  return withTx(ctx, async (tx) => {
    await lockHeader(tx, no, { action: "delete Retur Beli" });
    const items = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(`SELECT NoLabel FROM dbo.ReturBeli_d WITH (UPDLOCK, HOLDLOCK) WHERE NoReturBeli = @No`);
    await restoreLabels(tx, no, items.recordset.map((r) => r.NoLabel));
    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(`
        DELETE FROM dbo.ReturBeli_d WHERE NoReturBeli = @No;
        DELETE FROM dbo.ReturBeli_h WHERE NoReturBeli = @No;`);
    return {
      noRetur: no,
      noReturBeli: no,
      restoredLabels: items.recordset.length,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

// ---------------------------------------------------------------------------
// ITEM
// ---------------------------------------------------------------------------

/** Tambah satu label di dalam transaksi yang sudah berjalan. */
async function addOneItemInTx(tx, no, header, payload, actorUsername) {
  const code = String(payload?.noLabel || payload?.labelCode || "").trim();
  if (!code) throw badReq("Field wajib: noLabel");
  const requestedQty =
    payload?.qty === undefined || payload?.qty === null || payload?.qty === ""
      ? null
      : parseQty(payload.qty);
  const remark = normalizeText(payload?.remark, MAX_REMARK, "remark");

  const lr = await new sql.Request(tx).input("Code", sql.VarChar(50), code).query(`
    SELECT NoBahanPendukung, IdSupplier, Qty, DateUsage
    FROM dbo.BahanPendukung WITH (UPDLOCK, HOLDLOCK)
    WHERE NoBahanPendukung = @Code`);
  const label = lr.recordset[0];
  if (!label) throw notFound(`Label bahan pendukung ${code} tidak ditemukan`);
  if (Number(label.IdSupplier) !== Number(header.IdSupplier)) {
    throw conflict(`Label ${code} bukan dari supplier retur ini`);
  }
  const sisa = num(label.Qty) ?? 0;
  if (label.DateUsage != null || sisa <= 0) {
    throw conflict(`Label ${code} sudah habis terpakai`);
  }

  const dup = await new sql.Request(tx)
    .input("No", sql.VarChar(50), no)
    .input("Code", sql.VarChar(50), code)
    .query(`SELECT 1 FROM dbo.ReturBeli_d WHERE NoReturBeli = @No AND NoLabel = @Code`);
  if (dup.recordset.length) throw conflict(`Label ${code} sudah ada di retur ini`);

  const qty = requestedQty ?? sisa;
  if (qty > sisa) {
    throw badReq(`Qty retur (${qty}) melebihi sisa label (${sisa})`);
  }
  const full = qty >= sisa;

  const ins = await new sql.Request(tx)
    .input("No", sql.VarChar(50), no)
    .input("Code", sql.VarChar(50), code)
    .input("Qty", sql.Decimal(18, QTY_SCALE), qty)
    .input("Remark", sql.NVarChar(MAX_REMARK), remark)
    .input("CreateBy", sql.VarChar(100), actorUsername)
    .input("Tanggal", sql.Date, header.Tanggal)
    .input("Full", sql.Bit, full ? 1 : 0)
    .query(`
      INSERT INTO dbo.ReturBeli_d (NoReturBeli, KodeKategori, NoLabel, Qty, Remark, CreateBy)
      OUTPUT INSERTED.IdItem
      VALUES (@No, 'bahanpendukung', @Code, @Qty, @Remark, @CreateBy);

      -- Log konsumsi SEBELUM Qty berubah (sumber restore saat dihapus).
      INSERT INTO dbo.BahanPendukungKonsumsi_d
        (NoProduksi, NoBahanPendukung, QtyKonsumsi, CreateBy, DateTimeCreate)
      VALUES (@No, @Code, @Qty, @CreateBy, SYSDATETIME());

      IF @Full = 1
        UPDATE dbo.BahanPendukung SET Qty = 0, DateUsage = @Tanggal
        WHERE NoBahanPendukung = @Code;
      ELSE
        UPDATE dbo.BahanPendukung SET Qty = Qty - @Qty
        WHERE NoBahanPendukung = @Code;`);

  const idItem = ins.recordset[0]?.IdItem;
  const item = await new sql.Request(tx)
    .input("Id", sql.Int, idItem)
    .query(`${ITEM_SELECT} WHERE d.IdItem = @Id`);
  return mapItem(item.recordset[0]);
}

/** Tambah satu atau beberapa label sekaligus (paritas addItems retur-v3). */
exports.addItems = async (noRetur, items, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Array.isArray(items) || items.length === 0) {
    throw badReq("items wajib berisi minimal 1 item");
  }

  return withTx(ctx, async (tx) => {
    const header = await lockHeader(tx, no, { action: "tambah item Retur Beli" });
    const created = [];
    for (const it of items) {
      created.push(await addOneItemInTx(tx, no, header, it, ctx.actorUsername));
    }
    return {
      noRetur: no,
      items: created,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

/** Legacy single-item API — dipertahankan untuk kompatibilitas. */
exports.addItem = async (noRetur, payload, ctx) => {
  const result = await exports.addItems(noRetur, [payload], ctx);
  return result.items[0];
};

/** Ubah qty/remark item dan rekonsiliasi stok + log konsumsinya. */
exports.updateItem = async (noRetur, idItem, payload, ctx) => {
  const no = String(noRetur || "").trim();
  const id = Number(idItem);
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Number.isInteger(id) || id <= 0) throw badReq("idItem tidak valid");

  return withTx(ctx, async (tx) => {
    const header = await lockHeader(tx, no, { action: "ubah item Retur Beli" });
    const r = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("Id", sql.Int, id)
      .query(`
        SELECT d.IdItem, d.NoLabel, d.Qty, d.Remark, b.Qty AS SisaLabel, b.DateUsage
        FROM dbo.ReturBeli_d d WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.BahanPendukung b WITH (UPDLOCK, HOLDLOCK)
          ON b.NoBahanPendukung = d.NoLabel
        WHERE d.NoReturBeli = @No AND d.IdItem = @Id`);
    const item = r.recordset[0];
    if (!item) throw notFound(`Item ${id} tidak ditemukan di ${no}`);

    const oldQty = num(item.Qty) ?? 0;
    const sisaSekarang = num(item.SisaLabel) ?? 0;
    const totalSebelum = sisaSekarang + oldQty;
    const newQty = payload?.qty === undefined || payload?.qty === null || payload?.qty === ""
      ? oldQty
      : parseQty(payload.qty);
    if (newQty > totalSebelum) {
      throw badReq(`Qty retur (${newQty}) melebihi sisa label (${totalSebelum})`);
    }
    const remark =
      payload?.remark === undefined
        ? item.Remark
        : normalizeText(payload.remark, MAX_REMARK, "remark");
    const full = newQty >= totalSebelum;

    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("Code", sql.VarChar(50), item.NoLabel)
      .input("Qty", sql.Decimal(18, QTY_SCALE), newQty)
      .input("SisaBaru", sql.Decimal(18, QTY_SCALE), totalSebelum - newQty)
      .input("Remark", sql.NVarChar(MAX_REMARK), remark)
      .input("Id", sql.Int, id)
      .input("Tanggal", sql.Date, header.Tanggal)
      .input("Full", sql.Bit, full ? 1 : 0)
      .query(`
        UPDATE dbo.ReturBeli_d SET Qty = @Qty, Remark = @Remark WHERE IdItem = @Id;
        UPDATE dbo.BahanPendukungKonsumsi_d SET QtyKonsumsi = @Qty
        WHERE NoProduksi = @No AND NoBahanPendukung = @Code;
        IF @Full = 1
          UPDATE dbo.BahanPendukung SET Qty = 0, DateUsage = @Tanggal
          WHERE NoBahanPendukung = @Code;
        ELSE
          UPDATE dbo.BahanPendukung SET Qty = @SisaBaru, DateUsage = NULL
          WHERE NoBahanPendukung = @Code;`);

    const updated = await new sql.Request(tx)
      .input("Id", sql.Int, id)
      .query(`${ITEM_SELECT} WHERE d.IdItem = @Id`);
    return mapItem(updated.recordset[0]);
  });
};

exports.deleteItem = async (noRetur, idItem, ctx) => {
  const no = String(noRetur || "").trim();
  const id = Number(idItem);
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Number.isInteger(id) || id <= 0) throw badReq("idItem tidak valid");

  return withTx(ctx, async (tx) => {
    await lockHeader(tx, no, { action: "hapus item Retur Beli" });
    const r = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("Id", sql.Int, id)
      .query(`
        SELECT NoLabel FROM dbo.ReturBeli_d WITH (UPDLOCK, HOLDLOCK)
        WHERE NoReturBeli = @No AND IdItem = @Id`);
    const item = r.recordset[0];
    if (!item) throw notFound(`Item ${id} tidak ditemukan di ${no}`);
    await restoreLabels(tx, no, [item.NoLabel]);
    await new sql.Request(tx)
      .input("Id", sql.Int, id)
      .query(`DELETE FROM dbo.ReturBeli_d WHERE IdItem = @Id`);
    return {
      noRetur: no,
      noReturBeli: no,
      idItem: id,
      noLabel: item.NoLabel,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

// ---------------------------------------------------------------------------
// SCAN / TURNOVER (paritas scanAuto + undoScan + getTurnover retur-v3)
// ---------------------------------------------------------------------------

/** Scan label -> otomatis jadi item retur. Bisa minta konfirmasi partial. */
exports.scanLabelAuto = async (noRetur, labelCode, ctx, options = {}) => {
  const no = String(noRetur || "").trim();
  const code = String(labelCode || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  if (!code) throw badReq("labelCode wajib diisi");
  const confirmPartial = options.confirmPartial === true;

  return withTx(ctx, async (tx) => {
    const header = await lockHeader(tx, no, { action: "scan label Retur Beli" });
    const labelRes = await new sql.Request(tx)
      .input("Code", sql.VarChar(50), code)
      .query(`
        SELECT NoBahanPendukung, IdSupplier, Qty, DateUsage
        FROM dbo.BahanPendukung WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBahanPendukung = @Code`);
    const label = labelRes.recordset[0];
    if (!label) throw badReq(`Label ${code} tidak ditemukan`);
    if (label.DateUsage != null) throw badReq(`Label ${code} sudah terpakai`);
    const available = num(label.Qty) ?? 0;
    if (available <= 0) throw badReq(`Label ${code} sudah habis pcs-nya`);

    const requested = options.qty == null ? null : parseQty(options.qty);
    if (requested != null && requested > available && !confirmPartial) {
      return {
        needsConfirmation: true,
        noRetur: no,
        labelCode: code,
        availableQty: available,
        requestedQty: requested,
        message:
          `Label ${code} hanya menyisa ${available} pcs, sedangkan diminta ${requested} pcs. ` +
          `Gunakan seluruh sisa ${available} pcs untuk retur ${no}?`,
      };
    }
    const qty = requested == null ? available : Math.min(requested, available);
    const item = await addOneItemInTx(
      tx,
      no,
      header,
      { noLabel: code, qty, remark: options.remark },
      ctx.actorUsername,
    );
    return {
      noRetur: no,
      idItem: item.IdItem,
      noLabel: code,
      qty: item.Qty,
      availableQty: available,
      sisaSetelah: Math.round((available - qty) * 10 ** QTY_SCALE) / 10 ** QTY_SCALE,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

/** Batalkan scan = hapus item & kembalikan stok (idTurnover == IdItem). */
exports.undoScan = async (noRetur, idTurnover, ctx) => {
  const deleted = await exports.deleteItem(noRetur, idTurnover, ctx);
  return {
    noRetur: deleted.noRetur,
    idTurnover: deleted.idItem,
    audit: deleted.audit,
  };
};

/** Daftar "turnover" retur-beli: satu baris per label yang diretur. */
exports.getTurnover = async (noRetur) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;
  const res = await pool.request().input("No", sql.VarChar(50), no).query(`
    SELECT d.IdItem, d.NoLabel, d.Qty, d.Remark,
      CONVERT(varchar(10), d.DateTimeCreate, 23) AS DateCreate
    FROM dbo.ReturBeli_d d
    WHERE d.NoReturBeli = @No
    ORDER BY d.IdItem`);
  return (res.recordset || []).map((r) => ({
    idTurnover: r.IdItem,
    idItem: r.IdItem,
    kodeKategoriAsal: "bahanpendukung",
    labelCode: r.NoLabel,
    qty: num(r.Qty),
    targetQty: num(r.Qty),
    scans: [
      {
        idTurnover: r.IdItem,
        labelCode: r.NoLabel,
        qty: num(r.Qty),
        remark: r.Remark,
        dateTimeScan: r.DateCreate,
      },
    ],
  }));
};

// ---------------------------------------------------------------------------
// KEPUTUSAN & SELESAI
// ---------------------------------------------------------------------------

/** Wewenang Sales (returbeli:decide): tetapkan Penyelesaian, status tetap OPEN. */
exports.decide = async (noRetur, decision, body = {}, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const penyelesaian = parsePenyelesaian(decision ?? body?.penyelesaian);

  return withTx(ctx, async (tx) => {
    const header = await lockHeader(tx, no, { action: "putuskan Retur Beli" });
    if (header.Penyelesaian) {
      throw conflict("Retur Beli sudah diputuskan sebelumnya");
    }
    const items = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(`SELECT IdItem FROM dbo.ReturBeli_d WHERE NoReturBeli = @No`);
    if (!items.recordset.length) {
      throw badReq("Header belum memiliki item, tidak bisa diputuskan");
    }

    const cols = await v3Columns();
    const sets = ["Penyelesaian = @Penyelesaian"];
    const rq = new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("Penyelesaian", sql.VarChar(20), penyelesaian);
    if (cols.decisionBy) {
      sets.push("DecisionBy = @By");
      rq.input("By", sql.VarChar(100), ctx.actorUsername);
    }
    if (cols.decisionAt) sets.push("DecisionAt = SYSDATETIME()");
    await rq.query(`
        UPDATE dbo.ReturBeli_h
        SET ${sets.join(", ")}
        WHERE NoReturBeli = @No`);

    return {
      noRetur: no,
      penyelesaian,
      decision: penyelesaian,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

/** Tandai selesai & kunci dokumen (paritas markComplete retur-v3). */
exports.markComplete = async (noRetur, payload = {}, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const legacyPenyelesaian =
    payload?.penyelesaian !== undefined || payload?.decision !== undefined
      ? parsePenyelesaian(payload.penyelesaian ?? payload.decision)
      : null;

  return withTx(ctx, async (tx) => {
    const cols = await v3Columns();
    const header = await lockHeader(tx, no, { action: "selesaikan Retur Beli" });
    if (!header.Penyelesaian && !legacyPenyelesaian) {
      throw conflict("Penyelesaian belum diputuskan. Panggil PATCH /:noRetur/decision dulu.");
    }
    const items = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(`SELECT COUNT(1) AS n FROM dbo.ReturBeli_d WHERE NoReturBeli = @No`);
    if (!Number(items.recordset[0]?.n)) {
      throw conflict("Retur belum punya item, tidak bisa diselesaikan");
    }
    if (legacyPenyelesaian && !header.Penyelesaian) {
      const sets = ["Penyelesaian = @Penyelesaian"];
      const rq = new sql.Request(tx)
        .input("No", sql.VarChar(50), no)
        .input("Penyelesaian", sql.VarChar(20), legacyPenyelesaian);
      if (cols.decisionBy) {
        sets.push("DecisionBy = @By");
        rq.input("By", sql.VarChar(100), ctx.actorUsername);
      }
      if (cols.decisionAt) sets.push("DecisionAt = SYSDATETIME()");
      await rq.query(`
          UPDATE dbo.ReturBeli_h
          SET ${sets.join(", ")}
          WHERE NoReturBeli = @No`);
    }
    const completeSets = ["Status = 'SELESAI'"];
    if (cols.isComplete) completeSets.push("IsComplete = 1");
    completeSets.push("CompletedBy = @By", "CompletedAt = SYSDATETIME()");
    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("By", sql.VarChar(100), ctx.actorUsername)
      .query(`
        UPDATE dbo.ReturBeli_h
        SET ${completeSets.join(", ")}
        WHERE NoReturBeli = @No`);
    return {
      noRetur: no,
      status: "SELESAI",
      isComplete: true,
      audit: { actorId: ctx.actorId, requestId: ctx.requestId },
    };
  });
};

/** Legacy alias: complete(no, { penyelesaian }, ctx). */
exports.complete = exports.markComplete;

module.exports.PENYELESAIAN = PENYELESAIAN;
module.exports.parseQty = parseQty;
