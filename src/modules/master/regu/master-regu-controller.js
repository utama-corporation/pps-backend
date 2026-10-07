// master-regu-controller.js
const service = require('./master-regu-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} MstRegu:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

function parseId(raw) {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function list(req, res) {
  const q = (req.query.q || '').toString().trim();
  const orderBy = (req.query.orderBy || 'NamaRegu').toString();
  const orderDir =
    (req.query.orderDir || 'ASC').toString().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const idBagianRaw = req.query.idBagian;
  const idBagian = idBagianRaw
    ? (Array.isArray(idBagianRaw) ? idBagianRaw : String(idBagianRaw).split(","))
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  try {
    const rows = await service.listAll({ q, orderBy, orderDir, idBagian });
    return res.status(200).json({
      success: true,
      message: 'Data MstRegu berhasil diambil',
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, 'listing');
  }
}

async function getById(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: 'Parameter id tidak valid' });
  }

  try {
    const regu = await service.getById(id);
    if (!regu) {
      return res
        .status(404)
        .json({ success: false, message: 'Regu tidak ditemukan' });
    }
    const members = await service.getMembers(id);
    return res.status(200).json({
      success: true,
      message: 'Data regu berhasil diambil',
      data: { ...regu, operators: members },
    });
  } catch (error) {
    return fail(res, error, 'get');
  }
}

async function create(req, res) {
  try {
    const data = await service.create({
      namaRegu: req.body?.namaRegu,
      idBagian: req.body?.idBagian,
      operatorIds: req.body?.operatorIds,
    });
    return res
      .status(201)
      .json({ success: true, message: 'Data regu berhasil disimpan', data });
  } catch (error) {
    return fail(res, error, 'creating');
  }
}

async function update(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: 'Parameter id tidak valid' });
  }

  try {
    const data = await service.update(id, {
      namaRegu: req.body?.namaRegu,
      idBagian: req.body?.idBagian,
      operatorIds: req.body?.operatorIds,
    });
    return res
      .status(200)
      .json({ success: true, message: 'Data regu berhasil diubah', data });
  } catch (error) {
    return fail(res, error, 'updating');
  }
}

async function remove(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: 'Parameter id tidak valid' });
  }

  try {
    await service.remove(id);
    return res
      .status(200)
      .json({ success: true, message: 'Data regu berhasil dihapus' });
  } catch (error) {
    return fail(res, error, 'deleting');
  }
}

module.exports = { list, getById, create, update, remove };
