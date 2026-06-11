const service = require('./master-warna-service');

async function getAllActive(req, res) {
  const { username } = req;
  console.log('🔍 Fetching MstWarna (active only) | Username:', username);

  try {
    const data = await service.getAllActive();
    return res.status(200).json({
      success: true,
      message: 'Data MstWarna (active) berhasil diambil',
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error('Error fetching MstWarna (active):', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}

async function getByIdCetakan(req, res) {
  const { username } = req;
  const idCetakan = Number.parseInt(req.params.idCetakan, 10);

  if (!Number.isInteger(idCetakan)) {
    return res.status(400).json({
      success: false,
      message: 'idCetakan must be an integer',
    });
  }

  console.log(
    '🔍 Fetching MstWarna by IdCetakan | Username:',
    username,
    '| IdCetakan:',
    idCetakan,
  );

  try {
    const data = await service.getByIdCetakan(idCetakan);
    return res.status(200).json({
      success: true,
      message: 'Data warna berdasarkan IdCetakan berhasil diambil',
      idCetakan,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error('Error fetching MstWarna by IdCetakan:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}

module.exports = { getAllActive, getByIdCetakan };
