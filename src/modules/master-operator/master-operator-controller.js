// master-operator-controller.js
const service = require('./master-operator-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} MstOperator:`, error);
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
  const all = String(req.query.all || '0') === '1';

  if (all) {
    const q = (req.query.q || '').toString().trim();
    try {
      const rows = await service.listForMaster({ q });
      return res.status(200).json({
        success: true,
        message: 'Data MstOperator berhasil diambil',
        totalData: rows.length,
        data: rows,
      });
    } catch (error) {
      return fail(res, error, 'listing');
    }
  }

  const includeDisabled = String(req.query.includeDisabled || '0') === '1';
  const q = (req.query.q || '').toString().trim(); // still used to filter, not echoed
  const orderBy = (req.query.orderBy || 'NamaOperator').toString(); // used internally
  const orderDir =
    (req.query.orderDir || 'ASC').toString().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  try {
    const rows = await service.listAll({ includeDisabled, q, orderBy, orderDir });
    return res.status(200).json({
      success: true,
      message: 'Data MstOperator berhasil diambil',
      includeDisabled,         // ✅ keep this
      totalData: rows.length,  // optional; remove if you don't want it
      data: rows,
    });
  } catch (error) {
    console.error('Error listing MstOperator (no pagination):', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}

async function listBagian(req, res) {
  try {
    const rows = await service.listBagian();
    return res.status(200).json({
      success: true,
      message: 'Data bagian mesin berhasil diambil',
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, 'listing bagian');
  }
}

async function listByIdRegu(req, res) {
  const idregu = (req.params.idregu || '').toString().trim();

  if (!idregu) {
    return res.status(400).json({
      success: false,
      message: 'Parameter idregu wajib diisi',
    });
  }

  try {
    const rows = await service.listByIdRegu(idregu);
    return res.status(200).json({
      success: true,
      message: 'Data operator berdasarkan idregu berhasil diambil',
      idregu,
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error('Error listing MstOperator by idregu:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}

async function create(req, res) {
  try {
    const data = await service.create({
      namaOperator: req.body?.namaOperator,
      idBagian: req.body?.idBagian,
      enable: req.body?.enable,
    });
    return res
      .status(201)
      .json({ success: true, message: 'Data operator berhasil disimpan', data });
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
      namaOperator: req.body?.namaOperator,
      idBagian: req.body?.idBagian,
      enable: req.body?.enable,
    });
    return res
      .status(200)
      .json({ success: true, message: 'Data operator berhasil diubah', data });
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
      .json({ success: true, message: 'Data operator berhasil dihapus' });
  } catch (error) {
    return fail(res, error, 'deleting');
  }
}

module.exports = {
  list,
  listBagian,
  listByIdRegu,
  create,
  update,
  remove,
};
