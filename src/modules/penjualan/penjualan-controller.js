const penjualanService = require("./penjualan-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../core/utils/http-context");

function sendError(res, err, fallbackMsg) {
  const status = err.statusCode || err.status || 500;
  return res.status(status).json({
    success: false,
    message: status === 500 ? "Internal Server Error" : err.message || fallbackMsg,
    error: {
      message: err.message,
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
    },
  });
}

async function getHeaders(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSizeRaw = parseInt(req.query.pageSize, 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

  const search =
    (typeof req.query.noBJJual === "string" && req.query.noBJJual) ||
    (typeof req.query.search === "string" && req.query.search) ||
    "";

  const dateFrom =
    (typeof req.query.dateFrom === "string" && req.query.dateFrom) || null;
  const dateTo =
    (typeof req.query.dateTo === "string" && req.query.dateTo) || null;

  // incomplete (default) | complete | all
  const status =
    (typeof req.query.status === "string" && req.query.status) ||
    "incomplete";

  try {
    const { data, total } = await penjualanService.getHeaders(
      page,
      pageSize,
      search,
      dateFrom,
      dateTo,
      status,
    );

    return res.status(200).json({
      success: true,
      message: "Daftar BJJual berhasil diambil",
      totalData: total,
      data,
      meta: {
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1,
        search,
        dateFrom,
        dateTo,
        status,
      },
    });
  } catch (err) {
    console.error("[penjualan][getHeaders]", err);
    return sendError(res, err, "Gagal mengambil data");
  }
}

async function getHeaderDetail(req, res) {
  const noBJJual = String(req.params.noBJJual || "").trim();
  if (!noBJJual) {
    return res.status(400).json({ success: false, message: "noBJJual wajib" });
  }

  try {
    const data = await penjualanService.getHeaderDetail(noBJJual);
    return res
      .status(200)
      .json({ success: true, message: "Detail BJJual berhasil diambil", data });
  } catch (err) {
    console.error("[penjualan][getHeaderDetail]", err);
    return sendError(res, err, "Gagal mengambil detail");
  }
}

async function scanLabel(req, res) {
  const noBJJual = String(req.params.noBJJual || "").trim();
  if (!noBJJual) {
    return res.status(400).json({ success: false, message: "noBJJual wajib" });
  }

  const actorId = getActorId(req);
  if (!actorId) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized (actorId missing)" });
  }

  const actorUsername =
    getActorUsername(req) || req.username || req.user?.username || "system";
  const requestId = String(makeRequestId(req) || "").trim();
  if (requestId) res.setHeader("x-request-id", requestId);

  const noLabel = String(req.body?.noLabel || "").trim();
  if (!noLabel) {
    return res
      .status(400)
      .json({ success: false, message: "noLabel wajib" });
  }
  const confirmPartial = req.body?.confirmPartial === true;

  try {
    const result = await penjualanService.scanLabel(
      noBJJual,
      noLabel,
      { actorId, actorUsername, requestId },
      { confirmPartial },
    );

    if (result.needsConfirmation) {
      return res.status(200).json({
        success: true,
        needsConfirmation: true,
        message: result.message,
        data: result,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Label berhasil discan",
      data: result,
      meta: { audit: { actorId, actorUsername, requestId } },
    });
  } catch (err) {
    console.error("[penjualan][scanLabel]", err);
    return sendError(res, err, "Gagal scan label");
  }
}

async function addItem(req, res) {
  const noBJJual = String(req.params.noBJJual || "").trim();
  if (!noBJJual) {
    return res.status(400).json({ success: false, message: "noBJJual wajib" });
  }

  const actorId = getActorId(req);
  if (!actorId) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized (actorId missing)" });
  }

  const actorUsername =
    getActorUsername(req) || req.username || req.user?.username || "system";

  try {
    const data = await penjualanService.addItem(
      noBJJual,
      req.body,
      { actorId, actorUsername },
    );
    return res
      .status(201)
      .json({ success: true, message: "Item berhasil ditambahkan", data });
  } catch (err) {
    console.error("[penjualan][addItem]", err);
    return sendError(res, err, "Gagal menambah item");
  }
}

async function updateItem(req, res) {
  const noBJJual = String(req.params.noBJJual || "").trim();
  if (!noBJJual) {
    return res.status(400).json({ success: false, message: "noBJJual wajib" });
  }

  try {
    const data = await penjualanService.updateItem(noBJJual, req.body);
    return res
      .status(200)
      .json({ success: true, message: "Item berhasil diperbarui", data });
  } catch (err) {
    console.error("[penjualan][updateItem]", err);
    return sendError(res, err, "Gagal memperbarui item");
  }
}

async function deleteItem(req, res) {
  const noBJJual = String(req.params.noBJJual || "").trim();
  if (!noBJJual) {
    return res.status(400).json({ success: false, message: "noBJJual wajib" });
  }

  try {
    const data = await penjualanService.deleteItem(noBJJual, req.query);
    return res
      .status(200)
      .json({ success: true, message: "Item berhasil dihapus", data });
  } catch (err) {
    console.error("[penjualan][deleteItem]", err);
    return sendError(res, err, "Gagal menghapus item");
  }
}

async function deletePenjualan(req, res) {
  const noBJJual = String(req.params.noBJJual || "").trim();
  if (!noBJJual) {
    return res.status(400).json({ success: false, message: "noBJJual wajib" });
  }

  const actorId = getActorId(req);
  if (!actorId) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized (actorId missing)" });
  }
  const actorUsername =
    getActorUsername(req) || req.username || req.user?.username || "system";

  try {
    const data = await penjualanService.deletePenjualan(noBJJual, {
      actorId,
      actorUsername,
      requestId: makeRequestId(req),
    });
    return res
      .status(200)
      .json({ success: true, message: "Penjualan berhasil dihapus", data });
  } catch (err) {
    console.error("[penjualan][deletePenjualan]", err);
    return sendError(res, err, "Gagal menghapus penjualan");
  }
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
