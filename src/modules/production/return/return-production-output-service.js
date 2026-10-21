// Output (label baru) untuk retur lama (BJRetur_h): label dibuat langsung ke
// tabel masing-masing (BarangJadi / FurnitureWIP / BarangDagang) lalu diikat
// ke NoRetur lewat BJReturBarangJadi_d / BJReturFurnitureWIP_d /
// BJReturBarangDagang_d — meniru alur import-as-gsu tetapi dari input manual.
const { sql, poolPromise } = require("../../../core/config/db");
const {
  assertNotLocked,
  loadDocDateOnlyFromConfig,
} = require("../../../core/shared/tutup-transaksi-guard");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const { badReq, notFound } = require("../../../core/utils/http-error");

// Item retur lama tidak membawa supplier, sedangkan dbo.BarangDagang.IdSupplier
// NOT NULL — sama seperti retur v3, dipakai supplier tetap ini.
const RETUR_ID_SUPPLIER = 38;
const MAX_LABEL_PER_ITEM = 50;

const CATEGORIES = {
  barangjadi: {
    table: "BarangJadi",
    column: "NoBJ",
    prefix: "BA.",
    detailTable: "BJReturBarangJadi_d",
    master: "SELECT 1 FROM dbo.MstBarangJadi WHERE IdBJ=@Id",
  },
  furniturewip: {
    table: "FurnitureWIP",
    column: "NoFurnitureWIP",
    prefix: "BB.",
    detailTable: "BJReturFurnitureWIP_d",
    master: "SELECT 1 FROM dbo.MstCabinetWIP WHERE IdCabinetWIP=@Id",
  },
  barangdagang: {
    table: "BarangDagang",
    column: "NoBarangDagang",
    prefix: "BD.",
    detailTable: "BJReturBarangDagang_d",
    master: "SELECT 1 FROM dbo.MstBarangDagang WHERE IdBarangDagang=@Id",
  },
};

async function insertLabel(tx, kodeKategori, noLabel, idJenis, qty, tanggal, username) {
  const rq = new sql.Request(tx)
    .input("No", sql.VarChar(50), noLabel)
    .input("IdJenis", sql.Int, idJenis)
    .input("Tanggal", sql.Date, tanggal)
    .input("CreateBy", sql.VarChar(50), username);

  if (kodeKategori === "barangjadi") {
    await rq.input("Pcs", sql.Int, Math.trunc(qty)).query(`
      INSERT INTO dbo.BarangJadi (NoBJ, IdBJ, DateCreate, Jam, Pcs, CreateBy, DateTimeCreate)
      VALUES (@No, @IdJenis, @Tanggal, CONVERT(TIME, GETDATE()), @Pcs, @CreateBy, GETDATE())
    `);
  } else if (kodeKategori === "furniturewip") {
    await rq.input("Pcs", sql.Int, Math.trunc(qty)).query(`
      INSERT INTO dbo.FurnitureWIP (NoFurnitureWIP, IDFurnitureWIP, DateCreate, Pcs, CreateBy, DateTimeCreate)
      VALUES (@No, @IdJenis, @Tanggal, @Pcs, @CreateBy, GETDATE())
    `);
  } else {
    await rq
      .input("IdSupplier", sql.Int, RETUR_ID_SUPPLIER)
      .input("Qty", sql.Decimal(18, 3), qty).query(`
        INSERT INTO dbo.BarangDagang (
          NoBarangDagang, IdSupplier, IdBarangDagang, Qty, Keterangan,
          IsPartial, DateUsage, CreateBy, CreatedAt
        ) VALUES (
          @No, @IdSupplier, @IdJenis, @Qty, N'Retur',
          0, NULL, @CreateBy, @Tanggal
        )
      `);
  }
}

/**
 * items: [{ kodeKategori, idJenis, qty, jumlahLabel? }]
 * Tiap item menghasilkan `jumlahLabel` label (default 1), masing-masing
 * berisi `qty` pcs.
 */
async function addOutputs(noRetur, items, username) {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  if (!Array.isArray(items) || items.length === 0) {
    throw badReq("items wajib diisi");
  }

  const parsed = items.map((it, i) => {
    const kodeKategori = String(it?.kodeKategori || "").toLowerCase();
    const cfg = CATEGORIES[kodeKategori];
    if (!cfg) {
      throw badReq(
        `items[${i}].kodeKategori wajib salah satu dari: ${Object.keys(CATEGORIES).join(", ")}`,
      );
    }
    const idJenis = Number(it.idJenis);
    const qty = Number(it.qty);
    const jumlahLabel = it.jumlahLabel == null ? 1 : Number(it.jumlahLabel);
    if (!Number.isInteger(idJenis) || idJenis <= 0) {
      throw badReq(`items[${i}].idJenis tidak valid`);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw badReq(`items[${i}].qty harus lebih dari 0`);
    }
    if (kodeKategori !== "barangdagang" && !Number.isInteger(qty)) {
      throw badReq(`items[${i}].qty harus bilangan bulat`);
    }
    if (
      !Number.isInteger(jumlahLabel) ||
      jumlahLabel < 1 ||
      jumlahLabel > MAX_LABEL_PER_ITEM
    ) {
      throw badReq(`items[${i}].jumlahLabel harus 1-${MAX_LABEL_PER_ITEM}`);
    }
    return { kodeKategori, cfg, idJenis, qty, jumlahLabel };
  });

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "return",
      codeValue: no,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "create output BJRetur",
      useLock: true,
    });

    const created = [];
    for (const it of parsed) {
      const exists = await new sql.Request(tx)
        .input("Id", sql.Int, it.idJenis)
        .query(it.cfg.master);
      if (exists.recordset.length === 0) {
        throw badReq(`Jenis ${it.kodeKategori} #${it.idJenis} tidak ditemukan`);
      }

      for (let n = 0; n < it.jumlahLabel; n++) {
        const noLabel = await generateNextCode(tx, {
          tableName: `dbo.${it.cfg.table}`,
          columnName: it.cfg.column,
          prefix: it.cfg.prefix,
          width: 10,
        });
        await insertLabel(
          tx,
          it.kodeKategori,
          noLabel,
          it.idJenis,
          it.qty,
          docDateOnly,
          username,
        );
        await new sql.Request(tx)
          .input("NoRetur", sql.VarChar(13), no)
          .input("NoLabel", sql.VarChar(50), noLabel).query(`
            INSERT INTO dbo.${it.cfg.detailTable} (NoRetur, ${it.cfg.column})
            VALUES (@NoRetur, @NoLabel)
          `);
        created.push({
          labelCode: noLabel,
          kodeKategori: it.kodeKategori,
          idJenis: it.idJenis,
          qty: it.qty,
        });
      }
    }

    await tx.commit();
    return { noRetur: no, created };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
}

/** Hapus 1 label output (hanya yang belum terpakai). */
async function deleteOutput(noRetur, kodeKategori, labelCode) {
  const no = String(noRetur || "").trim();
  const code = String(labelCode || "").trim();
  const cfg = CATEGORIES[String(kodeKategori || "").toLowerCase()];
  if (!no || !code) throw badReq("noRetur dan labelCode wajib diisi");
  if (!cfg) throw badReq("kodeKategori tidak valid");

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const { docDateOnly } = await loadDocDateOnlyFromConfig({
      entityKey: "return",
      codeValue: no,
      runner: tx,
      useLock: true,
      throwIfNotFound: true,
    });
    await assertNotLocked({
      date: docDateOnly,
      runner: tx,
      action: "delete output BJRetur",
      useLock: true,
    });

    const link = await new sql.Request(tx)
      .input("NoRetur", sql.VarChar(13), no)
      .input("NoLabel", sql.VarChar(50), code).query(`
        SELECT 1 FROM dbo.${cfg.detailTable} WITH (UPDLOCK, HOLDLOCK)
        WHERE NoRetur = @NoRetur AND ${cfg.column} = @NoLabel
      `);
    if (link.recordset.length === 0) {
      throw notFound(`Label ${code} tidak ditemukan pada retur ${no}`);
    }

    const label = await new sql.Request(tx).input("NoLabel", sql.VarChar(50), code)
      .query(`
        SELECT DateUsage FROM dbo.${cfg.table} WITH (UPDLOCK, HOLDLOCK)
        WHERE ${cfg.column} = @NoLabel
      `);
    if (label.recordset[0]?.DateUsage != null) {
      throw badReq(`Label ${code} sudah terpakai, tidak bisa dihapus`);
    }

    await new sql.Request(tx)
      .input("NoRetur", sql.VarChar(13), no)
      .input("NoLabel", sql.VarChar(50), code).query(`
        DELETE FROM dbo.${cfg.detailTable}
        WHERE NoRetur = @NoRetur AND ${cfg.column} = @NoLabel;
        DELETE FROM dbo.${cfg.table} WHERE ${cfg.column} = @NoLabel;
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

async function getReturnDetail(noRetur) {
  const no = String(noRetur || "").trim();
  if (!no) throw badReq("noRetur wajib diisi");
  const pool = await poolPromise;
  const res = await pool.request().input("No", sql.VarChar(13), no).query(`
    SELECT
      h.NoRetur, h.Invoice, h.Tanggal, h.IdPembeli, p.NamaPembeli,
      h.idWarehouse AS IdWarehouse, h.NoBJSortir
    FROM dbo.BJRetur_h h
    LEFT JOIN dbo.MstPembeli p ON p.IdPembeli = h.IdPembeli
    WHERE h.NoRetur = @No
  `);
  const row = res.recordset[0];
  if (!row) throw notFound(`NoRetur ${no} tidak ditemukan`);
  return row;
}

module.exports = { addOutputs, deleteOutput, getReturnDetail };
