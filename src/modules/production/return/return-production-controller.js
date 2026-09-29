// controllers/return-production-controller.js
const returnService = require('./return-production-service');



async function getAllReturns(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSizeRaw = parseInt(req.query.pageSize, 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

  // support ?noRetur= or ?search=
  const search =
    (typeof req.query.noRetur === 'string' && req.query.noRetur) ||
    (typeof req.query.search === 'string' && req.query.search) ||
    '';

  // OPTIONAL date range (YYYY-MM-DD)
  const dateFrom =
    (typeof req.query.dateFrom === 'string' && req.query.dateFrom) || null;
  const dateTo =
    (typeof req.query.dateTo === 'string' && req.query.dateTo) || null;

  try {
    const { data, total } = await returnService.getAllReturns(
      page,
      pageSize,
      search,
      dateFrom,
      dateTo
    );

    return res.status(200).json({
      success: true,
      message: 'BJRetur_h retrieved successfully',
      totalData: total,
      data,
      meta: {
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1,
        search,
        dateFrom,
        dateTo,
      },
    });
  } catch (error) {
    console.error('Error fetching BJRetur_h:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}


async function getReturnsByDate(req, res) {
  const { username } = req;
  const date = req.params.date;

  console.log('🔍 Fetching BJRetur_h | Username:', username, '| date:', date);

  try {
    const data = await returnService.getReturnsByDate(date);

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(200).json({
        success: true,
        message: `No return data found for date ${date}`,
        totalData: 0,
        data: [],
        meta: { date },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Return data for ${date} retrieved successfully`,
      totalData: data.length,
      data,
      meta: { date },
    });
  } catch (error) {
    console.error('Error fetching BJRetur_h:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
}

async function createReturn(req, res) {
  try {
    const username = req.username || req.user?.username || 'system';
    const idUsername = req.idUsername ?? req.user?.idUsername ?? null; // optional if table has it
    const b = req.body || {};

    const toInt = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : Math.trunc(n);
    };

    const payload = {
      tanggal: b.tanggal, // required (YYYY-MM-DD)
      invoice: (b.invoice ?? '').toString().trim() || null, // optional
      idPembeli: toInt(b.idPembeli), // required
      noBJSortir: (b.noBJSortir ?? '').toString().trim() || null, // optional
      idUsername: toInt(b.idUsername) ?? idUsername, // optional, only used if you store it
      _actor: username,
    };

    const result = await returnService.createReturn(payload);

    return res.status(201).json({
      success: true,
      message: 'BJRetur_h created',
      data: result.header,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Internal Error',
    });
  }
}


async function updateReturn(req, res) {
  try {
    const username = req.username || req.user?.username || 'system';
    const noRetur = String(req.params.noRetur || '').trim();

    if (!noRetur) {
      return res.status(400).json({ success: false, message: 'noRetur wajib' });
    }

    const b = req.body || {};

    const toInt = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : Math.trunc(n);
    };

    // ✅ HEADER ONLY payload (no details arrays)
    const payload = {
      tanggal: b.tanggal ?? undefined,      // optional, YYYY-MM-DD
      invoice: b.invoice ?? undefined,      // optional
      idPembeli: (b.idPembeli !== undefined) ? toInt(b.idPembeli) : undefined, // optional
      noBJSortir: b.noBJSortir ?? undefined, // optional
      updateBy: username, // log only
    };

    const result = await returnService.updateReturn(noRetur, payload);

    return res.status(200).json({
      success: true,
      message: 'BJRetur_h updated',
      data: result.header,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Internal Error',
    });
  }
}

async function deleteReturn(req, res) {
  try {
    const noRetur = String(req.params.noRetur || '').trim();
    if (!noRetur) {
      return res.status(400).json({
        success: false,
        message: 'noRetur is required in route param',
      });
    }

    await returnService.deleteReturn(noRetur);

    return res.status(200).json({ success: true, message: 'Deleted' });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Internal Error',
    });
  }
}

async function getOutputsFurnitureWipByNoRetur(req, res) {
  const noRetur = String(req.params.noRetur || "").trim();
  if (!noRetur) {
    return res
      .status(400)
      .json({ success: false, message: "noRetur is required" });
  }

  try {
    const data = await returnService.fetchOutputsFurnitureWip(noRetur);
    return res.status(200).json({
      success: true,
      message: data.length > 0 ? "Data label berhasil diambil" : "Data label tidak ditemukan",
      data,
    });
  } catch (e) {
    console.error("[return.getOutputsFurnitureWipByNoRetur]", e);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: e.message,
    });
  }
}

async function getOutputsBarangJadiByNoRetur(req, res) {
  const noRetur = String(req.params.noRetur || "").trim();
  if (!noRetur) {
    return res
      .status(400)
      .json({ success: false, message: "noRetur is required" });
  }

  try {
    const data = await returnService.fetchOutputsBarangJadi(noRetur);
    return res.status(200).json({
      success: true,
      message: data.length > 0 ? "Data label berhasil diambil" : "Data label tidak ditemukan",
      data,
    });
  } catch (e) {
    console.error("[return.getOutputsBarangJadiByNoRetur]", e);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: e.message,
    });
  }
}


async function getImportAsGsuByDate(req, res) {
  const date = req.params.date;
  try {
    const data = await returnService.fetchImportAsGsuByDate(date);
    return res.status(200).json({
      success: true,
      message: `AS_GSU data for ${date} retrieved`,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("[return.getImportAsGsuByDate]", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getImportAsGsuAfterDate(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSizeRaw = parseInt(req.query.pageSize, 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

  try {
    const { data, total } = await returnService.fetchImportAsGsuAfterDate(
      page,
      pageSize,
    );
    return res.status(200).json({
      success: true,
      message: `AS_GSU data for ${returnService.IMPORT_AS_GSU_CUTOFF_DATE} retrieved`,
      totalData: total,
      data,
      meta: {
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("[return.getImportAsGsuAfterDate]", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function importAsGsu(req, res) {
  try {
    const username = req.username || req.user?.username || 'system';
    const { date, items } = req.body || {};
    if (!date || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'date and items[] required' });
    }
    const result = await returnService.executeImportAsGsu(date, items, username);
    return res.status(201).json({
      success: true,
      message: 'Import AS_GSU completed',
      data: result,
    });
  } catch (error) {
    console.error("[return.importAsGsu]", error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Internal Error',
    });
  }
}

async function getAllOutputsByNoRetur(req, res) {
  const noRetur = String(req.params.noRetur || "").trim();
  if (!noRetur) {
    return res
      .status(400)
      .json({ success: false, message: "noRetur is required" });
  }

  try {
    const result = await returnService.fetchAllOutputs(noRetur);

    return res.status(200).json({
      success: true,
      message: `Outputs untuk retur ${noRetur} berhasil diambil`,

      noRetur,

      totalData: result.total,
      totalFurnitureWip: result.totalFurnitureWip,
      totalBarangJadi: result.totalBarangJadi,

      data: result.data,
    });
  } catch (e) {
    console.error("[return.getAllOutputsByNoRetur]", e);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: e.message,
    });
  }
}

module.exports = {
  getAllReturns,
  getReturnsByDate,
  createReturn,
  updateReturn,
  deleteReturn,
  getOutputsFurnitureWipByNoRetur,
  getOutputsBarangJadiByNoRetur,
  getImportAsGsuByDate,
  getImportAsGsuAfterDate,
  importAsGsu,
  getAllOutputsByNoRetur,
};
