const { sql, poolPromise } = require("../../../core/config/db");
const { badReq, notFound, conflict } = require("../../../core/utils/http-error");
const { applyAuditContext } = require("../../../core/utils/db-audit-context");
const {
  detectCategory,
  normalizeLabelCode,
} = require("../penjualan-category-registry");
// Mesin "partial consumption" label fisik — dipakai bareng dengan retur-v3.
const {
  lockParentAndAvailablePcs,
  markParentFullyUsed,
  createPartial,
} = require("../../../core/shared/label-partial.helper");

exports.scanLabel = async (noBJJual, noLabelRaw, ctx, options = {}) => {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");

  const noLabel = normalizeLabelCode(noLabelRaw);
  if (!noLabel) throw badReq("noLabel wajib");

  const confirmPartial = options.confirmPartial === true;

  const category = detectCategory(noLabel);
  if (!category) {
    throw badReq(
      `Label ${noLabel} bukan kategori yang valid untuk Penjualan (harus furniturewip/barangjadi)`,
    );
  }

  const actorIdNum = Number(ctx?.actorId);
  if (!Number.isFinite(actorIdNum) || actorIdNum <= 0) {
    throw badReq("ctx.actorId wajib. Controller harus inject dari token.");
  }
  const actorUsername = String(ctx?.actorUsername || "").trim() || "system";
  const requestId = String(ctx?.requestId || "").trim();
  const auditCtx = { actorId: Math.trunc(actorIdNum), actorUsername, requestId };

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const auditReq = new sql.Request(tx);
    await applyAuditContext(auditReq, auditCtx);

    // 1) Lock header, pastikan ada & belum complete
    const headerRes = await new sql.Request(tx).input(
      "No",
      sql.VarChar(13),
      no,
    ).query(`
        SELECT NoBJJual, IsComplete
        FROM dbo.BJJual_h WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBJJual = @No
      `);

    const header = headerRes.recordset?.[0];
    if (!header) throw notFound(`BJJual ${no} tidak ditemukan`);
    if (header.IsComplete) {
      throw conflict(`BJJual ${no} sudah complete, tidak bisa scan lagi`);
    }

    // 2) Lock parent label + hitung sisa pcs yang masih tersedia (Pcs
    // dikurangi total partial yang sudah pernah dipecah dari label ini).
    // Label yang sama boleh discan berkali-kali (lintas BJJual atau baris
    // berbeda) selama masih ada sisa pcs — cukup dijaga lewat availablePcs
    // + lock transaksional di bawah, tanpa perlu cek duplikat NoLabel.
    const parent = await lockParentAndAvailablePcs(tx, category, noLabel);
    if (!parent) {
      throw badReq(`Label ${noLabel} tidak ditemukan atau sudah terpakai`);
    }
    if (parent.availablePcs <= 0) {
      throw badReq(`Label ${noLabel} sudah habis pcs-nya (sudah terpakai semua)`);
    }

    // 3) Cari baris BJJualItem_d yang jenisnya cocok
    const lineRes = await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .input("KodeKategori", sql.VarChar(20), category)
      .input("IdJenis", sql.Int, parent.IdJenis).query(`
        SELECT NoBJJual, KodeKategori, IdJenis, Pcs AS PcsRequired
        FROM dbo.BJJualItem_d WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBJJual = @No AND KodeKategori = @KodeKategori AND IdJenis = @IdJenis
      `);

    const line = lineRes.recordset?.[0];
    if (!line) {
      throw badReq(
        `Jenis label ${noLabel} tidak sesuai dengan item pada BJJual ${no}`,
      );
    }

    // 4) Hitung sisa kuota baris ini
    const scannedRes = await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .input("KodeKategori", sql.VarChar(20), category)
      .input("IdJenis", sql.Int, parent.IdJenis).query(`
        SELECT ISNULL(SUM(Pcs), 0) AS PcsScanned
        FROM dbo.BJJualScanLabel_d WITH (UPDLOCK, HOLDLOCK)
        WHERE NoBJJual = @No AND KodeKategori = @KodeKategori AND IdJenis = @IdJenis
      `);

    const pcsScannedBefore = Number(scannedRes.recordset?.[0]?.PcsScanned || 0);
    const pcsRequired = Number(line.PcsRequired || 0);
    const sisaKuota = pcsRequired - pcsScannedBefore;

    if (sisaKuota <= 0) {
      throw badReq(`Item ini pada BJJual ${no} sudah terpenuhi`);
    }

    let consumedPcs;
    let wasPartialSplit = false;
    let partialCode = null;

    if (parent.availablePcs <= sisaKuota) {
      // Pcs label pas atau kurang dari kebutuhan — pakai semua sisa pcs
      // label ini, tandai parent fully-consumed.
      consumedPcs = parent.availablePcs;
      const affected = await markParentFullyUsed(tx, category, noLabel);
      if (affected === 0) {
        throw conflict(`Label ${noLabel} baru saja dipakai oleh proses lain`);
      }

      // Kalau label ini SUDAH pernah dipecah sebelumnya (sisa tersedia <
      // Pcs asli parent), sisa terakhirnya pun dicatat sebagai baris
      // partial — supaya SETIAP konsumsi atas label ber-partial punya
      // NoPartial. Hanya konsumsi 1x-penuh atas label yang belum pernah
      // dipecah yang NoPartial-nya NULL. Tidak ada konfirmasi di sini:
      // seluruh sisa memang dibutuhkan baris ini, tidak ada yang perlu
      // diputuskan user.
      if (parent.parentPcs > parent.availablePcs) {
        partialCode = await createPartial(tx, category, noLabel, consumedPcs);
        wasPartialSplit = true;
      }
    } else if (!confirmPartial) {
      // Pcs label melebihi sisa kebutuhan — jangan langsung tolak, minta
      // konfirmasi user dulu apakah mau dipecah (partial) sejumlah sisa
      // kebutuhan. Tidak ada perubahan data, rollback transaksi ini.
      await tx.rollback();
      return {
        needsConfirmation: true,
        noBJJual: no,
        kodeKategori: category,
        idJenis: parent.IdJenis,
        noLabel,
        availablePcs: parent.availablePcs,
        pcsNeeded: sisaKuota,
        message:
          `Label ${noLabel} berisi ${parent.availablePcs} pcs, sedangkan sisa kebutuhan ` +
          `item ini hanya ${sisaKuota} pcs. Pecah (partial) label ini menjadi ${sisaKuota} pcs ` +
          `agar bisa dipakai untuk BJJual ${no}? Sisa ${parent.availablePcs - sisaKuota} pcs ` +
          `tetap tersedia di label asal untuk dipakai kebutuhan lain.`,
      };
    } else {
      // User sudah konfirmasi — pecah label jadi partial sejumlah sisa
      // kebutuhan (bookkeeping availablePcs untuk modul lain), sisanya
      // tetap tersedia di parent (DateUsage tetap NULL). NoLabel yang
      // dicatat di BJJualScanLabel_d TETAP kode label asli, bukan kode
      // partial-nya — kode partial cuma dipakai internal.
      consumedPcs = sisaKuota;
      partialCode = await createPartial(tx, category, noLabel, sisaKuota);
      wasPartialSplit = true;
    }

    // 5) Insert tracking row — NoLabel selalu kode label fisik asli yang
    // discan user, baik pada konsumsi penuh maupun partial. NoPartial
    // diisi kalau scan ini memecah partial (branch confirmPartial ATAU
    // sisa terakhir label yang sudah pernah dipecah); NULL berarti
    // konsumsi 1x-penuh atas label yang belum pernah dipecah.
    await new sql.Request(tx)
      .input("No", sql.VarChar(13), no)
      .input("KodeKategori", sql.VarChar(20), category)
      .input("IdJenis", sql.Int, parent.IdJenis)
      .input("NoLabel", sql.VarChar(50), noLabel)
      .input("NoPartial", sql.VarChar(50), partialCode)
      .input("Pcs", sql.Int, consumedPcs)
      .input("IdUsername", sql.Int, auditCtx.actorId).query(`
        INSERT INTO dbo.BJJualScanLabel_d (
          NoBJJual, KodeKategori, IdJenis, NoLabel, NoPartial, Pcs, IdUsername
        )
        VALUES (@No, @KodeKategori, @IdJenis, @NoLabel, @NoPartial, @Pcs, @IdUsername)
      `);

    // 6) Cek apakah header sudah complete (semua baris terpenuhi)
    const remainingRes = await new sql.Request(tx).input(
      "No",
      sql.VarChar(13),
      no,
    ).query(`
        SELECT COUNT(1) AS Remaining
        FROM dbo.BJJualItem_d d
        WHERE d.NoBJJual = @No
          AND ISNULL((
            SELECT SUM(s.Pcs) FROM dbo.BJJualScanLabel_d s
            WHERE s.NoBJJual = d.NoBJJual
              AND s.KodeKategori = d.KodeKategori
              AND s.IdJenis = d.IdJenis
          ), 0) < d.Pcs
      `);

    const remaining = Number(remainingRes.recordset?.[0]?.Remaining || 0);
    const isHeaderComplete = remaining === 0;

    if (isHeaderComplete) {
      await new sql.Request(tx).input("No", sql.VarChar(13), no).query(`
          UPDATE dbo.BJJual_h
          SET IsComplete = 1, DateComplete = GETDATE()
          WHERE NoBJJual = @No
        `);
    }

    await tx.commit();

    const pcsScannedAfter = pcsScannedBefore + consumedPcs;

    return {
      noBJJual: no,
      kodeKategori: category,
      idJenis: parent.IdJenis,
      noLabel,
      wasPartialSplit,
      partialCode,
      pcs: consumedPcs,
      lineProgress: {
        pcsRequired,
        pcsScanned: pcsScannedAfter,
        isComplete: pcsScannedAfter >= pcsRequired,
      },
      headerComplete: isHeaderComplete,
      audit: auditCtx,
    };
  } catch (e) {
    try {
      await tx.rollback();
    } catch (_) {}
    throw Object.assign(e, auditCtx);
  }
};
