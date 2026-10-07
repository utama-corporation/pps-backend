const service = require('./mst-user-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} MstUser:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

async function list(req, res) {
  try {
    const data = await service.listUsers(req.query.q);
    return res.status(200).json({
      success: true,
      message: 'Data user berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing');
  }
}

async function getGroups(req, res) {
  try {
    const data = await service.listGroups();
    return res.status(200).json({
      success: true,
      message: 'Data group permission berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'listing groups');
  }
}

async function getUserGroups(req, res) {
  try {
    const data = await service.getUserGroups(req.params.idUsername);
    return res.status(200).json({
      success: true,
      message: 'Data group user berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'getting user groups');
  }
}

async function getEmployees(req, res) {
  try {
    const data = await service.searchEmployees(req.query.db, req.query.q);
    return res.status(200).json({
      success: true,
      message: 'Data karyawan berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    return fail(res, error, 'searching employees');
  }
}

async function create(req, res) {
  try {
    const data = await service.create(req.body);
    return res.status(201).json({
      success: true,
      message: 'User baru berhasil disimpan',
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
      message: 'Data user berhasil diubah',
      data,
    });
  } catch (error) {
    return fail(res, error, 'updating');
  }
}

async function remove(req, res) {
  try {
    await service.remove(req.query.idUsername);
    return res.status(200).json({
      success: true,
      message: 'User berhasil dihapus',
    });
  } catch (error) {
    return fail(res, error, 'deleting');
  }
}

module.exports = { list, getGroups, getUserGroups, getEmployees, create, update, remove };
