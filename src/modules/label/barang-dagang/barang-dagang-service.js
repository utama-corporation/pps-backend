// barang-dagang-service.js
//
// Mirror pola bahan-pendukung-service.js, disederhanakan: TIDAK ada endpoint
// create generik di sini — satu-satunya sumber pembuatan BarangDagang adalah
// fase 2 penerimaan-barang-dagang-service.js#addItemsPenerimaanBarangDagang.
// Module ini hanya menangani list/update/delete/print untuk barang yang
// sudah ada.
const { sql, poolPromise } = require("../../../core/config/db");
const {
  toDateOnly,
  assertNotLocked,
} = require("../../../core/shared/tutup-transaksi-guard");
const { badReq, conflict, notFound } = require("../../../core/utils/http-error");
const readRepo = require("./repositories/barang-dagang-read.repository");
const writeRepo = require("./repositories/barang-dagang-write.repository");

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

exports.getAll = async ({ page, limit, search, includeUsed = false }) =>
  readRepo.getAll({ page, limit, search, includeUsed });

exports.updateBarangDagang = async (noBarangDagang, payload) => {
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

    const current = await readRepo.getExistingForUpdate(tx, noBarangDagang);
    if (!current) {
      throw notFound("Barang Dagang tidak ditemukan");
    }

    const existingCreatedAt = current.CreatedAt;
    const existingDateOnly = existingCreatedAt ? toDateOnly(existingCreatedAt) : null;
    await assertNotLocked({
      date: existingDateOnly,
      runner: tx,
      action: "update barang dagang",
      useLock: true,
    });

    // Label yang sudah dicetak atau sudah terpakai tidak boleh diubah —
    // data di server akan tidak cocok dengan label fisik yang sudah keluar.
    if (current.HasBeenPrinted > 0) {
      const err = conflict(
        "Cannot update: Barang Dagang sudah dicetak. Data hanya bisa diubah selama label belum dicetak.",
      );
      err.code = "BD_ALREADY_PRINTED";
      throw err;
    }

    if (current.DateUsage) {
      const err = conflict(
        "Cannot update: Barang Dagang sudah dipakai (DateUsage IS NOT NULL).",
      );
      err.code = "BD_ALREADY_USED";
      throw err;
    }

    const merged = {
      IdSupplier: hasOwn(header, "IdSupplier") ? header.IdSupplier : current.IdSupplier,
      IdBarangDagang: hasOwn(header, "IdBarangDagang")
        ? header.IdBarangDagang
        : current.IdBarangDagang,
      Qty: hasOwn(header, "Qty") ? header.Qty : current.Qty,
      Keterangan: hasOwn(header, "Keterangan") ? header.Keterangan : current.Keterangan,
      IsPartial: hasOwn(header, "IsPartial") ? header.IsPartial : current.IsPartial,
      Blok: hasOwn(header, "Blok") ? header.Blok : current.Blok,
      IdLokasi: hasOwn(header, "IdLokasi") ? header.IdLokasi : current.IdLokasi,
    };

    if (!merged.IdBarangDagang) throw badReq("IdBarangDagang cannot be empty");
    if (!merged.IdSupplier) throw badReq("IdSupplier cannot be empty");
    if (!(Number(merged.Qty) > 0)) throw badReq("Qty harus lebih besar dari 0");

    await writeRepo.updateBarangDagangHeader(tx, noBarangDagang, merged);

    await tx.commit();

    return {
      header: { NoBarangDagang: noBarangDagang, ...merged },
      audit: { actorId, requestId },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw err;
  }
};

exports.deleteBarangDagang = async (noBarangDagang, payload) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);

  const NoBarangDagang = String(noBarangDagang || "").trim();
  if (!NoBarangDagang) throw badReq("noBarangDagang is required");

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

    const head = await readRepo.getHeaderForDelete(tx, NoBarangDagang);
    if (!head) throw notFound("Barang Dagang tidak ditemukan");

    const trxDate = head.CreatedAt ? toDateOnly(head.CreatedAt) : null;
    await assertNotLocked({
      date: trxDate,
      runner: tx,
      action: "delete barang dagang",
      useLock: true,
    });

    if (head.DateUsage) {
      const err = conflict("Cannot delete: Barang Dagang already used (DateUsage IS NOT NULL).");
      err.code = "BD_ALREADY_USED";
      throw err;
    }

    // Hapus dulu baris pengikat di PenerimaanBarangDagang_d (FK), baru
    // baris BarangDagang-nya sendiri.
    await writeRepo.deletePenerimaanBarangDagangDLink(tx, NoBarangDagang);
    const rowsDeleted = await writeRepo.deleteBarangDagangHeader(tx, NoBarangDagang);
    if (rowsDeleted === 0) throw notFound("Barang Dagang tidak ditemukan");

    await tx.commit();

    return { noBarangDagang: NoBarangDagang, deleted: true, audit: { actorId, requestId } };
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
  const NoBarangDagang = String(payload?.NoBarangDagang || "").trim();
  if (!NoBarangDagang) throw badReq("NoBarangDagang wajib diisi");

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

    const row = await writeRepo.incrementHasBeenPrinted(tx, NoBarangDagang);
    if (!row) {
      const e = new Error(`NoBarangDagang ${NoBarangDagang} tidak ditemukan`);
      e.statusCode = 404;
      throw e;
    }

    await tx.commit();

    return {
      NoBarangDagang: row.NoBarangDagang,
      HasBeenPrinted: row.HasBeenPrinted,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.getByNoBarangDagang = async (noBarangDagang) => {
  const row = await readRepo.getByNoBarangDagang(noBarangDagang);
  if (!row) {
    const e = new Error(`NoBarangDagang ${noBarangDagang} tidak ditemukan`);
    e.statusCode = 404;
    throw e;
  }
  return row;
};
