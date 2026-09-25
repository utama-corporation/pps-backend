// bahan-pendukung-service.js
//
// Mirror pola furniture-wip-service.js, disederhanakan: TIDAK ada endpoint
// create generik di sini — satu-satunya sumber pembuatan BahanPendukung
// adalah fase 2 penerimaan-bahan-pendukung-service.js#addItemsPenerimaanBahanPendukung
// (mengikuti pola create-furniture-wip.handler.js yang langsung memakai
// writeRepo, bukan lewat service ini). Module ini hanya menangani
// list/update/delete/print untuk barang yang sudah ada.
const { sql, poolPromise } = require("../../../core/config/db");
const {
  toDateOnly,
  assertNotLocked,
} = require("../../../core/shared/tutup-transaksi-guard");
const { badReq, conflict, notFound } = require("../../../core/utils/http-error");
const readRepo = require("./repositories/bahan-pendukung-read.repository");
const writeRepo = require("./repositories/bahan-pendukung-write.repository");

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

exports.getAll = async ({ page, limit, search, includeUsed = false }) =>
  readRepo.getAll({ page, limit, search, includeUsed });

exports.updateBahanPendukung = async (noBahanPendukung, payload) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  const header = payload?.header || {};

  const actorIdNum = Number(payload?.actorId);
  const actorId = Number.isFinite(actorIdNum) && actorIdNum > 0 ? actorIdNum : null;
  const requestId = String(
    payload?.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  if (!actorId) {
    throw badReq("actorId kosong. Controller harus inject payload.actorId dari token.");
  }

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    await new sql.Request(tx)
      .input("actorId", sql.Int, actorId)
      .input("rid", sql.NVarChar(64), requestId).query(`
        EXEC sys.sp_set_session_context @key=N'actor_id', @value=@actorId;
        EXEC sys.sp_set_session_context @key=N'request_id', @value=@rid;
      `);

    const current = await readRepo.getExistingForUpdate(tx, noBahanPendukung);
    if (!current) {
      throw notFound("Bahan Pendukung tidak ditemukan");
    }

    const existingCreatedAt = current.CreatedAt;
    const existingDateOnly = existingCreatedAt ? toDateOnly(existingCreatedAt) : null;
    await assertNotLocked({
      date: existingDateOnly,
      runner: tx,
      action: "update bahan pendukung",
      useLock: true,
    });

    const merged = {
      IdSupplier: hasOwn(header, "IdSupplier") ? header.IdSupplier : current.IdSupplier,
      IdCabinetMaterial: hasOwn(header, "IdCabinetMaterial")
        ? header.IdCabinetMaterial
        : current.IdCabinetMaterial,
      Qty: hasOwn(header, "Qty") ? header.Qty : current.Qty,
      Keterangan: hasOwn(header, "Keterangan") ? header.Keterangan : current.Keterangan,
      IsPartial: hasOwn(header, "IsPartial") ? header.IsPartial : current.IsPartial,
      Blok: hasOwn(header, "Blok") ? header.Blok : current.Blok,
      IdLokasi: hasOwn(header, "IdLokasi") ? header.IdLokasi : current.IdLokasi,
    };

    if (!merged.IdCabinetMaterial) throw badReq("IdCabinetMaterial cannot be empty");
    if (!merged.IdSupplier) throw badReq("IdSupplier cannot be empty");

    await writeRepo.updateBahanPendukungHeader(tx, noBahanPendukung, merged);

    await tx.commit();

    return {
      header: { NoBahanPendukung: noBahanPendukung, ...merged },
      audit: { actorId, requestId },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
};

exports.deleteBahanPendukung = async (noBahanPendukung, payload) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  const NoBahanPendukung = String(noBahanPendukung || "").trim();
  if (!NoBahanPendukung) throw badReq("noBahanPendukung is required");

  const actorIdNum = Number(payload?.actorId);
  const actorId = Number.isFinite(actorIdNum) && actorIdNum > 0 ? actorIdNum : null;
  const requestId = String(
    payload?.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  if (!actorId) {
    throw badReq("actorId kosong. Controller harus inject payload.actorId dari token.");
  }

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    await new sql.Request(tx)
      .input("actorId", sql.Int, actorId)
      .input("rid", sql.NVarChar(64), requestId).query(`
        EXEC sys.sp_set_session_context @key=N'actor_id', @value=@actorId;
        EXEC sys.sp_set_session_context @key=N'request_id', @value=@rid;
      `);

    const head = await readRepo.getHeaderForDelete(tx, NoBahanPendukung);
    if (!head) throw notFound("Bahan Pendukung tidak ditemukan");

    const trxDate = head.CreatedAt ? toDateOnly(head.CreatedAt) : null;
    await assertNotLocked({
      date: trxDate,
      runner: tx,
      action: "delete bahan pendukung",
      useLock: true,
    });

    if (head.DateUsage) {
      const err = conflict("Cannot delete: Bahan Pendukung already used (DateUsage IS NOT NULL).");
      err.code = "BP_ALREADY_USED";
      throw err;
    }

    // Hapus dulu baris pengikat di PenerimaanBahanPendukung_d (FK), baru
    // baris BahanPendukung-nya sendiri.
    await writeRepo.deletePenerimaanBahanPendukungDLink(tx, NoBahanPendukung);
    const rowsDeleted = await writeRepo.deleteBahanPendukungHeader(tx, NoBahanPendukung);
    if (rowsDeleted === 0) throw notFound("Bahan Pendukung tidak ditemukan");

    await tx.commit();

    return { noBahanPendukung: NoBahanPendukung, deleted: true, audit: { actorId, requestId } };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}

    if (err?.number === 547) {
      const e = conflict(err.message || "Delete failed due to foreign key constraint.");
      e.original = err;
      throw e;
    }

    throw err;
  }
};

exports.incrementHasBeenPrinted = async (payload) => {
  const NoBahanPendukung = String(payload?.NoBahanPendukung || "").trim();
  if (!NoBahanPendukung) throw badReq("NoBahanPendukung wajib diisi");

  const actorIdNum = Number(payload?.actorId);
  const actorId = Number.isFinite(actorIdNum) && actorIdNum > 0 ? actorIdNum : null;
  if (!actorId) {
    throw badReq("actorId kosong. Controller harus inject payload.actorId dari token.");
  }

  const requestId = String(
    payload?.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    await new sql.Request(tx)
      .input("actorId", sql.Int, actorId)
      .input("rid", sql.NVarChar(64), requestId).query(`
        EXEC sys.sp_set_session_context @key=N'actor_id', @value=@actorId;
        EXEC sys.sp_set_session_context @key=N'request_id', @value=@rid;
      `);

    const row = await writeRepo.incrementHasBeenPrinted(tx, NoBahanPendukung);
    if (!row) {
      const e = new Error(`NoBahanPendukung ${NoBahanPendukung} tidak ditemukan`);
      e.statusCode = 404;
      throw e;
    }

    await tx.commit();

    return {
      NoBahanPendukung: row.NoBahanPendukung,
      HasBeenPrinted: row.HasBeenPrinted,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.getByNoBahanPendukung = async (noBahanPendukung) => {
  const row = await readRepo.getByNoBahanPendukung(noBahanPendukung);
  if (!row) {
    const e = new Error(`NoBahanPendukung ${noBahanPendukung} tidak ditemukan`);
    e.statusCode = 404;
    throw e;
  }
  return row;
};

exports.getLabelByIdCabinetMaterial = async (idCabinetMaterial) => {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdCabinetMaterial", sql.Int, idCabinetMaterial)
    .query(`
      SELECT
        b.NoBahanPendukung,
        b.NoBahanPendukung AS Label,
        b.CreatedAt,
        b.Qty,
        b.Blok,
        b.IdLokasi,
        ISNULL(CAST(b.HasBeenPrinted AS int), 0) AS HasBeenPrinted
      FROM dbo.BahanPendukung b
      WHERE b.IdCabinetMaterial = @IdCabinetMaterial
        AND b.DateUsage IS NULL
      ORDER BY b.CreatedAt ASC, b.NoBahanPendukung ASC;
    `);

  return result.recordset.map((r) => ({
    NoBahanPendukung: r.NoBahanPendukung,
    Label: r.Label,
    ...(r.CreatedAt && { CreatedAt: r.CreatedAt }),
    Qty: Number(
      (
        typeof r.Qty === "number"
          ? r.Qty
          : parseFloat(Number(r.Qty)) || 0
      ).toFixed(2),
    ),
    ...(r.Blok && { Blok: r.Blok }),
    ...(r.IdLokasi && { IdLokasi: r.IdLokasi }),
    HasBeenPrinted: r.HasBeenPrinted,
  }));
};

exports.getStok = async () => {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT
      m.IdCabinetMaterial,
      m.Nama AS NamaCabinetMaterial,
      m.ItemCode,
      u.NamaUOM,
      ISNULL(agg.LabelSisa, 0) AS LabelSisa,
      ISNULL(agg.QtySisa, 0) AS QtySisa,
      agg.DateCreateTertua,
      STUFF((
        SELECT DISTINCT ', ' + CONCAT(b.Blok, CONVERT(VARCHAR(10), b.IdLokasi))
        FROM dbo.BahanPendukung b
        WHERE b.IdCabinetMaterial = m.IdCabinetMaterial
          AND b.DateUsage IS NULL
          AND ISNULL(NULLIF(b.Blok, ''), '') <> ''
        FOR XML PATH('')
      ), 1, 2, '') AS Lokasi
    FROM dbo.MstCabinetMaterial m
    LEFT JOIN (
      SELECT
        b.IdCabinetMaterial,
        COUNT(1) AS LabelSisa,
        SUM(ISNULL(b.Qty, 0)) AS QtySisa,
        MIN(b.CreatedAt) AS DateCreateTertua
      FROM dbo.BahanPendukung b
      WHERE b.DateUsage IS NULL
      GROUP BY b.IdCabinetMaterial
    ) agg ON agg.IdCabinetMaterial = m.IdCabinetMaterial
    LEFT JOIN dbo.MstUOM u WITH (NOLOCK) ON u.IdUOM = m.IdUOM
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.Nama ASC;
  `);

  return result.recordset.map((r) => ({
    IdCabinetMaterial: r.IdCabinetMaterial,
    NamaCabinetMaterial: r.NamaCabinetMaterial,
    ...(r.ItemCode && { ItemCode: r.ItemCode }),
    NamaUOM: r.NamaUOM,
    LabelSisa:
      typeof r.LabelSisa === "number"
        ? r.LabelSisa
        : parseInt(r.LabelSisa, 10) || 0,
    QtySisa: Number(
      (
        typeof r.QtySisa === "number"
          ? r.QtySisa
          : parseFloat(r.QtySisa) || 0
      ).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
    ...(r.Lokasi && r.Lokasi.trim() ? { Lokasi: r.Lokasi } : {}),
  }));
};
