// master-supplier-manage-controller.js
const service = require("./master-supplier-manage-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../../core/utils/http-context");

function auditOf(req) {
  return {
    actorId: getActorId(req),
    actorUsername: getActorUsername(req),
    requestId: makeRequestId(req),
  };
}

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} Master Supplier:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Internal Server Error" : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

function payloadOf(req) {
  return {
    namaSupplier: req.body?.namaSupplier,
    initial: req.body?.initial,
    noTlp: req.body?.noTlp,
    enable: req.body?.enable,
  };
}

async function list(req, res) {
  try {
    const rows = await service.list({
      q: req.query.q,
      status: String(req.query.status || "all"),
    });
    return res.status(200).json({
      success: true,
      message: "Data supplier berhasil diambil",
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, "listing");
  }
}

async function create(req, res) {
  try {
    const data = await service.create(payloadOf(req), auditOf(req));
    return res
      .status(201)
      .json({ success: true, message: "Data supplier berhasil disimpan", data });
  } catch (error) {
    return fail(res, error, "creating");
  }
}

async function update(req, res) {
  try {
    const data = await service.update(req.params.id, payloadOf(req), auditOf(req));
    return res
      .status(200)
      .json({ success: true, message: "Data supplier berhasil diubah", data });
  } catch (error) {
    return fail(res, error, "updating");
  }
}

async function remove(req, res) {
  try {
    await service.remove(req.params.id, auditOf(req));
    return res
      .status(200)
      .json({ success: true, message: "Data supplier berhasil dihapus" });
  } catch (error) {
    return fail(res, error, "deleting");
  }
}

module.exports = { list, create, update, remove };
