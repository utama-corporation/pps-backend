// penerimaan-bahan-baku-controller.js
const service = require("./penerimaan-bahan-baku-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../../core/utils/http-context");

function buildCtx(req) {
  return {
    actorId: getActorId(req),
    actorUsername: getActorUsername(req) || "system",
    requestId: makeRequestId(req),
  };
}

async function timStatus(req, res) {
  try {
    const data = await service.getTimStatus();
    return res.status(200).json({
      success: true,
      message: "Status tim penerimaan bahan baku berhasil diambil",
      data,
    });
  } catch (error) {
    console.error("Error getting tim status PenerimaanBahanBaku:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
}

async function list(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSizeRaw = parseInt(req.query.pageSize, 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
  const filter = req.query.filter ? String(req.query.filter) : "";
  const kodeKategori = req.query.kodeKategori ? String(req.query.kodeKategori) : "";

  try {
    const { data, total } = await service.listPenerimaanBahanBaku({ page, pageSize, filter, kodeKategori });
    return res.status(200).json({
      success: true,
      message: "Data PenerimaanBahanBaku berhasil diambil",
      totalData: total,
      data,
      meta: {
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1,
        filter,
        kodeKategori,
      },
    });
  } catch (error) {
    console.error("Error listing PenerimaanBahanBaku:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
}

async function getDetail(req, res) {
  try {
    const data = await service.getDetailPenerimaanBahanBaku(req.params.noPenerimaan);
    if (!data) {
      return res.status(404).json({ success: false, message: "Data PenerimaanBahanBaku tidak ditemukan" });
    }
    return res.status(200).json({ success: true, message: "Data PenerimaanBahanBaku berhasil diambil", data });
  } catch (error) {
    console.error("Error get detail PenerimaanBahanBaku:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
}

async function createHeader(req, res) {
  const ctx = buildCtx(req);
  try {
    const data = await service.createHeaderPenerimaanBahanBaku(req.body || {}, ctx);
    return res.status(201).json({
      success: true,
      message: "Header penerimaan bahan baku berhasil dibuat",
      data,
      meta: { audit: ctx },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error("Error creating PenerimaanBahanBaku header:", error);
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Internal Server Error" : error.message,
      ...(statusCode === 500 ? { error: error.message } : {}),
      meta: { audit: ctx },
    });
  }
}

async function addPallets(req, res) {
  const ctx = buildCtx(req);
  try {
    const data = await service.addPalletsPenerimaanBahanBaku(req.params.noPenerimaan, req.body || {}, ctx);
    return res.status(201).json({
      success: true,
      message: "Pallet penerimaan bahan baku berhasil disimpan",
      data,
      meta: { audit: ctx },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error("Error adding pallets to PenerimaanBahanBaku:", error);
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Internal Server Error" : error.message,
      ...(statusCode === 500 ? { error: error.message } : {}),
      meta: { audit: ctx },
    });
  }
}

async function remove(req, res) {
  const ctx = buildCtx(req);
  try {
    await service.deletePenerimaanBahanBaku(req.params.noPenerimaan, ctx);
    return res.status(200).json({ success: true, message: "Penerimaan bahan baku berhasil dihapus" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error("Error deleting PenerimaanBahanBaku:", error);
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Internal Server Error" : error.message,
      ...(statusCode === 500 ? { error: error.message } : {}),
    });
  }
}

async function complete(req, res) {
  const ctx = buildCtx(req);
  try {
    await service.completePenerimaanBahanBaku(req.params.noPenerimaan, ctx);
    return res.status(200).json({ success: true, message: "Penerimaan bahan baku ditandai selesai" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    console.error("Error completing PenerimaanBahanBaku:", error);
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Internal Server Error" : error.message,
      ...(statusCode === 500 ? { error: error.message } : {}),
    });
  }
}

function sendError(res, error, logLabel) {
  const statusCode = error.statusCode || 500;
  console.error(logLabel, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Internal Server Error" : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

async function formOptions(req, res) {
  try {
    const data = await service.getFormOptions(req.query.kodeKategori);
    return res.status(200).json({ success: true, message: "Opsi form berhasil diambil", data });
  } catch (error) {
    return sendError(res, error, "Error get form options PenerimaanBahanBaku:");
  }
}

async function potongan(req, res) {
  try {
    const data = await service.getPotongan(req.params.idSupplier);
    return res.status(200).json({ success: true, message: "Aturan potongan berhasil diambil", data });
  } catch (error) {
    return sendError(res, error, "Error get potongan PenerimaanBahanBaku:");
  }
}

function editHandler(label, message, run, status = 200) {
  return async (req, res) => {
    const ctx = buildCtx(req);
    try {
      const data = await run(req, ctx);
      return res.status(status).json({ success: true, message, data, meta: { audit: ctx } });
    } catch (error) {
      return sendError(res, error, `Error ${label} PenerimaanBahanBaku:`);
    }
  };
}

const updatePallet = editHandler("ubah pallet", "Pallet berhasil diubah", (req, ctx) =>
  service.updatePalletPenerimaan(
    req.params.noPenerimaan,
    req.params.noBahanBaku,
    req.params.noPallet,
    req.body || {},
    ctx,
  ),
);

const removePallet = editHandler("hapus pallet", "Pallet berhasil dihapus", (req, ctx) =>
  service.deletePalletPenerimaan(
    req.params.noPenerimaan,
    req.params.noBahanBaku,
    req.params.noPallet,
    ctx,
  ),
);

const addSaks = editHandler(
  "tambah sak",
  "Sak berhasil ditambahkan",
  (req, ctx) =>
    service.addSaksPenerimaan(
      req.params.noPenerimaan,
      req.params.noBahanBaku,
      req.params.noPallet,
      req.body || {},
      ctx,
    ),
  201,
);

const removeSak = editHandler("hapus sak", "Sak berhasil dihapus", (req, ctx) =>
  service.deleteSakPenerimaan(
    req.params.noPenerimaan,
    req.params.noBahanBaku,
    req.params.noPallet,
    req.params.noSak,
    ctx,
  ),
);

async function laporan(req, res) {
  try {
    const data = await service.getLaporanPenerimaan(req.params.noPenerimaan);
    return res.status(200).json({ success: true, message: "Laporan berhasil diambil", data });
  } catch (error) {
    return sendError(res, error, "Error get laporan PenerimaanBahanBaku:");
  }
}

module.exports = {
  updatePallet,
  removePallet,
  addSaks,
  removeSak,
  laporan,
  list,
  getDetail,
  createHeader,
  addPallets,
  remove,
  timStatus,
  complete,
  formOptions,
  potongan,
};
