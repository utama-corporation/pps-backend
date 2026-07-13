// src/modules/master/reject-master-controller.js
const service = require('./reject-master-service');

async function getAllActive(req, res) {
  const { username } = req;
  console.log(
    '🔍 Fetching MstReject (active only / master reject) | Username:',
    username
  );

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: 'Active Reject master data (MstReject) fetched successfully',
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error('Error fetching MstReject (active / master reject):', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}

async function getStokProses(req, res) {
  try {
    const data = await service.getStokProses();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get Stok Reject Proses Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
    });
  }
}

async function getLabelByIdReject(req, res) {
  try {
    const idReject = parseInt(req.params.idreject, 10);

    if (!Number.isFinite(idReject)) {
      return res.status(400).json({
        success: false,
        message: 'idreject wajib berupa angka',
      });
    }

    const data = await service.getLabelByIdReject(idReject);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get Label Reject By IdReject Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
    });
  }
}

module.exports = { getAllActive, getStokProses, getLabelByIdReject };
