// src/modules/retur-v3/retur-v3-service.js
const { sql, poolPromise } = require("../../core/config/db");
const {
  resolveEffectiveDateForCreate,
  assertNotLocked,
  loadDocDateOnlyFromConfig,
  formatYMD,
} = require("../../core/shared/tutup-transaksi-guard");
const { badReq, conflict, notFound } = require("../../core/utils/http-error");
const { applyAuditContext } = require("../../core/utils/db-audit-context");
// Mesin "partial consumption" label fisik — dipakai bareng dengan penjualan.
const {
  PARTIAL_CONFIG,
  lockParentAndAvailablePcs,
  markParentFullyUsed,
  createPartial,
} = require("../../core/shared/label-partial.helper");

const {
  generateBarangJadiLabel,
} = require("./handlers/generate-barang-jadi.handler");
const {
  generateFurnitureWipLabel,
} = require("./handlers/generate-furniture-wip.handler");
const {
  generateRejectLabel,
} = require("./handlers/generate-reject.handler");

const ALLOWED_KODE_KATEGORI = ["barangjadi", "furniturewip"];
const ALLOWED_KATEGORI_INPUT = ["BAGUS", "REJECT"];

function assertKodeKategori(value, field = "kodeKategori") {
  if (!ALLOWED_KODE_KATEGORI.includes(value)) {
    throw badReq(`${field} wajib salah satu dari: ${ALLOWED_KODE_KATEGORI.join(", ")}`);
  }
}

function assertKategoriInput(value, field = "kategoriInput") {
  if (!ALLOWED_KATEGORI_INPUT.includes(value)) {
    throw badReq(`${field} wajib salah satu dari: ${ALLOWED_KATEGORI_INPUT.join(", ")}`);
  }
}

async function jenisExists(tx, kodeKategori, idJenis) {
  const rq = new sql.Request(tx).input("Id", sql.Int, idJenis);
  if (kodeKategori === "barangjadi") {
    const r = await rq.query(`SELECT 1 FROM dbo.MstBarangJadi WHERE IdBJ=@Id`);
    return r.recordset.length > 0;
  }
  const r = await rq.query(`SELECT 1 FROM dbo.MstCabinetWIP WHERE IdCabinetWIP=@Id`);
  return r.recordset.length > 0;
}

// ---------------------------------------------------------------------------
// LIST / DETAIL
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
  const searchTerm = String(search || "").trim();
  const statusTerm = String(status || "").trim();
  const df = typeof dateFrom === "string" && dateFrom.trim() ? dateFrom.trim() : null;
  const dt = typeof dateTo === "string" && dateTo.trim() ? dateTo.trim() : null;

  const whereClause = `
    WHERE 1=1
      AND (@search = '' OR h.NoRetur LIKE '%' + @search + '%' OR ISNULL(p.NamaPembeli, '') LIKE '%' + @search + '%')
      AND (@status = '' OR h.StatusRetur = @status)
      AND (@dateFrom IS NULL OR CONVERT(date, h.Tanggal) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(date, h.Tanggal) <= @dateTo)
  `;

  const countReq = pool.request();
  countReq.input("search", sql.VarChar(100), searchTerm);
  countReq.input("status", sql.VarChar(20), statusTerm);
  countReq.input("dateFrom", sql.Date, df);
  countReq.input("dateTo", sql.Date, dt);
  const countRes = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM dbo.BJReturV3_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstPembeli p WITH (NOLOCK) ON p.IdPembeli = h.IdPembeli
    ${whereClause};
  `);
  const total = countRes.recordset?.[0]?.total || 0;
  if (total === 0) return { data: [], total: 0 };

  const dataReq = pool.request();
  dataReq.input("search", sql.VarChar(100), searchTerm);
  dataReq.input("status", sql.VarChar(20), statusTerm);
  dataReq.input("dateFrom", sql.Date, df);
  dataReq.input("dateTo", sql.Date, dt);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("pageSize", sql.Int, ps);
  const dataRes = await dataReq.query(`
    ;WITH LastClosed AS (
      SELECT TOP 1 CONVERT(date, PeriodHarian) AS LastClosedDate
      FROM dbo.MstTutupTransaksiHarian WITH (NOLOCK)
      WHERE [Lock] = 1
      ORDER BY CONVERT(date, PeriodHarian) DESC, Id DESC
    )
    SELECT
      h.NoRetur,
      h.Tanggal,
      h.IdPembeli,
      p.NamaPembeli,
      h.Keterangan,
      h.StatusRetur,
      h.IsComplete,
      (SELECT COUNT(1) FROM dbo.BJReturV3Item_d it WHERE it.NoRetur = h.NoRetur) AS ItemCount,
      -- Target turnover = pcs item retur itu sendiri (like-for-like); hanya
      -- relevan saat DIGANTI supaya kartu non-DIGANTI tetap '-' (target = 0).
      CASE WHEN h.StatusRetur = 'DIGANTI'
        THEN (SELECT ISNULL(SUM(it.Pcs), 0) FROM dbo.BJReturV3Item_d it WHERE it.NoRetur = h.NoRetur)
        ELSE 0 END AS TurnoverTargetPcs,
      (SELECT ISNULL(SUM(tv.Pcs), 0) FROM dbo.BJReturV3Turnover_d tv WHERE tv.NoRetur = h.NoRetur) AS TurnoverScannedPcs,
      CASE
        WHEN lc.LastClosedDate IS NOT NULL AND CONVERT(date, h.Tanggal) <= lc.LastClosedDate
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit)
      END AS IsLocked
    FROM dbo.BJReturV3_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstPembeli p WITH (NOLOCK) ON p.IdPembeli = h.IdPembeli
    OUTER APPLY (SELECT TOP 1 LastClosedDate FROM LastClosed) lc
    ${whereClause}
    ORDER BY h.NoRetur DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `);

  return {
    data: (dataRes.recordset || []).map((r) => ({
      ...r,
      Tanggal: formatYMD(r.Tanggal),
    })),
    total,
  };
};

exports.getDetail = async (noRetur) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;

  const headerRes = await pool
    .request()
    .input("No", sql.VarChar(50), no).query(`
      SELECT h.*, p.NamaPembeli
      FROM dbo.BJReturV3_h h
      LEFT JOIN dbo.MstPembeli p ON p.IdPembeli = h.IdPembeli
      WHERE h.NoRetur = @No
    `);
  const header = headerRes.recordset?.[0];
  if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);

  const itemsRes = await pool
    .request()
    .input("No", sql.VarChar(50), no).query(`
      SELECT
        it.IdItem, it.NoRetur, it.KodeKategori, it.IdJenis, it.Pcs,
        it.KategoriInput, it.Berat, it.IdReject, it.GeneratedLabelCode,
        CASE
          WHEN it.KodeKategori = 'barangjadi' THEN mbj.NamaBJ
          WHEN it.KodeKategori = 'furniturewip' THEN mcw.Nama
        END AS NamaJenis,
        mr.NamaReject
      FROM dbo.BJReturV3Item_d it
      LEFT JOIN dbo.MstBarangJadi mbj ON mbj.IdBJ = it.IdJenis AND it.KodeKategori = 'barangjadi'
      LEFT JOIN dbo.MstCabinetWIP mcw ON mcw.IdCabinetWIP = it.IdJenis AND it.KodeKategori = 'furniturewip'
      LEFT JOIN dbo.MstReject mr ON mr.IdReject = it.IdReject
      WHERE it.NoRetur = @No
      ORDER BY it.IdItem ASC
    `);
  const items = itemsRes.recordset || [];

  let itemsWithExtra = items;

  if (header.StatusRetur === "DIGANTI" && items.length > 0) {
    // Turnover dicocokkan langsung ke item retur (like-for-like): target =
    // it.Pcs, scanned = SUM(BJReturV3Turnover_d.Pcs) untuk IdItem itu.
    const turnoverRes = await pool
      .request()
      .input("No", sql.VarChar(50), no).query(`
        SELECT
          it.IdItem,
          it.Pcs AS TargetPcs,
          ISNULL(SUM(tv.Pcs), 0) AS ScannedPcs
        FROM dbo.BJReturV3Item_d it
        LEFT JOIN dbo.BJReturV3Turnover_d tv
          ON tv.IdItem = it.IdItem AND tv.NoRetur = @No
        WHERE it.NoRetur = @No
        GROUP BY it.IdItem, it.Pcs
      `);
    const aggByItem = new Map(
      (turnoverRes.recordset || []).map((r) => [
        r.IdItem,
        { targetPcs: Number(r.TargetPcs || 0), scannedPcs: Number(r.ScannedPcs || 0) },
      ]),
    );
    itemsWithExtra = items.map((it) => {
      const agg = aggByItem.get(it.IdItem);
      return {
        ...it,
        TurnoverTargetPcs: agg?.targetPcs || 0,
        TurnoverScannedPcs: agg?.scannedPcs || 0,
        TurnoverRemainingPcs: Math.max(0, (agg?.targetPcs || 0) - (agg?.scannedPcs || 0)),
        TurnoverFulfilled: !!agg && agg.targetPcs > 0 && agg.scannedPcs === agg.targetPcs,
      };
    });
  }

  return {
    ...header,
    Tanggal: formatYMD(header.Tanggal),
    items: itemsWithExtra,
  };
};

// ---------------------------------------------------------------------------
// HEADER CRUD
// ---------------------------------------------------------------------------

exports.createHeader = async (payload, ctx) => {
  const { tanggal, idPembeli, keterangan } = payload || {};
  const must = [];
  if (!tanggal) must.push("tanggal");
  if (idPembeli == null || idPembeli === "") must.push("idPembeli");
  if (must.length) throw badReq(`Field wajib: ${must.join(", ")}`);

  const idPembeliNum = Number(idPembeli);
  if (!Number.isFinite(idPembeliNum) || idPembeliNum <= 0) {
    throw badReq("idPembeli tidak valid");
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const effectiveDate = resolveEffectiveDateForCreate(tanggal);
    await assertNotLocked({
      date: effectiveDate,
      runner: tx,
      action: "create Retur V3",
      useLock: true,
    });

    // NoRetur v3 melanjutkan sequence 'L.' yang SAMA dengan retur v1
    // (dbo.BJRetur_h) — bukan sequence terpisah — supaya tidak ada NoRetur
    // yang sama persis muncul di kedua tabel. generateNextCode() bawaan
    // cuma bisa cek satu tabel, jadi next-number dihitung manual dari MAX
    // gabungan kedua tabel di sini.
    const gen = async () => {
      const rq = new sql.Request(tx).input("prefix", sql.VarChar(50), "L.");
      const r = await rq.query(`
        SELECT TOP 1 Code FROM (
          SELECT NoRetur AS Code FROM dbo.BJRetur_h WITH (UPDLOCK, HOLDLOCK)
          WHERE NoRetur LIKE @prefix + '%'
          UNION ALL
          SELECT NoRetur AS Code FROM dbo.BJReturV3_h WITH (UPDLOCK, HOLDLOCK)
          WHERE NoRetur LIKE @prefix + '%'
        ) x
        ORDER BY TRY_CONVERT(BIGINT, SUBSTRING(Code, 3, 50)) DESC, Code DESC;
      `);
      const last = r.recordset?.[0]?.Code ? String(r.recordset[0].Code) : "";
      const lastNum = parseInt(last.substring(2), 10) || 0;
      return "L." + String(lastNum + 1).padStart(10, "0");
    };

    let noRetur = await gen();
    let exist = await new sql.Request(tx)
      .input("No", sql.VarChar(50), noRetur)
      .query(`
        SELECT 1 FROM dbo.BJRetur_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No
        UNION ALL
        SELECT 1 FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No
      `);
    if (exist.recordset.length > 0) {
      noRetur = await gen();
      exist = await new sql.Request(tx)
        .input("No", sql.VarChar(50), noRetur)
        .query(`
          SELECT 1 FROM dbo.BJRetur_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No
          UNION ALL
          SELECT 1 FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No
        `);
      if (exist.recordset.length > 0) throw conflict("Gagal generate NoRetur unik, coba lagi");
    }

    await new sql.Request(tx)
      .input("NoRetur", sql.VarChar(50), noRetur)
      .input("Tanggal", sql.Date, effectiveDate)
      .input("IdPembeli", sql.Int, idPembeliNum)
      .input("Keterangan", sql.NVarChar(500), keterangan ?? null)
      .input("CreateBy", sql.VarChar(50), actorUsername).query(`
        INSERT INTO dbo.BJReturV3_h (
          NoRetur, Tanggal, IdPembeli, Keterangan, StatusRetur, CreateBy
        ) VALUES (
          @NoRetur, @Tanggal, @IdPembeli, @Keterangan, 'PENDING', @CreateBy
        )
      `);

    await tx.commit();

    return {
      noRetur,
      tanggal: formatYMD(effectiveDate),
      idPembeli: idPembeliNum,
      keterangan: keterangan ?? null,
      statusRetur: "PENDING",
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.updateHeader = async (noRetur, payload, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const { docDateOnly: oldDocDateOnly, row: headerRow } = await loadDocDateOnlyFromConfig({
      entityKey: "returnV3",
      codeValue: no,
      runner: tx,
      useLock: true,
      throwIfNotFound: false,
    });
    if (!headerRow) throw notFound(`NoRetur ${no} tidak ditemukan`);

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "PENDING") {
      throw conflict("Header sudah diputuskan, tidak bisa diupdate");
    }

    await assertNotLocked({
      date: oldDocDateOnly,
      runner: tx,
      action: "update Retur V3 (current date)",
      useLock: true,
    });

    const sets = [];
    const rq = new sql.Request(tx);

    if (payload?.tanggal !== undefined) {
      if (!payload.tanggal) throw badReq("tanggal tidak boleh kosong");
      const effectiveDate = resolveEffectiveDateForCreate(payload.tanggal);
      await assertNotLocked({
        date: effectiveDate,
        runner: tx,
        action: "update Retur V3 (new date)",
        useLock: true,
      });
      sets.push("Tanggal=@Tanggal");
      rq.input("Tanggal", sql.Date, effectiveDate);
    }

    if (payload?.idPembeli !== undefined) {
      if (payload.idPembeli == null || payload.idPembeli === "") {
        throw badReq("idPembeli tidak boleh kosong");
      }
      const idPembeliNum = Number(payload.idPembeli);
      if (!Number.isFinite(idPembeliNum) || idPembeliNum <= 0) {
        throw badReq("idPembeli tidak valid");
      }
      sets.push("IdPembeli=@IdPembeli");
      rq.input("IdPembeli", sql.Int, idPembeliNum);
    }

    if (payload?.keterangan !== undefined) {
      sets.push("Keterangan=@Keterangan");
      rq.input("Keterangan", sql.NVarChar(500), payload.keterangan ?? null);
    }

    if (sets.length === 0) throw badReq("Tidak ada field yang diupdate");

    rq.input("No", sql.VarChar(50), no);
    await rq.query(`UPDATE dbo.BJReturV3_h SET ${sets.join(", ")} WHERE NoRetur=@No`);

    await tx.commit();
    return { noRetur: no, audit: { actorId, requestId } };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.deleteHeader = async (noRetur, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const { docDateOnly, row: headerRow } = await loadDocDateOnlyFromConfig({
      entityKey: "returnV3",
      codeValue: no,
      runner: tx,
      useLock: true,
      throwIfNotFound: false,
    });
    if (!headerRow) throw notFound(`NoRetur ${no} tidak ditemukan`);

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "PENDING") {
      throw conflict("Header sudah diputuskan, tidak bisa dihapus");
    }

    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete Retur V3",
      useLock: true,
    });

    const itemsRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT IdItem, GeneratedLabelCode FROM dbo.BJReturV3Item_d WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const items = itemsRes.recordset || [];

    if (items.some((it) => it.GeneratedLabelCode)) {
      throw conflict("Tidak bisa hapus: ada item yang sudah generate label");
    }

    if (items.length > 0) {
      const turnoverRes = await new sql.Request(tx)
        .input("No", sql.VarChar(50), no)
        .query(`SELECT TOP 1 1 AS x FROM dbo.BJReturV3Turnover_d WHERE NoRetur=@No`);
      if (turnoverRes.recordset.length > 0) {
        throw conflict("Tidak bisa hapus: ada turnover scan pada item");
      }

      await new sql.Request(tx)
        .input("No", sql.VarChar(50), no)
        .query(`DELETE FROM dbo.BJReturV3Item_d WHERE NoRetur=@No`);
    }

    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(`DELETE FROM dbo.BJReturV3_h WHERE NoRetur=@No`);

    await tx.commit();
    return { noRetur: no, audit: { actorId, requestId } };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

// ---------------------------------------------------------------------------
// ITEM CRUD
// ---------------------------------------------------------------------------

exports.addItems = async (noRetur, items, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Array.isArray(items) || items.length === 0) {
    throw badReq("items wajib berisi minimal 1 item");
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    assertKodeKategori(it.kodeKategori, `items[${i}].kodeKategori`);
    assertKategoriInput(it.kategoriInput, `items[${i}].kategoriInput`);
    const pcsNum = Number(it.pcs);
    if (!Number.isFinite(pcsNum) || pcsNum <= 0 || !Number.isInteger(pcsNum)) {
      throw badReq(`items[${i}].pcs wajib bilangan bulat positif`);
    }
    const idJenisNum = Number(it.idJenis);
    if (!Number.isFinite(idJenisNum) || idJenisNum <= 0) {
      throw badReq(`items[${i}].idJenis wajib diisi`);
    }
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "PENDING") {
      throw conflict("Header sudah diputuskan, tidak bisa menambah item");
    }

    const createdIds = [];
    for (const it of items) {
      const ok = await jenisExists(tx, it.kodeKategori, Number(it.idJenis));
      if (!ok) {
        throw badReq(
          `idJenis ${it.idJenis} tidak ditemukan untuk kategori ${it.kodeKategori}`,
        );
      }

      const ins = await new sql.Request(tx)
        .input("NoRetur", sql.VarChar(50), no)
        .input("KodeKategori", sql.VarChar(20), it.kodeKategori)
        .input("IdJenis", sql.Int, Number(it.idJenis))
        .input("Pcs", sql.Int, Math.trunc(Number(it.pcs)))
        .input("KategoriInput", sql.VarChar(10), it.kategoriInput)
        .input("CreateBy", sql.VarChar(50), actorUsername).query(`
          INSERT INTO dbo.BJReturV3Item_d (NoRetur, KodeKategori, IdJenis, Pcs, KategoriInput, CreateBy)
          OUTPUT INSERTED.IdItem
          VALUES (@NoRetur, @KodeKategori, @IdJenis, @Pcs, @KategoriInput, @CreateBy)
        `);
      createdIds.push(ins.recordset[0].IdItem);
    }

    // Ambil ulang dengan JOIN ke master (NamaJenis) supaya response langsung
    // membawa nama, bukan cuma IdJenis mentah — konsisten dengan getDetail().
    const idsJson = JSON.stringify(createdIds.map((id) => ({ id })));
    const createdRes = await new sql.Request(tx).input(
      "IdsJson",
      sql.NVarChar(sql.MAX),
      idsJson,
    ).query(`
      SELECT
        it.IdItem, it.NoRetur, it.KodeKategori, it.IdJenis, it.Pcs,
        it.KategoriInput, it.Berat, it.IdReject, it.GeneratedLabelCode,
        CASE
          WHEN it.KodeKategori = 'barangjadi' THEN mbj.NamaBJ
          WHEN it.KodeKategori = 'furniturewip' THEN mcw.Nama
        END AS NamaJenis,
        mr.NamaReject
      FROM dbo.BJReturV3Item_d it
      LEFT JOIN dbo.MstBarangJadi mbj ON mbj.IdBJ = it.IdJenis AND it.KodeKategori = 'barangjadi'
      LEFT JOIN dbo.MstCabinetWIP mcw ON mcw.IdCabinetWIP = it.IdJenis AND it.KodeKategori = 'furniturewip'
      LEFT JOIN dbo.MstReject mr ON mr.IdReject = it.IdReject
      WHERE it.IdItem IN (
        SELECT j.id FROM OPENJSON(@IdsJson) WITH (id int '$.id') AS j
      )
      ORDER BY it.IdItem ASC
    `);

    await tx.commit();
    return {
      noRetur: no,
      items: createdRes.recordset || [],
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.updateItem = async (noRetur, idItem, payload, ctx) => {
  const no = String(noRetur || "").trim();
  const idItemNum = Number(idItem);
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Number.isFinite(idItemNum)) throw badReq("idItem tidak valid");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "PENDING") {
      throw conflict("Header sudah diputuskan, tidak bisa mengubah item");
    }

    const itemRes = await new sql.Request(tx)
      .input("Id", sql.Int, idItemNum)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT * FROM dbo.BJReturV3Item_d WITH (UPDLOCK,HOLDLOCK) WHERE IdItem=@Id AND NoRetur=@No`,
      );
    const item = itemRes.recordset[0];
    if (!item) throw notFound(`Item ${idItemNum} tidak ditemukan pada retur ${no}`);

    const kodeKategori = payload?.kodeKategori !== undefined ? payload.kodeKategori : item.KodeKategori;
    const idJenis = payload?.idJenis !== undefined ? Number(payload.idJenis) : item.IdJenis;
    const pcs = payload?.pcs !== undefined ? Number(payload.pcs) : item.Pcs;
    const kategoriInput = payload?.kategoriInput !== undefined ? payload.kategoriInput : item.KategoriInput;

    assertKodeKategori(kodeKategori);
    assertKategoriInput(kategoriInput);
    if (!Number.isFinite(pcs) || pcs <= 0 || !Number.isInteger(pcs)) {
      throw badReq("pcs wajib bilangan bulat positif");
    }
    if (!Number.isFinite(idJenis) || idJenis <= 0) {
      throw badReq("idJenis wajib diisi");
    }

    const ok = await jenisExists(tx, kodeKategori, idJenis);
    if (!ok) throw badReq(`idJenis ${idJenis} tidak ditemukan untuk kategori ${kodeKategori}`);

    await new sql.Request(tx)
      .input("Id", sql.Int, idItemNum)
      .input("KodeKategori", sql.VarChar(20), kodeKategori)
      .input("IdJenis", sql.Int, idJenis)
      .input("Pcs", sql.Int, Math.trunc(pcs))
      .input("KategoriInput", sql.VarChar(10), kategoriInput).query(`
        UPDATE dbo.BJReturV3Item_d
        SET KodeKategori=@KodeKategori, IdJenis=@IdJenis, Pcs=@Pcs, KategoriInput=@KategoriInput
        WHERE IdItem=@Id
      `);

    // Ambil ulang dengan JOIN ke master (NamaJenis) supaya response langsung
    // membawa nama, bukan cuma id — konsisten dengan getDetail()/addItems().
    const updatedRes = await new sql.Request(tx).input("Id", sql.Int, idItemNum)
      .query(`
        SELECT
          it.IdItem, it.NoRetur, it.KodeKategori, it.IdJenis, it.Pcs,
          it.KategoriInput, it.Berat, it.IdReject, it.GeneratedLabelCode,
          CASE
            WHEN it.KodeKategori = 'barangjadi' THEN mbj.NamaBJ
            WHEN it.KodeKategori = 'furniturewip' THEN mcw.Nama
          END AS NamaJenis,
          mr.NamaReject
        FROM dbo.BJReturV3Item_d it
        LEFT JOIN dbo.MstBarangJadi mbj ON mbj.IdBJ = it.IdJenis AND it.KodeKategori = 'barangjadi'
        LEFT JOIN dbo.MstCabinetWIP mcw ON mcw.IdCabinetWIP = it.IdJenis AND it.KodeKategori = 'furniturewip'
        LEFT JOIN dbo.MstReject mr ON mr.IdReject = it.IdReject
        WHERE it.IdItem = @Id
      `);

    await tx.commit();
    return updatedRes.recordset[0];
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.deleteItem = async (noRetur, idItem, ctx) => {
  const no = String(noRetur || "").trim();
  const idItemNum = Number(idItem);
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Number.isFinite(idItemNum)) throw badReq("idItem tidak valid");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "PENDING") {
      throw conflict("Header sudah diputuskan, tidak bisa menghapus item");
    }

    const del = await new sql.Request(tx)
      .input("Id", sql.Int, idItemNum)
      .input("No", sql.VarChar(50), no)
      .query(`DELETE FROM dbo.BJReturV3Item_d WHERE IdItem=@Id AND NoRetur=@No`);
    if (!del.rowsAffected?.[0]) {
      throw notFound(`Item ${idItemNum} tidak ditemukan pada retur ${no}`);
    }

    await tx.commit();
    return { idItem: idItemNum, noRetur: no, audit: { actorId, requestId } };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

// ---------------------------------------------------------------------------
// EXPORT KE AS_GSU (AR_SalesReturnTransit + AR_SalesReturnTransitDetails)
// Dipanggil otomatis saat keputusan sales disimpan (decide), atau manual via
// POST /:noRetur/export-gsu. Idempotent-guard: jika NoRetur sudah pernah
// diekspor (Remarks = NoRetur di AR_SalesReturnTransit), proses ditolak.
// ---------------------------------------------------------------------------
const GSU_TRANSIT_DB = "AS_GSU_TEST5.dbo";

async function exportToGsuInTx(tx, noRetur, actorUsername, remarks = []) {
  const remarksByItem = new Map();
  if (Array.isArray(remarks)) {
    for (const r of remarks) {
      if (r && Number(r.idItem) > 0) {
        remarksByItem.set(Number(r.idItem), String(r.remark || "").trim());
      }
    }
  }

  // 0) Duplikat check — sudah pernah diekspor ke AS_GSU?
  const dup = await new sql.Request(tx)
    .input("No", sql.VarChar(50), noRetur).query(`
      SELECT 1
      FROM ${GSU_TRANSIT_DB}.AR_SalesReturnTransit WITH (UPDLOCK, HOLDLOCK)
      WHERE CAST(Remarks AS nvarchar(50)) = @No
    `);
  if (dup.recordset.length > 0) {
    throw conflict(`Retur ${noRetur} sudah pernah diekspor ke AS_GSU. Tidak boleh diproses lagi.`);
  }

  // 1) Data retur — conditional join ke master item sesuai KodeKategori
  const dataRes = await new sql.Request(tx)
    .input("No", sql.VarChar(50), noRetur).query(`
      SELECT
        A.NoRetur,
        A.Tanggal,
        F.CustomerID,
        F.CustomerName,
        COALESCE(BJ.IdBJ, D.IdCabinetWIP) AS MstItemId,
        B.IdItem,
        B.Pcs,
        G.ItemID,
        ${GSU_TRANSIT_DB}.UDF_Common_GetSmallestUOMLevel(
          G.UOMID1, G.UOMID2, G.UOMID3, G.UOMID4
        ) AS UOMLevel
      FROM dbo.BJReturV3_h A
      LEFT JOIN dbo.BJReturV3Item_d B ON B.NoRetur = A.NoRetur
      LEFT JOIN dbo.MstBarangJadi BJ ON BJ.IdBJ = B.IdJenis AND B.KodeKategori = 'barangjadi'
      LEFT JOIN dbo.MstCabinetWIP D ON D.IdCabinetWIP = B.IdJenis AND B.KodeKategori = 'furniturewip'
      LEFT JOIN dbo.MstPembeli E ON E.IdPembeli = A.IdPembeli
      LEFT JOIN ${GSU_TRANSIT_DB}.AR_Customers F ON F.CustomerCode = E.CustomerCode
      LEFT JOIN ${GSU_TRANSIT_DB}.IC_Items G ON G.ItemCode = COALESCE(BJ.ItemCode, D.ItemCode)
      WHERE A.NoRetur = @No
    `);
  const rows = dataRes.recordset || [];
  if (rows.length === 0) {
    return { exported: false, reason: "NO_DATA", message: "Tidak ada item yang cocok untuk diekspor ke AS_GSU." };
  }

  const customerId = rows[0].CustomerID;
  const tanggal = rows[0].Tanggal;

  // 2) Nomor urut TransitCounter per bulan (reset dari 1 tiap bulan)
  //    Prefix TransitNumber = SRT/MM/YY/ -> MAX per bulan retur tsb.
  const dt = new Date(tanggal);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = String(dt.getFullYear()).slice(-2);
  const prefix = `SRT/${mm}/${yy}/`;

  const seq = await new sql.Request(tx)
    .input("Prefix", sql.VarChar(10), prefix).query(`
      SELECT ISNULL(MAX(TransitCounter), 0) AS MaxCounter
      FROM ${GSU_TRANSIT_DB}.AR_SalesReturnTransit WITH (UPDLOCK, HOLDLOCK)
      WHERE TransitNumber LIKE @Prefix + '%'
    `);
  const counter = Number(seq.recordset[0].MaxCounter) + 1;

  // 3) TransitNumber = SRT/MM/YY/CCC (CCC 3 digit = TransitCounter bulan ini)
  const ccc = String(counter).padStart(3, "0");
  const transitNumber = `${prefix}${ccc}`;

  // 4) Insert header (TransitID identity auto; ambil lewat OUTPUT INSERTED)
  const headerIns = await new sql.Request(tx)
    .input("TransitNumber", sql.VarChar(50), transitNumber)
    .input("TransitDate", sql.Date, tanggal)
    .input("CustomerID", sql.Int, customerId)
    .input("Remarks", sql.VarChar(50), noRetur)
    .input("CreatedBy", sql.VarChar(50), "PPS")
    .input("ModifiedBy", sql.VarChar(50), "PPS")
    .input("TransitType", sql.VarChar(20), "SR")
    .input("TransitCounter", sql.Int, counter).query(`
      INSERT INTO ${GSU_TRANSIT_DB}.AR_SalesReturnTransit (
        TransitNumber, TransitDate, RegionID, CustomerID, Remarks,
        Void, Posted, CreatedBy, CreatedDate, ModifiedBy, ModifiedDate,
        WarehouseID, TransitType, TransitCounter, VoidDateTime, VoidBy, VoidReason
      ) OUTPUT INSERTED.TransitID
      VALUES (
        @TransitNumber, @TransitDate, 0, @CustomerID, @Remarks,
        0, 0, @CreatedBy, GETDATE(), @ModifiedBy, GETDATE(),
        0, @TransitType, @TransitCounter, NULL, NULL, NULL
      )
    `);
  const transitId = Number(headerIns.recordset[0].TransitID);

  // 5) Insert detail (TransitID = header; TransitDetailID identity auto)
  for (const row of rows) {
    const remark = remarksByItem.get(Number(row.IdItem)) ?? "";
    await new sql.Request(tx)
      .input("TransitID", sql.Int, transitId)
      .input("ItemID", sql.Int, Number(row.ItemID))
      .input("Quantity", sql.Int, Number(row.Pcs))
      .input("UOMLevel", sql.Int, Number(row.UOMLevel))
      .input("Remark", sql.NVarChar(500), remark).query(`
        INSERT INTO ${GSU_TRANSIT_DB}.AR_SalesReturnTransitDetails (
          TransitID, SourceInvoiceID, SourceInvoiceDetailID,
          ItemID, Quantity, UOMLevel, WarehouseID, Remarks,
          ImportedReturnID, ImportedReturnDetailID
        ) VALUES (
          @TransitID, 0, 0,
          @ItemID, @Quantity, @UOMLevel, 4, @Remark,
          0, 0
        )
      `);
  }

  return {
    exported: true,
    transitID: transitId,
    transitNumber,
    transitCounter: counter,
    transitDetailCount: rows.length,
  };
}

// Endpoint mandiri: POST /api/retur-v3/:noRetur/export-gsu
exports.exportToGsu = async (noRetur, body = {}, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorUsername } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const result = await exportToGsuInTx(tx, no, actorUsername, body.remarks);
    await tx.commit();
    return { noRetur: no, ...result };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

// ---------------------------------------------------------------------------
// DECISION
// ---------------------------------------------------------------------------

exports.decide = async (noRetur, decision, body = {}, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  if (!["DIGANTI", "TIDAK_DIGANTI"].includes(decision)) {
    throw badReq("decision wajib DIGANTI atau TIDAK_DIGANTI");
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "PENDING") {
      throw conflict("Header sudah diputuskan sebelumnya");
    }

    const itemCountRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(`SELECT COUNT(1) AS cnt FROM dbo.BJReturV3Item_d WHERE NoRetur=@No`);
    if (!(Number(itemCountRes.recordset[0].cnt) > 0)) {
      throw badReq("Header belum memiliki item, tidak bisa diputuskan");
    }

    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("Status", sql.VarChar(20), decision)
      .input("DecisionBy", sql.Int, actorId)
      .input("DecisionByUsername", sql.VarChar(100), actorUsername).query(`
        UPDATE dbo.BJReturV3_h
        SET StatusRetur=@Status, DecisionBy=@DecisionBy, DecisionByUsername=@DecisionByUsername, DecisionAt=SYSUTCDATETIME()
        WHERE NoRetur=@No
      `);

    // DIGANTI: turnover ("Item yang Dipickup") dicocokkan langsung ke
    // BJReturV3Item_d — like-for-like KodeKategori/IdJenis/Pcs. Tidak ada
    // tabel/seed target pengganti terpisah lagi.

    // Otomatis ekspor ke AS_GSU saat keputusan disimpan.
    // Jika retur ini sudah pernah diekspor, akan conflict (rollback).
    const exportResult = await exportToGsuInTx(tx, no, actorUsername, body.remarks);

    await tx.commit();
    return {
      noRetur: no,
      statusRetur: decision,
      export: exportResult,
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

// ---------------------------------------------------------------------------
// GENERATE LABEL (TIDAK_DIGANTI path)
// ---------------------------------------------------------------------------

exports.generateLabel = async (noRetur, idItem, body, ctx) => {
  const no = String(noRetur || "").trim();
  const idItemNum = Number(idItem);
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Number.isFinite(idItemNum)) throw badReq("idItem tidak valid");

  const pool = await poolPromise;
  const itemRes = await pool
    .request()
    .input("Id", sql.Int, idItemNum)
    .input("No", sql.VarChar(50), no)
    .query(`SELECT * FROM dbo.BJReturV3Item_d WHERE IdItem=@Id AND NoRetur=@No`);
  const item = itemRes.recordset[0];
  if (!item) throw notFound(`Item ${idItemNum} tidak ditemukan pada retur ${no}`);

  if (item.KategoriInput === "REJECT") {
    return generateRejectLabel(no, idItemNum, body, ctx);
  }
  if (item.KodeKategori === "barangjadi") {
    return generateBarangJadiLabel(no, idItemNum, ctx);
  }
  if (item.KodeKategori === "furniturewip") {
    return generateFurnitureWipLabel(no, idItemNum, ctx);
  }
  throw badReq(`KodeKategori ${item.KodeKategori} tidak didukung`);
};

// ---------------------------------------------------------------------------
// OUTPUTS
// ---------------------------------------------------------------------------

exports.getOutputs = async (noRetur) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;

  // Tidak ada tabel mapping output terpisah — GeneratedLabelCode di
  // BJReturV3Item_d menunjuk langsung ke NoBJ/NoFurnitureWIP/NoReject,
  // tergantung KodeKategori+KategoriInput item tsb, jadi cukup 1 query
  // dengan LEFT JOIN kondisional ke masing-masing tabel master.
  const res = await pool
    .request()
    .input("No", sql.VarChar(50), no).query(`
      SELECT
        it.GeneratedLabelCode AS LabelCode,
        COALESCE(bj.DateCreate, fw.DateCreate, r.DateCreate) AS DateCreate,
        COALESCE(mbj.NamaBJ, mcw.Nama, mr.NamaReject) AS NamaJenis,
        CASE WHEN it.KategoriInput = 'REJECT' THEN N'reject' ELSE it.KodeKategori END AS KodeKategori,
        CASE
          WHEN it.KategoriInput = 'REJECT' THEN N'Reject'
          WHEN it.KodeKategori = 'barangjadi' THEN N'Barang Jadi'
          ELSE N'Furniture WIP'
        END AS Kategori,
        CASE WHEN it.KategoriInput = 'REJECT' THEN N'kg' ELSE N'pcs' END AS Uom,
        COALESCE(bj.Blok, fw.Blok, r.Blok) AS Blok,
        COALESCE(bj.IdLokasi, fw.IdLokasi, r.IdLokasi) AS IdLokasi,
        CASE
          WHEN it.KategoriInput = 'REJECT' THEN ISNULL(r.Berat, 0)
          ELSE ISNULL(COALESCE(bj.Pcs, fw.Pcs), 0)
        END AS Qty,
        ISNULL(CAST(COALESCE(bj.HasBeenPrinted, fw.HasBeenPrinted, r.HasBeenPrinted) AS int), 0) AS HasBeenPrinted
      FROM dbo.BJReturV3Item_d it
      LEFT JOIN dbo.BarangJadi bj
        ON bj.NoBJ = it.GeneratedLabelCode AND it.KodeKategori = 'barangjadi' AND it.KategoriInput = 'BAGUS'
      LEFT JOIN dbo.MstBarangJadi mbj ON mbj.IdBJ = bj.IdBJ
      LEFT JOIN dbo.FurnitureWIP fw
        ON fw.NoFurnitureWIP = it.GeneratedLabelCode AND it.KodeKategori = 'furniturewip' AND it.KategoriInput = 'BAGUS'
      LEFT JOIN dbo.MstCabinetWIP mcw ON mcw.IdCabinetWIP = fw.IDFurnitureWIP
      LEFT JOIN dbo.RejectV2 r
        ON r.NoReject = it.GeneratedLabelCode AND it.KategoriInput = 'REJECT'
      LEFT JOIN dbo.MstReject mr ON mr.IdReject = r.IdReject
      WHERE it.NoRetur = @No AND it.GeneratedLabelCode IS NOT NULL
      ORDER BY it.GeneratedLabelCode ASC
    `);

  return res.recordset || [];
};

// ---------------------------------------------------------------------------
// TURNOVER (DIGANTI path) — scan mencocokkan LANGSUNG ke BJReturV3Item_d
// (barang yang kembali dipilih), like-for-like: KodeKategori + IdJenis,
// target pcs = it.Pcs. Tidak ada tabel target pengganti terpisah.
// ---------------------------------------------------------------------------

// Auto-detect: deteksi kategori+jenis label yang discan (cek BarangJadi lalu
// FurnitureWIP), lalu cari item retur yang KodeKategori+IdJenis-nya cocok dan
// masih punya sisa (Pcs - ScannedPcs > 0). Kalau ada beberapa item yang
// cocok, pilih IdItem paling kecil (ditambahkan paling awal) supaya
// deterministik.
exports.scanTurnoverAuto = async (noRetur, labelCode, ctx, options = {}) => {
  const no = String(noRetur || "").trim();
  const code = String(labelCode || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  if (!code) throw badReq("labelCode wajib diisi");
  const confirmPartial = options.confirmPartial === true;

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "DIGANTI") {
      throw conflict("Scan turnover hanya bisa dilakukan saat StatusRetur=DIGANTI");
    }

    const bjRes = await new sql.Request(tx).input("Code", sql.VarChar(50), code)
      .query(`
        SELECT NoBJ AS Code, IdBJ AS IdJenis, ISNULL(Pcs, 0) AS Pcs, DateUsage
        FROM dbo.BarangJadi WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBJ = @Code
      `);

    let kodeKategori = null;
    let label = null;

    if (bjRes.recordset.length > 0) {
      kodeKategori = "barangjadi";
      label = bjRes.recordset[0];
    } else {
      const fwRes = await new sql.Request(tx).input("Code", sql.VarChar(50), code)
        .query(`
          SELECT NoFurnitureWIP AS Code, IDFurnitureWIP AS IdJenis, ISNULL(Pcs, 0) AS Pcs, DateUsage
          FROM dbo.FurnitureWIP WITH (UPDLOCK, HOLDLOCK)
          WHERE NoFurnitureWIP = @Code
        `);
      if (fwRes.recordset.length > 0) {
        kodeKategori = "furniturewip";
        label = fwRes.recordset[0];
      }
    }

    if (!label) throw badReq(`Label ${code} tidak ditemukan`);
    if (label.DateUsage != null) throw badReq(`Label ${code} sudah terpakai`);

    // Sisa pcs label yang masih tersedia (Pcs parent dikurangi partial yang
    // sudah pernah dipecah dari label ini) — sama seperti penjualan.
    const parentAvail = await lockParentAndAvailablePcs(tx, kodeKategori, code);
    if (!parentAvail) {
      throw badReq(`Label ${code} tidak ditemukan atau sudah terpakai`);
    }
    if (parentAvail.availablePcs <= 0) {
      throw badReq(`Label ${code} sudah habis pcs-nya (sudah terpakai semua)`);
    }

    const candidatesRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("KodeKategori", sql.VarChar(20), kodeKategori)
      .input("IdJenis", sql.Int, Number(label.IdJenis)).query(`
        SELECT it.IdItem, it.Pcs,
          ISNULL((SELECT SUM(tv.Pcs) FROM dbo.BJReturV3Turnover_d tv WHERE tv.IdItem = it.IdItem), 0) AS ScannedPcs
        FROM dbo.BJReturV3Item_d it WITH (UPDLOCK, HOLDLOCK)
        WHERE it.NoRetur = @No AND it.KodeKategori = @KodeKategori AND it.IdJenis = @IdJenis
        ORDER BY it.IdItem ASC
      `);

    const candidate = (candidatesRes.recordset || []).find(
      (r) => Number(r.Pcs) - Number(r.ScannedPcs || 0) > 0,
    );

    if (!candidate) {
      throw badReq(
        `Tidak ada item retur yang cocok dengan label ${code} (jenis tidak ditemukan, atau kebutuhan sudah terpenuhi semua)`,
      );
    }

    const remaining = Number(candidate.Pcs) - Number(candidate.ScannedPcs || 0);

    let consumedPcs;
    let noPartial = null;
    let wasPartialSplit = false;

    if (parentAvail.availablePcs <= remaining) {
      // Pcs label pas atau kurang dari sisa kebutuhan item — pakai semua sisa
      // pcs label ini, tandai parent fully-consumed.
      consumedPcs = parentAvail.availablePcs;
      await markParentFullyUsed(tx, kodeKategori, code);
      // Kalau label ini SUDAH pernah dipecah sebelumnya, sisa terakhirnya
      // pun dicatat sebagai baris partial — supaya SETIAP konsumsi atas
      // label ber-partial punya NoPartial (paritas dengan penjualan).
      if (parentAvail.parentPcs > parentAvail.availablePcs) {
        noPartial = await createPartial(tx, kodeKategori, code, consumedPcs);
        wasPartialSplit = true;
      }
    } else if (!confirmPartial) {
      // Pcs label melebihi sisa kebutuhan item — jangan langsung tolak, minta
      // konfirmasi user dulu apakah mau dipecah (partial) sejumlah sisa
      // kebutuhan. Tidak ada perubahan data, rollback transaksi ini.
      await tx.rollback();
      return {
        needsConfirmation: true,
        noRetur: no,
        kodeKategori,
        idJenis: Number(label.IdJenis),
        labelCode: code,
        availablePcs: parentAvail.availablePcs,
        pcsNeeded: remaining,
        message:
          `Label ${code} berisi ${parentAvail.availablePcs} pcs, sedangkan sisa kebutuhan ` +
          `item ini hanya ${remaining} pcs. Pecah (partial) label ini menjadi ${remaining} pcs ` +
          `agar bisa dipakai untuk retur ${no}? Sisa ${parentAvail.availablePcs - remaining} pcs ` +
          `tetap tersedia di label asal untuk dipakai kebutuhan lain.`,
      };
    } else {
      // User sudah konfirmasi — pecah label jadi partial sejumlah sisa
      // kebutuhan item. LabelCode yang dicatat TETAP kode label asli.
      consumedPcs = remaining;
      noPartial = await createPartial(tx, kodeKategori, code, remaining);
      wasPartialSplit = true;
    }

    await new sql.Request(tx)
      .input("NoRetur", sql.VarChar(50), no)
      .input("IdItem", sql.Int, candidate.IdItem)
      .input("LabelCode", sql.VarChar(50), code)
      .input("NoPartial", sql.VarChar(50), noPartial)
      .input("Pcs", sql.Int, consumedPcs)
      .input("ScanBy", sql.VarChar(50), actorUsername).query(`
        INSERT INTO dbo.BJReturV3Turnover_d (NoRetur, IdItem, LabelCode, NoPartial, Pcs, ScanBy)
        OUTPUT INSERTED.IdTurnover
        VALUES (@NoRetur, @IdItem, @LabelCode, @NoPartial, @Pcs, @ScanBy)
      `);

    await tx.commit();
    return {
      noRetur: no,
      idItem: candidate.IdItem,
      kodeKategori,
      idJenis: Number(label.IdJenis),
      labelCode: code,
      noPartial,
      partialCode: noPartial,
      wasPartialSplit,
      pcs: consumedPcs,
      scannedPcs: Number(candidate.ScannedPcs || 0) + consumedPcs,
      targetPcs: Number(candidate.Pcs),
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.undoScan = async (noRetur, idTurnover, ctx) => {
  const no = String(noRetur || "").trim();
  const idTurnoverNum = Number(idTurnover);
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Number.isFinite(idTurnoverNum)) throw badReq("idTurnover tidak valid");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur, IsComplete FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.IsComplete) {
      throw conflict("Retur sudah ditandai selesai, tidak bisa membatalkan scan");
    }

    const turnoverRes = await new sql.Request(tx)
      .input("Id", sql.Int, idTurnoverNum)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT tv.*, it.KodeKategori
         FROM dbo.BJReturV3Turnover_d tv WITH (UPDLOCK,HOLDLOCK)
         INNER JOIN dbo.BJReturV3Item_d it ON it.IdItem = tv.IdItem
         WHERE tv.IdTurnover=@Id AND tv.NoRetur=@No`,
      );
    const turnover = turnoverRes.recordset[0];
    if (!turnover) throw notFound(`Turnover ${idTurnoverNum} tidak ditemukan`);

    const cfg = PARTIAL_CONFIG[turnover.KodeKategori];

    if (turnover.NoPartial) {
      // Baris ini memecah partial. Urai: (1) tentukan dulu apakah label sudah
      // "fully accounted" (DateUsage ke-set & total partial >= Pcs parent) —
      // itu tanda scan ini yang men-stamp DateUsage lewat markParentFullyUsed;
      // (2) hapus baris *Partial; (3) hitung ulang IsPartial parent;
      // (4) clear DateUsage HANYA kalau (1) benar.
      const parentRes = await new sql.Request(tx)
        .input("Code", sql.VarChar(50), turnover.LabelCode).query(`
          SELECT p.Pcs AS ParentPcs, p.DateUsage,
            ISNULL((SELECT SUM(pp.Pcs) FROM dbo.${cfg.partialTable} pp
                    WHERE pp.${cfg.partialParentColumn} = p.${cfg.parentColumn}), 0) AS PartialPcs
          FROM dbo.${cfg.parentTable} p WITH (UPDLOCK, HOLDLOCK)
          WHERE p.${cfg.parentColumn} = @Code
        `);
      const p = parentRes.recordset[0];
      const fullyAccounted =
        !!p &&
        p.DateUsage != null &&
        Math.round(Number(p.PartialPcs || 0)) >= Math.round(Number(p.ParentPcs || 0));

      await new sql.Request(tx)
        .input("NoPartial", sql.VarChar(50), turnover.NoPartial)
        .query(
          `DELETE FROM dbo.${cfg.partialTable} WHERE ${cfg.partialColumn} = @NoPartial`,
        );

      await new sql.Request(tx)
        .input("Code", sql.VarChar(50), turnover.LabelCode).query(`
          UPDATE dbo.${cfg.parentTable}
          SET IsPartial = CASE WHEN EXISTS (
                SELECT 1 FROM dbo.${cfg.partialTable}
                WHERE ${cfg.partialParentColumn} = @Code
              ) THEN 1 ELSE 0 END
          WHERE ${cfg.parentColumn} = @Code
        `);

      if (fullyAccounted) {
        await new sql.Request(tx)
          .input("Code", sql.VarChar(50), turnover.LabelCode).query(`
            UPDATE dbo.${cfg.parentTable} SET DateUsage = NULL
            WHERE ${cfg.parentColumn} = @Code AND DateUsage IS NOT NULL
          `);
      }
    } else {
      // Konsumsi 1x-penuh label utuh — scan ini yang men-stamp DateUsage.
      await new sql.Request(tx)
        .input("Code", sql.VarChar(50), turnover.LabelCode)
        .query(
          `UPDATE dbo.${cfg.parentTable} SET DateUsage = NULL WHERE ${cfg.parentColumn} = @Code`,
        );
    }

    await new sql.Request(tx)
      .input("Id", sql.Int, idTurnoverNum)
      .query(`DELETE FROM dbo.BJReturV3Turnover_d WHERE IdTurnover=@Id`);

    await tx.commit();
    return { noRetur: no, idTurnover: idTurnoverNum, audit: { actorId, requestId } };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};

exports.getTurnover = async (noRetur) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;

  const itemsRes = await pool
    .request()
    .input("No", sql.VarChar(50), no).query(`
      SELECT
        it.IdItem, it.Pcs, it.KodeKategori, it.IdJenis,
        CASE
          WHEN it.KodeKategori = 'barangjadi' THEN mbj.NamaBJ
          WHEN it.KodeKategori = 'furniturewip' THEN mcw.Nama
        END AS NamaJenis
      FROM dbo.BJReturV3Item_d it
      LEFT JOIN dbo.MstBarangJadi mbj ON mbj.IdBJ = it.IdJenis AND it.KodeKategori = 'barangjadi'
      LEFT JOIN dbo.MstCabinetWIP mcw ON mcw.IdCabinetWIP = it.IdJenis AND it.KodeKategori = 'furniturewip'
      WHERE it.NoRetur=@No
      ORDER BY it.IdItem ASC
    `);
  const items = itemsRes.recordset || [];
  if (items.length === 0) return [];

  const scansRes = await pool
    .request()
    .input("No", sql.VarChar(50), no).query(`
      SELECT IdTurnover, IdItem, LabelCode, NoPartial, Pcs, DateTimeScan
      FROM dbo.BJReturV3Turnover_d
      WHERE NoRetur=@No
      ORDER BY IdItem ASC, IdTurnover ASC
    `);
  const scans = scansRes.recordset || [];

  // Satu baris turnover per item retur (like-for-like): targetPcs = it.Pcs.
  return items.map((it) => {
    const itemScans = scans.filter((s) => s.IdItem === it.IdItem);
    const scannedPcs = itemScans.reduce((sum, s) => sum + Number(s.Pcs || 0), 0);
    return {
      idItem: it.IdItem,
      kodeKategoriAsal: it.KodeKategori,
      idJenisAsal: it.IdJenis,
      namaJenisAsal: it.NamaJenis,
      pcsAsal: Number(it.Pcs),
      scannedPcs,
      scans: itemScans.map((s) => ({
        idTurnover: s.IdTurnover,
        labelCode: s.LabelCode,
        noPartial: s.NoPartial ?? null,
        pcs: Number(s.Pcs),
        dateTimeScan: s.DateTimeScan,
      })),
    };
  });
};

// ---------------------------------------------------------------------------
// MARK COMPLETE
// ---------------------------------------------------------------------------

exports.markComplete = async (noRetur, ctx) => {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), { actorId, actorUsername, requestId });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .query(
        `SELECT StatusRetur, IsComplete FROM dbo.BJReturV3_h WITH (UPDLOCK,HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${no} tidak ditemukan`);
    if (header.StatusRetur !== "DIGANTI") {
      throw conflict("Retur hanya bisa ditandai selesai saat StatusRetur=DIGANTI");
    }
    if (header.IsComplete) {
      throw conflict("Retur sudah ditandai selesai sebelumnya");
    }

    // Setiap item retur harus terpenuhi: SUM(scan pcs) untuk item itu == it.Pcs.
    const unfulfilledRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), no).query(`
        SELECT it.IdItem, it.Pcs, ISNULL(s.ScannedPcs, 0) AS ScannedPcs
        FROM dbo.BJReturV3Item_d it
        LEFT JOIN (
          SELECT IdItem, SUM(Pcs) AS ScannedPcs
          FROM dbo.BJReturV3Turnover_d
          WHERE NoRetur = @No
          GROUP BY IdItem
        ) s ON s.IdItem = it.IdItem
        WHERE it.NoRetur = @No
          AND ISNULL(s.ScannedPcs, 0) <> it.Pcs
      `);
    if (unfulfilledRes.recordset.length > 0) {
      throw conflict(
        `Tidak bisa ditandai selesai: masih ada item yang belum fully scanned (${unfulfilledRes.recordset.length} item)`,
      );
    }

    await new sql.Request(tx)
      .input("No", sql.VarChar(50), no)
      .input("CompletedBy", sql.Int, actorId)
      .input("CompletedByUsername", sql.VarChar(100), actorUsername).query(`
        UPDATE dbo.BJReturV3_h
        SET IsComplete=1, CompletedBy=@CompletedBy, CompletedByUsername=@CompletedByUsername, CompletedAt=SYSUTCDATETIME()
        WHERE NoRetur=@No
      `);

    await tx.commit();
    return { noRetur: no, isComplete: true, audit: { actorId, requestId } };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};
