// src/modules/retur-v3/retur-v3-controller.js
const service = require("./retur-v3-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../core/utils/http-context");

function makeCtx(req) {
  return {
    actorId: getActorId(req),
    actorUsername: getActorUsername(req) || "system",
    requestId: makeRequestId(req),
  };
}

function requireActor(req, res) {
  const actorId = getActorId(req);
  if (!actorId) {
    res.status(401).json({ success: false, message: "actorId tidak ditemukan dari token" });
    return false;
  }
  return true;
}

function handleError(res, e) {
  return res.status(e.statusCode || 500).json({ success: false, message: e.message });
}

async function getAll(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || req.query.statusRetur || "").trim();
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : null;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : null;

  try {
    const { data, total } = await service.getAllRetur({
      page,
      pageSize,
      search,
      status,
      dateFrom,
      dateTo,
    });
    return res.status(200).json({
      success: true,
      message: "Data retur v3 berhasil diambil",
      data,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    return handleError(res, e);
  }
}

async function getDetail(req, res) {
  try {
    const data = await service.getDetail(req.params.noRetur);
    return res.status(200).json({ success: true, message: "Data retur v3 berhasil diambil", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function create(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.createHeader(req.body || {}, makeCtx(req));
    return res.status(201).json({ success: true, message: "Retur v3 berhasil dibuat", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function update(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.updateHeader(req.params.noRetur, req.body || {}, makeCtx(req));
    return res.status(200).json({ success: true, message: "Retur v3 berhasil diupdate", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function remove(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.deleteHeader(req.params.noRetur, makeCtx(req));
    return res.status(200).json({ success: true, message: "Retur v3 berhasil dihapus", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function addItems(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const items = (req.body || {}).items;
    const data = await service.addItems(req.params.noRetur, items, makeCtx(req));
    return res.status(201).json({ success: true, message: "Item retur v3 berhasil ditambahkan", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function updateItem(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.updateItem(
      req.params.noRetur,
      req.params.idItem,
      req.body || {},
      makeCtx(req),
    );
    return res.status(200).json({ success: true, message: "Item retur v3 berhasil diupdate", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function deleteItem(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.deleteItem(req.params.noRetur, req.params.idItem, makeCtx(req));
    return res.status(200).json({ success: true, message: "Item retur v3 berhasil dihapus", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function decide(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.decide(
      req.params.noRetur,
      (req.body || {}).decision,
      req.body || {},
      makeCtx(req),
    );
    return res.status(200).json({ success: true, message: "Keputusan retur v3 berhasil disimpan", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function generateLabel(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.generateLabel(
      req.params.noRetur,
      req.params.idItem,
      req.body || {},
      makeCtx(req),
    );
    return res.status(201).json({ success: true, message: "Label berhasil digenerate", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function getOutputs(req, res) {
  try {
    const data = await service.getOutputs(req.params.noRetur);
    return res.status(200).json({ success: true, message: "Data output label berhasil diambil", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function scanAuto(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const body = req.body || {};
    const data = await service.scanTurnoverAuto(
      req.params.noRetur,
      body.labelCode,
      makeCtx(req),
      { confirmPartial: body.confirmPartial === true },
    );
    // Pcs label melebihi sisa target & belum dikonfirmasi — backend TIDAK
    // mengubah data, hanya menawarkan pemecahan (partial). UI panggil ulang
    // dengan confirmPartial:true.
    if (data && data.needsConfirmation) {
      return res.status(200).json({
        success: true,
        needsConfirmation: true,
        message: data.message,
        data,
      });
    }
    return res.status(201).json({ success: true, message: "Scan turnover berhasil", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function undoScan(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.undoScan(
      req.params.noRetur,
      req.params.idTurnover,
      makeCtx(req),
    );
    return res.status(200).json({ success: true, message: "Scan turnover berhasil dibatalkan", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function getTurnover(req, res) {
  try {
    const data = await service.getTurnover(req.params.noRetur);
    return res.status(200).json({ success: true, message: "Data turnover berhasil diambil", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function complete(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.markComplete(req.params.noRetur, makeCtx(req));
    return res.status(200).json({ success: true, message: "Retur v3 berhasil ditandai selesai", data });
  } catch (e) {
    return handleError(res, e);
  }
}

async function exportGsu(req, res) {
  if (!requireActor(req, res)) return;
  try {
    const data = await service.exportToGsu(
      req.params.noRetur,
      req.body || {},
      makeCtx(req),
    );
    return res.status(200).json({ success: true, message: "Ekspor ke AS_GSU berhasil", data });
  } catch (e) {
    return handleError(res, e);
  }
}

module.exports = {
  getAll,
  getDetail,
  create,
  update,
  remove,
  addItems,
  updateItem,
  deleteItem,
  decide,
  generateLabel,
  getOutputs,
  scanAuto,
  undoScan,
  getTurnover,
  complete,
  exportGsu,
};
