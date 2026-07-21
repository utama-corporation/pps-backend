const stockOpnameV2Service = require("./stock-opname-v2-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../core/utils/http-context");

async function listKategoriHandler(req, res) {
  const { username } = req;
  const { year, month } = req.query;

  console.log(
    "Fetching kategori (stock-opname-v2) | Username:",
    username,
    "| year:",
    year,
    "| month:",
    month,
  );

  try {
    const data = await stockOpnameV2Service.getAllKategoriWithStatus({
      year,
      month,
    });

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data kategori tidak ditemukan",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: "Data kategori berhasil diambil",
      data,
      totalRecords: data.length,
    });
  } catch (error) {
    console.error("Error fetching kategori (stock-opname-v2):", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function listJenisHandler(req, res) {
  const { username } = req;
  const categoryId = parseInt(req.params.categoryId, 10);

  console.log(
    "Fetching jenis by kategori (stock-opname-v2) | Username:",
    username,
    "| categoryId:",
    categoryId,
  );

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Parameter 'categoryId' wajib berupa integer valid",
    });
  }

  try {
    const result = await stockOpnameV2Service.getJenisByKategori(categoryId);

    if (!result || result.jenis.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data jenis tidak ditemukan untuk kategori tersebut",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: `Data jenis ${result.kategori.namaKategori} berhasil diambil`,
      category: result.kategori,
      data: result.jenis,
      totalRecords: result.jenis.length,
    });
  } catch (error) {
    console.error("Error fetching jenis by kategori (stock-opname-v2):", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function listRiwayatHandler(req, res) {
  const { username } = req;
  const categoryId = parseInt(req.params.categoryId, 10);
  const { year, month, page, pageSize } = req.query;

  console.log(
    "Fetching riwayat stock-opname (stock-opname-v2) | Username:",
    username,
    "| categoryId:",
    categoryId,
    "| year:",
    year,
    "| month:",
    month,
  );

  try {
    const result = await stockOpnameV2Service.getStockOpnameRiwayat({
      categoryId,
      year,
      month,
      page,
      pageSize,
    });

    if (!result.data.length) {
      return res.status(404).json({
        success: false,
        message: `Riwayat stock opname tidak ditemukan untuk kategori ${result.categoryName}`,
        data: result,
      });
    }

    return res.json({
      success: true,
      message: `Riwayat stock opname ${result.categoryName} berhasil diambil`,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching riwayat stock-opname:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function previewLabelCountHandler(req, res) {
  const { categoryId } = req.query || {};

  try {
    const result = await stockOpnameV2Service.previewStockOpnameLabelCount({
      categoryId,
    });

    return res.json({
      success: true,
      message: `Terdapat ${result.labelCount} label ${result.categoryName} per tanggal ${result.date} yang akan digenerate`,
      data: result,
    });
  } catch (error) {
    console.error("Error previewing stock-opname label count:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function generateStockOpnameHandler(req, res) {
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized (idUsername missing)",
    });
  }
  const actorUsername = getActorUsername(req) || "system";
  const requestId = String(makeRequestId(req) || "").trim();
  if (requestId) res.setHeader("x-request-id", requestId);

  const { categoryId } = req.body || {};

  console.log(
    "Generate stock-opname snapshot | Username:",
    req.username,
    "| categoryId:",
    categoryId,
  );

  try {
    const result = await stockOpnameV2Service.generateStockOpname({
      categoryId,
      ctx: { actorId, actorUsername, requestId },
    });

    return res.status(201).json({
      success: true,
      message: `Stock opname ${result.stockOpnameNo} berhasil dibuat`,
      data: result,
    });
  } catch (error) {
    console.error("Error generating stock-opname snapshot:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function completeStockOpnameHandler(req, res) {
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized (idUsername missing)",
    });
  }
  const actorUsername = getActorUsername(req) || "system";
  const requestId = String(makeRequestId(req) || "").trim();
  if (requestId) res.setHeader("x-request-id", requestId);

  const { stockOpnameNo } = req.params;

  console.log(
    "Complete stock-opname | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
  );

  try {
    const result = await stockOpnameV2Service.completeStockOpname({
      stockOpnameNo,
      ctx: { actorId, actorUsername, requestId },
    });

    return res.json({
      success: true,
      message: `Stock opname ${result.stockOpnameNo} berhasil ditandai selesai`,
      data: result,
    });
  } catch (error) {
    console.error("Error completing stock-opname:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function deleteStockOpnameHandler(req, res) {
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized (idUsername missing)",
    });
  }
  const actorUsername = getActorUsername(req) || "system";
  const requestId = String(makeRequestId(req) || "").trim();
  if (requestId) res.setHeader("x-request-id", requestId);

  const { stockOpnameNo } = req.params;

  console.log(
    "Delete stock-opname | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
  );

  try {
    const result = await stockOpnameV2Service.deleteStockOpname({
      stockOpnameNo,
      ctx: { actorId, actorUsername, requestId },
    });

    return res.json({
      success: true,
      message: `Stock opname ${result.stockOpnameNo} berhasil dihapus`,
      data: result,
    });
  } catch (error) {
    console.error("Error deleting stock-opname:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function getJenisInNosoHandler(req, res) {
  const { stockOpnameNo } = req.params;

  console.log(
    "Fetching types in stock opname (stock-opname-v2) | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
  );

  try {
    const result = await stockOpnameV2Service.getTypesInStockOpname({ stockOpnameNo });

    if (!result.data.length) {
      return res.status(404).json({
        success: false,
        message: `Belum ada label ter-snapshot untuk stock opname: ${stockOpnameNo}`,
        data: result,
      });
    }

    return res.json({
      success: true,
      message: `Data jenis ${result.stockOpnameNo} berhasil diambil`,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching types in stock opname:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function getSnapshotHandler(req, res) {
  const { stockOpnameNo, typeId, blok, locationId } = req.params;
  const { page, pageSize, search } = req.query;

  console.log(
    "Fetching stock-opname snapshot | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
    "| typeId:",
    typeId,
    "| blok:",
    blok,
    "| locationId:",
    locationId,
  );

  try {
    const result = await stockOpnameV2Service.getStockOpnameSnapshot({
      stockOpnameNo,
      typeId,
      blok,
      locationId,
      page,
      pageSize,
      search,
    });

    if (!result.data.length) {
      return res.status(404).json({
        success: false,
        message: `Data snapshot tidak ditemukan untuk stock opname: ${stockOpnameNo}`,
        data: result,
      });
    }

    return res.json({
      success: true,
      message: `Data snapshot ${result.stockOpnameNo} berhasil diambil`,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching stock-opname snapshot:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function insertHasilHandler(req, res) {
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized (idUsername missing)",
    });
  }
  const actorUsername = getActorUsername(req) || "system";
  const requestId = String(makeRequestId(req) || "").trim();
  if (requestId) res.setHeader("x-request-id", requestId);

  const { stockOpnameNo } = req.params;
  const { labelNo, palletNo, blok, locationId } = req.body || {};

  console.log(
    "Insert stock-opname hasil | Username:", req.username,
    "| stockOpnameNo:", stockOpnameNo,
    "| labelNo:", labelNo,
    "| blok:", blok,
    "| locationId:", locationId,
  );

  try {
    const result = await stockOpnameV2Service.insertStockOpnameHasil({
      stockOpnameNo,
      labelNo,
      palletNo,
      blok,
      locationId,
      ctx: { actorId, actorUsername, requestId },
    });

    return res.status(201).json({
      success: true,
      message: `Label ${result.labelNo} berhasil dicatat`,
      data: result,
    });
  } catch (error) {
    console.error("Error inserting stock-opname hasil:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function listBlokHandler(req, res) {
  const { stockOpnameNo } = req.params;

  console.log(
    "Fetching blok (stock-opname-v2) | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
  );

  try {
    const data = await stockOpnameV2Service.getAllBlok({ stockOpnameNo });

    if (!data.length) {
      return res.status(404).json({
        success: false,
        message: "Data blok tidak ditemukan",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: "Data blok berhasil diambil",
      data,
      totalRecords: data.length,
    });
  } catch (error) {
    console.error("Error fetching blok:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function getLocationsHandler(req, res) {
  const { stockOpnameNo, blok } = req.params;

  console.log(
    "Fetching locations in blok (stock-opname-v2) | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
    "| blok:",
    blok,
  );

  try {
    const result = await stockOpnameV2Service.getLocationsInBlok({ stockOpnameNo, blok });

    if (!result.data.length) {
      return res.status(404).json({
        success: false,
        message: `Belum ada lokasi untuk blok ${blok} pada stock opname ini`,
        data: result,
      });
    }

    return res.json({
      success: true,
      message: `Data lokasi blok ${blok} berhasil diambil`,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching locations in blok:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function getMyLokasiHandler(req, res) {
  const { stockOpnameNo } = req.params;
  const isBypass =
    req.userPermissions?.has("*") ||
    req.userPermissions?.has("stockopname:create") ||
    false;

  console.log(
    "Fetching my lokasi (stock-opname-v2) | Username:",
    req.username,
    "| stockOpnameNo:",
    stockOpnameNo,
    "| isBypass:",
    isBypass,
  );

  try {
    const result = await stockOpnameV2Service.getMyLokasiForStockOpname({
      stockOpnameNo,
      idUsername: req.idUsername,
      isBypass,
    });

    if (!result.data.length) {
      return res.status(404).json({
        success: false,
        message: `Belum ada lokasi yang ditugaskan untuk Anda pada stock opname ${stockOpnameNo}`,
        data: result,
      });
    }

    return res.json({
      success: true,
      message: `Data lokasi tugas berhasil diambil`,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching my lokasi:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

module.exports = {
  listKategoriHandler,
  listJenisHandler,
  listRiwayatHandler,
  previewLabelCountHandler,
  generateStockOpnameHandler,
  completeStockOpnameHandler,
  deleteStockOpnameHandler,
  getJenisInNosoHandler,
  getSnapshotHandler,
  insertHasilHandler,
  listBlokHandler,
  getLocationsHandler,
  getMyLokasiHandler,
};
