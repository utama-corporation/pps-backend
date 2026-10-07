const service = require('./master-formula-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} MasterFormula:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

async function getKategori(req, res) {
  try {
    const data = await service.getKategoriList();
    return res.status(200).json({
      success: true,
      message: 'Data kategori Master Formula berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing kategori');
  }
}

async function getItems(req, res) {
  try {
    const data = await service.getItems(req.query.idKategori);
    return res.status(200).json({
      success: true,
      message: 'Data item Master Formula berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing items');
  }
}

async function list(req, res) {
  try {
    const data = await service.listFormula(req.query.q);
    return res.status(200).json({
      success: true,
      message: 'Data Master Formula Produksi berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing');
  }
}

async function getDetail(req, res) {
  try {
    const data = await service.getDetail(req.query.idFormula);
    return res.status(200).json({
      success: true,
      message: 'Detail Master Formula Produksi berhasil diambil',
      data,
    });
  } catch (error) {
    return fail(res, error, 'getting detail');
  }
}

async function create(req, res) {
  try {
    const data = await service.create(req.body);
    return res.status(201).json({
      success: true,
      message: 'Data Master Formula Produksi berhasil disimpan',
      data,
    });
  } catch (error) {
    return fail(res, error, 'creating');
  }
}

async function update(req, res) {
  try {
    const data = await service.update(req.body);
    return res.status(200).json({
      success: true,
      message: 'Data Master Formula Produksi berhasil diubah',
      data,
    });
  } catch (error) {
    return fail(res, error, 'updating');
  }
}

async function remove(req, res) {
  try {
    await service.remove(req.query.idFormula);
    return res.status(200).json({
      success: true,
      message: 'Data Master Formula Produksi berhasil dihapus',
    });
  } catch (error) {
    return fail(res, error, 'deleting');
  }
}

module.exports = {
  getKategori,
  getItems,
  list,
  getDetail,
  create,
  update,
  remove,
};
