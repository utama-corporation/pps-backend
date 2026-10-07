const service = require('./laporan-service');

function fail(res, error, ctx) {
  const statusCode = error.statusCode || 500;
  console.error(`Error ${ctx} Laporan:`, error);
  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal Server Error' : error.message,
    ...(statusCode === 500 ? { error: error.message } : {}),
  });
}

function sendData(res, data, message) {
  return res.status(200).json({
    success: true,
    message,
    ...data,
  });
}

async function getWarehouseOptions(req, res) {
  try {
    const options = await service.getWarehouseOptions();
    return res.status(200).json({
      success: true,
      message: 'Data opsi warehouse berhasil diambil',
      options,
    });
  } catch (error) {
    return fail(res, error, 'listing warehouse options');
  }
}

async function stokBahanBaku(req, res) {
  try {
    const data = await service.stokBahanBaku(req.query);
    return sendData(res, data, 'Laporan Stok Bahan Baku berhasil diambil');
  } catch (error) {
    return fail(res, error, 'stok bahan baku');
  }
}

async function mutasiBahanBaku(req, res) {
  try {
    const data = await service.mutasiBahanBaku(req.query);
    return sendData(res, data, 'Laporan Mutasi Bahan Baku berhasil diambil');
  } catch (error) {
    return fail(res, error, 'mutasi bahan baku');
  }
}

async function penerimaanBahanBaku(req, res) {
  try {
    const data = await service.penerimaanBahanBaku(req.query);
    return sendData(res, data, 'Laporan Penerimaan Bahan Baku berhasil diambil');
  } catch (error) {
    return fail(res, error, 'penerimaan bahan baku');
  }
}

async function kartuStokBahanBaku(req, res) {
  try {
    const data = await service.kartuStokBahanBaku(req.query);
    return sendData(res, data, 'Laporan Kartu Stok Bahan Baku berhasil diambil');
  } catch (error) {
    return fail(res, error, 'kartu stok bahan baku');
  }
}

async function umurBahanBaku(req, res) {
  try {
    const data = await service.umurBahanBaku(req.query);
    return sendData(res, data, 'Laporan Umur Bahan Baku berhasil diambil');
  } catch (error) {
    return fail(res, error, 'umur bahan baku');
  }
}

async function stokUmum(req, res) {
  try {
    const data = await service.stokUmum(req.params.jenis, req.query);
    return sendData(res, data, `Laporan Stok ${req.params.jenis} berhasil diambil`);
  } catch (error) {
    return fail(res, error, `stok ${req.params.jenis}`);
  }
}

async function stokReject(req, res) {
  try {
    const data = await service.stokReject(req.query);
    return sendData(res, data, 'Laporan Stok Reject berhasil diambil');
  } catch (error) {
    return fail(res, error, 'stok reject');
  }
}

async function mutasiUmum(req, res) {
  try {
    const data = await service.mutasiUmum(req.params.jenis, req.query);
    return sendData(res, data, `Laporan Mutasi ${req.params.jenis} berhasil diambil`);
  } catch (error) {
    return fail(res, error, `mutasi ${req.params.jenis}`);
  }
}

async function umurKategori(req, res) {
  try {
    const data = await service.umurKategori(req.params.jenis, req.query);
    return sendData(res, data, `Laporan Umur ${req.params.jenis} berhasil diambil`);
  } catch (error) {
    return fail(res, error, `umur ${req.params.jenis}`);
  }
}

async function produksiKategori(req, res) {
  try {
    const data = await service.produksiKategori(req.params.jenis, req.query);
    return sendData(res, data, `Laporan Produksi ${req.params.jenis} berhasil diambil`);
  } catch (error) {
    return fail(res, error, `produksi ${req.params.jenis}`);
  }
}

async function rekapProduksi(req, res) {
  try {
    const data = await service.rekapProduksi(req.params.jenis, req.query);
    return sendData(res, data, `Laporan Rekap ${req.params.jenis} berhasil diambil`);
  } catch (error) {
    return fail(res, error, `rekap ${req.params.jenis}`);
  }
}

async function semuaLabel(req, res) {
  try {
    const data = await service.semuaLabel();
    return sendData(res, data, 'Laporan Semua Label berhasil diambil');
  } catch (error) {
    return fail(res, error, 'semua label');
  }
}

async function dashboardProduktifitas(req, res) {
  try {
    const data = await service.dashboardProduktifitas(req.query);
    return sendData(res, data, 'Laporan Dashboard Produktifitas berhasil diambil');
  } catch (error) {
    return fail(res, error, 'dashboard produktifitas');
  }
}

async function hasilProduksi(req, res) {
  try {
    const data = await service.hasilProduksi(req.query);
    return sendData(res, data, 'Laporan Hasil Produksi berhasil diambil');
  } catch (error) {
    return fail(res, error, 'hasil produksi');
  }
}

async function produktivitas(req, res) {
  try {
    const data = await service.produktivitas(req.params.jenis, req.query);
    return sendData(res, data, `Laporan Produktivitas ${req.params.jenis} berhasil diambil`);
  } catch (error) {
    return fail(res, error, `produktivitas ${req.params.jenis}`);
  }
}

async function rekapHarian(req, res) {
  try {
    const data = await service.rekapHarian(req.query);
    return sendData(res, data, 'Laporan Rekap Produksi Harian berhasil diambil');
  } catch (error) {
    return fail(res, error, 'rekap harian');
  }
}

module.exports = {
  getWarehouseOptions,
  stokBahanBaku,
  mutasiBahanBaku,
  penerimaanBahanBaku,
  kartuStokBahanBaku,
  umurBahanBaku,
  stokUmum,
  stokReject,
  mutasiUmum,
  umurKategori,
  produksiKategori,
  rekapProduksi,
  semuaLabel,
  dashboardProduktifitas,
  hasilProduksi,
  produktivitas,
  rekapHarian,
};
