const service = require("./master-mesin-produksi-service");

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} Master Mesin Produksi:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Internal Server Error" : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

async function getMeta(req, res) {
  try {
    const [summary, uom] = await Promise.all([
      service.getSummary(),
      service.getUomOptions(),
    ]);
    return res.status(200).json({
      success: true,
      message: "Meta master mesin produksi berhasil diambil",
      data: { types: service.listTypes(), summary, uom },
    });
  } catch (error) {
    return fail(res, error, "meta");
  }
}

async function list(req, res) {
  try {
    const data = await service.list(req.params.type, { search: req.query.search });
    return res.status(200).json({
      success: true,
      message: "Data mesin berhasil diambil",
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, "listing");
  }
}

async function create(req, res) {
  try {
    const data = await service.create(req.params.type, req.body);
    return res.status(201).json({ success: true, message: "Mesin berhasil dibuat", data });
  } catch (error) {
    return fail(res, error, "create");
  }
}

async function update(req, res) {
  try {
    const data = await service.update(req.params.type, req.params.id, req.body);
    return res.status(200).json({ success: true, message: "Mesin berhasil diubah", data });
  } catch (error) {
    return fail(res, error, "update");
  }
}

async function disable(req, res) {
  try {
    const data = await service.disable(req.params.type, req.params.id);
    return res
      .status(200)
      .json({ success: true, message: "Mesin berhasil dinonaktifkan", data });
  } catch (error) {
    return fail(res, error, "disable");
  }
}

module.exports = { getMeta, list, create, update, disable };
