const service = require('./master-cetakan-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} MstCetakan:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

async function getAllActive(req, res) {
  const { username } = req;
  console.log('🔍 Fetching MstCetakan (active only) | Username:', username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: 'Data MstCetakan (active) berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing (active)');
  }
}

async function getOptions(req, res) {
  try {
    const data = await service.getOptions();
    return res.status(200).json({
      success: true,
      message: 'Data opsi Cetakan Warna Material berhasil diambil',
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing options');
  }
}

async function listWarnaMaterial(req, res) {
  try {
    const data = await service.listWarnaMaterial({
      top: req.query.top,
      q: req.query.q,
    });
    return res.status(200).json({
      success: true,
      message: 'Data Cetakan Warna Material berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing warna material');
  }
}

async function getDetail(req, res) {
  try {
    const data = await service.getDetail({
      idCetakan: Number(req.query.idCetakan),
      idWarna: Number(req.query.idWarna),
      idMaterial: Number(req.query.idMaterial ?? 0) || 0,
    });
    return res.status(200).json({
      success: true,
      message: 'Detail Cetakan Warna Material berhasil diambil',
      data,
    });
  } catch (error) {
    return fail(res, error, 'getting detail');
  }
}

async function createWarnaMaterial(req, res) {
  try {
    const data = await service.create(req.body, req.username);
    return res.status(201).json({
      success: true,
      message: 'Data Cetakan Warna Material berhasil disimpan',
      data,
    });
  } catch (error) {
    return fail(res, error, 'creating');
  }
}

async function updateWarnaMaterial(req, res) {
  try {
    const data = await service.update(
      req.body?.oldKey ?? req.body?.old,
      req.body,
      req.username,
    );
    return res.status(200).json({
      success: true,
      message: 'Data Cetakan Warna Material berhasil diubah',
      data,
    });
  } catch (error) {
    return fail(res, error, 'updating');
  }
}

async function removeWarnaMaterial(req, res) {
  try {
    await service.remove(
      {
        idCetakan: Number(req.query.idCetakan),
        idWarna: Number(req.query.idWarna),
        idMaterial: Number(req.query.idMaterial ?? 0) || 0,
      },
      req.username,
    );
    return res.status(200).json({
      success: true,
      message: 'Data Cetakan Warna Material berhasil dihapus',
    });
  } catch (error) {
    return fail(res, error, 'deleting');
  }
}

module.exports = {
  getAllActive,
  getOptions,
  listWarnaMaterial,
  getDetail,
  createWarnaMaterial,
  updateWarnaMaterial,
  removeWarnaMaterial,
};
