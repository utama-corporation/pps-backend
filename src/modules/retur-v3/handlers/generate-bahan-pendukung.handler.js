// src/modules/retur-v3/handlers/generate-bahan-pendukung.handler.js
const { sql, poolPromise } = require("../../../core/config/db");
const {
  generateNextCode,
} = require("../../../core/utils/sequence-code-helper");
const { badReq, conflict, notFound } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const bahanPendukungReadRepo = require("../../label/bahan-pendukung/repositories/bahan-pendukung-read.repository");
const bahanPendukungWriteRepo = require("../../label/bahan-pendukung/repositories/bahan-pendukung-write.repository");

// Item retur tidak membawa supplier, sedangkan dbo.BahanPendukung.IdSupplier
// NOT NULL — label hasil retur selalu memakai supplier tetap ini
// (sama dengan generate barang dagang).
const RETUR_ID_SUPPLIER = 38;

// KodeKategori=bahanpendukung (KategoriInput BAGUS maupun REJECT/Rusak) =>
// generate label BahanPendukung baru sesuai IdJenis(IdCabinetMaterial)/Pcs
// item (Qty = Pcs). Tidak memakai label reject.
exports.generateBahanPendukungLabel = async (noRetur, idItem, ctx) => {
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
    if (item.KodeKategori !== "bahanpendukung") {
      throw badReq("Item bukan kategori bahanpendukung");
    }

    const genCode = () =>
      generateNextCode(tx, {
        tableName: "dbo.BahanPendukung",
        columnName: "NoBahanPendukung",
        prefix: "BP.",
        width: 10,
      });

    let noBahanPendukung = await genCode();
    if (await bahanPendukungReadRepo.isNoBahanPendukungExists(tx, noBahanPendukung)) {
      noBahanPendukung = await genCode();
      if (await bahanPendukungReadRepo.isNoBahanPendukungExists(tx, noBahanPendukung)) {
        throw conflict("Gagal generate NoBahanPendukung unik, coba lagi");
      }
    }

    await bahanPendukungWriteRepo.insertBahanPendukungHeader(tx, {
      noBahanPendukung,
      header: {
        IdSupplier: RETUR_ID_SUPPLIER,
        IdCabinetMaterial: Number(item.IdJenis),
        Qty: Number(item.Pcs),
        QtyAwal: Number(item.Pcs),
        Keterangan: `Retur ${noRetur}`,
        CreateBy: actorUsername || null,
      },
      nowDateTime: new Date(),
    });

    await new sql.Request(tx)
      .input("Id", sql.Int, idItem)
      .input("Code", sql.VarChar(50), noBahanPendukung)
      .query(
        `UPDATE dbo.BJReturV3Item_d SET GeneratedLabelCode=@Code WHERE IdItem=@Id`,
      );

    await tx.commit();

    return {
      noRetur,
      idItem,
      labelCode: noBahanPendukung,
      kodeKategori: "bahanpendukung",
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
