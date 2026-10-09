// master-blok-lokasi-controller.js
const service = require('./master-blok-lokasi-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} Master Blok Lokasi:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

async function getMaster(req, res) {
  try {
    const data = await service.getMaster();
    return res.status(200).json({
      success: true,
      message: 'Data master berhasil diambil',
      data,
    });
  } catch (error) {
    return fail(res, error, 'loading master');
  }
}

async function listBlok(req, res) {
  try {
    const rows = await service.listBlok(req.query.search || '');
    return res.status(200).json({
      success: true,
      message: 'Data blok berhasil diambil',
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, 'listing blok');
  }
}

async function createBlok(req, res) {
  try {
    const data = await service.createBlok({
      blok: req.body?.blok,
      idWarehouse: req.body?.idWarehouse,
    });
    return res
      .status(201)
      .json({ success: true, message: 'Data blok berhasil disimpan', data });
  } catch (error) {
    return fail(res, error, 'creating blok');
  }
}

async function updateBlok(req, res) {
  try {
    const data = await service.updateBlok(req.params.blok, {
      idWarehouse: req.body?.idWarehouse,
    });
    return res
      .status(200)
      .json({ success: true, message: 'Data blok berhasil diubah', data });
  } catch (error) {
    return fail(res, error, 'updating blok');
  }
}

async function removeBlok(req, res) {
  try {
    await service.removeBlok(req.params.blok);
    return res
      .status(200)
      .json({ success: true, message: 'Data blok berhasil dihapus' });
  } catch (error) {
    return fail(res, error, 'deleting blok');
  }
}

async function listLokasi(req, res) {
  try {
    const rows = await service.listLokasi(req.query.blok || '');
    return res.status(200).json({
      success: true,
      message: 'Data lokasi berhasil diambil',
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, 'listing lokasi');
  }
}

async function nextLokasiId(req, res) {
  try {
    const blok = String(req.query.blok || '').trim().toUpperCase();
    if (!blok) {
      return res
        .status(400)
        .json({ success: false, message: 'Pilih blok terlebih dahulu.' });
    }
    const nextId = await service.nextIdLokasi(blok);
    return res.status(200).json({
      success: true,
      message: 'ID lokasi berikutnya berhasil diambil',
      data: { nextId },
    });
  } catch (error) {
    return fail(res, error, 'getting next id lokasi');
  }
}

async function createLokasi(req, res) {
  try {
    const data = await service.createLokasi({
      blok: req.body?.blok,
      description: req.body?.description,
      enable: req.body?.enable,
    });
    return res
      .status(201)
      .json({ success: true, message: 'Data lokasi berhasil disimpan', data });
  } catch (error) {
    return fail(res, error, 'creating lokasi');
  }
}

async function updateLokasi(req, res) {
  try {
    const data = await service.updateLokasi(
      req.params.blok,
      req.params.idLokasi,
      { description: req.body?.description, enable: req.body?.enable },
    );
    return res
      .status(200)
      .json({ success: true, message: 'Data lokasi berhasil diubah', data });
  } catch (error) {
    return fail(res, error, 'updating lokasi');
  }
}

async function removeLokasi(req, res) {
  try {
    await service.removeLokasi(req.params.blok, req.params.idLokasi);
    return res
      .status(200)
      .json({ success: true, message: 'Data lokasi berhasil dihapus' });
  } catch (error) {
    return fail(res, error, 'deleting lokasi');
  }
}

async function listJenis(req, res) {
  try {
    const rows = await service.listJenis(req.query.idKategori);
    return res.status(200).json({
      success: true,
      message: 'Daftar jenis berhasil diambil',
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, 'listing jenis');
  }
}

async function listLokasiJenis(req, res) {
  try {
    const rows = await service.listLokasiJenis(req.query.blok, req.query.idLokasi);
    return res.status(200).json({
      success: true,
      message: 'Daftar jenis lokasi berhasil diambil',
      totalData: rows.length,
      data: rows,
    });
  } catch (error) {
    return fail(res, error, 'listing lokasi jenis');
  }
}

async function addLokasiJenis(req, res) {
  try {
    await service.addLokasiJenis({
      blok: req.body?.blok,
      idLokasi: req.body?.idLokasi,
      idKategori: req.body?.idKategori,
      idJenis: req.body?.idJenis,
    });
    return res.status(201).json({
      success: true,
      message: 'Jenis berhasil ditambahkan ke lokasi',
    });
  } catch (error) {
    return fail(res, error, 'adding lokasi jenis');
  }
}

async function removeLokasiJenis(req, res) {
  try {
    await service.removeLokasiJenis(
      req.params.blok,
      req.params.idLokasi,
      req.params.idKategori,
      req.params.idJenis,
    );
    return res.status(200).json({
      success: true,
      message: 'Jenis berhasil dihapus dari lokasi',
    });
  } catch (error) {
    return fail(res, error, 'removing lokasi jenis');
  }
}

module.exports = {
  getMaster,
  listBlok,
  createBlok,
  updateBlok,
  removeBlok,
  listLokasi,
  nextLokasiId,
  createLokasi,
  updateLokasi,
  removeLokasi,
  listJenis,
  listLokasiJenis,
  addLokasiJenis,
  removeLokasiJenis,
};
