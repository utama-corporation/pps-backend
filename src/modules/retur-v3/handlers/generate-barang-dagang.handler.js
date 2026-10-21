// src/modules/retur-v3/handlers/generate-barang-dagang.handler.js
const { sql, poolPromise } = require("../../../core/config/db");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const { badReq, conflict, notFound } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const barangDagangReadRepo = require("../../label/barang-dagang/repositories/barang-dagang-read.repository");
const barangDagangWriteRepo = require("../../label/barang-dagang/repositories/barang-dagang-write.repository");

// Item retur tidak membawa supplier, sedangkan dbo.BarangDagang.IdSupplier
// NOT NULL — label hasil retur selalu memakai supplier tetap ini.
const RETUR_ID_SUPPLIER = 38;

// KategoriInput=BAGUS, KodeKategori=barangdagang => generate label
// BarangDagang baru sesuai IdJenis/Pcs item (Qty = Pcs).
exports.generateBarangDagangLabel = async (noRetur, idItem, ctx) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  const { actorId, actorUsername, requestId } = ctx;

  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await applyAuditContext(new sql.Request(tx), {
      actorId,
      actorUsername,
      requestId,
    });

    const headerRes = await new sql.Request(tx)
      .input("No", sql.VarChar(50), noRetur)
      .query(
        `SELECT StatusRetur FROM dbo.BJReturV3_h WITH (UPDLOCK, HOLDLOCK) WHERE NoRetur=@No`,
      );
    const header = headerRes.recordset[0];
    if (!header) throw notFound(`NoRetur ${noRetur} tidak ditemukan`);
    if (!["DIGANTI", "TIDAK_DIGANTI"].includes(header.StatusRetur)) {
      throw conflict(
        "Generate label hanya bisa dilakukan setelah keputusan PIC (DIGANTI/TIDAK_DIGANTI)",
      );
    }

    const itemRes = await new sql.Request(tx)
      .input("Id", sql.Int, idItem)
      .input("No", sql.VarChar(50), noRetur)
      .query(
        `SELECT * FROM dbo.BJReturV3Item_d WITH (UPDLOCK, HOLDLOCK) WHERE IdItem=@Id AND NoRetur=@No`,
      );
    const item = itemRes.recordset[0];
    if (!item) throw notFound(`Item ${idItem} tidak ditemukan pada retur ${noRetur}`);
    if (item.GeneratedLabelCode) {
      throw conflict("Item sudah memiliki label yang di-generate sebelumnya");
    }
    if (item.KodeKategori !== "barangdagang") {
      throw badReq("Item bukan kategori barangdagang");
    }
    if (item.KategoriInput !== "BAGUS") {
      throw badReq("Item bukan KategoriInput BAGUS");
    }

    const genCode = () =>
      generateNextCode(tx, {
        tableName: "dbo.BarangDagang",
        columnName: "NoBarangDagang",
        prefix: "BD.",
        width: 10,
      });

    let noBarangDagang = await genCode();
    if (await barangDagangReadRepo.isNoBarangDagangExists(tx, noBarangDagang)) {
      noBarangDagang = await genCode();
      if (await barangDagangReadRepo.isNoBarangDagangExists(tx, noBarangDagang)) {
        throw conflict("Gagal generate NoBarangDagang unik, coba lagi");
      }
    }

    await barangDagangWriteRepo.insertBarangDagangHeader(tx, {
      noBarangDagang,
      header: {
        IdSupplier: RETUR_ID_SUPPLIER,
        IdBarangDagang: Number(item.IdJenis),
        Qty: Number(item.Pcs),
        Keterangan: `Retur ${noRetur}`,
        CreateBy: actorUsername || null,
      },
      nowDateTime: new Date(),
    });

    await new sql.Request(tx)
      .input("Id", sql.Int, idItem)
      .input("Code", sql.VarChar(50), noBarangDagang)
      .query(
        `UPDATE dbo.BJReturV3Item_d SET GeneratedLabelCode=@Code WHERE IdItem=@Id`,
      );

    await tx.commit();

    return {
      noRetur,
      idItem,
      labelCode: noBarangDagang,
      kodeKategori: "barangdagang",
      pcs: Number(item.Pcs),
      audit: { actorId, requestId },
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw e;
  }
};
