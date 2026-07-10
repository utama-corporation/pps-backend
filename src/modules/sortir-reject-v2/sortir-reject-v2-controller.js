const service = require("./sortir-reject-v2-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../core/utils/http-context");
const { buildSortirRejectReportHtml } = require("../../core/utils/pdf/templates/laporan-sortir-reject/sortir-reject-report-pdf");

function makeCtx(req) {
  return {
    actorId: getActorId(req),
    actorUsername: getActorUsername(req) || "system",
    requestId: makeRequestId(req),
  };
}

async function getLabelInfo(req, res) {
  try {
    const data = await service.getLabelInfo(req.params.labelCode);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function getAll(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(parseInt(req.query.pageSize, 10) || 20, 1),
    100,
  );
  const search = (req.query.search || req.query.noBJSortir || "").trim();

  try {
    const result = await service.getAll(page, pageSize, search);
    return res.status(200).json({
      success: true,
      data: result.data,
      total: result.total,
      page,
      pageSize,
    });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function getDetail(req, res) {
  try {
    const data = await service.getDetail(req.params.noBJSortir);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function create(req, res) {
  const { idWarehouse, inputs, outputs } = req.body || {};
  const ctx = makeCtx(req);

  if (!ctx.actorId) {
    return res
      .status(401)
      .json({ success: false, message: "actorId tidak ditemukan dari token" });
  }

  try {
    const result = await service.create({ idWarehouse, inputs, outputs }, ctx);

    return res.status(201).json({ success: true, data: result });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function createReject(req, res) {
  const ctx = makeCtx(req);

  if (!ctx.actorId) {
    return res
      .status(401)
      .json({ success: false, message: "actorId tidak ditemukan dari token" });
  }

  try {
    const result = await service.createReject(
      req.params.noBJSortir,
      req.body || {},
      ctx,
    );

    return res.status(201).json({ success: true, data: result });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function updateSortirReject(req, res) {
  const ctx = makeCtx(req);

  if (!ctx.actorId) {
    return res
      .status(401)
      .json({ success: false, message: "actorId tidak ditemukan dari token" });
  }

  try {
    const result = await service.updateSortirReject(
      req.params.noBJSortir,
      req.body || {},
      ctx,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function deleteSortirReject(req, res) {
  const ctx = makeCtx(req);

  if (!ctx.actorId) {
    return res
      .status(401)
      .json({ success: false, message: "actorId tidak ditemukan dari token" });
  }

  try {
    const result = await service.deleteSortirReject(req.params.noBJSortir, ctx);
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}


function getLaporanQuery(req) {
  const startDate = String(req.query.startDate || req.query.StartDate || "").trim();
  const endDate = String(req.query.endDate || req.query.EndDate || "").trim();
  return {
    startDate,
    endDate,
  };
}

async function getLaporan(req, res) {
  try {
    const params = getLaporanQuery(req);
    const rows = await service.getLaporanBJSortirReject(params);

    return res.status(200).json({
      success: true,
      message: "Data laporan berhasil diambil",
      periode: {
        startDate: params.startDate,
        endDate: params.endDate,
      },
      total: rows.length,
      data: rows,
    });
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}

async function getLaporanHtml(req, res) {
  try {
    const params = getLaporanQuery(req);
    const rows = await service.getLaporanBJSortirReject(params);
    const html = buildSortirRejectReportHtml({
      startDate: params.startDate,
      endDate: params.endDate,
      rows,
    });

    return res.status(200).type("html").send(html);
  } catch (e) {
    return res
      .status(e.statusCode || 500)
      .json({ success: false, message: e.message });
  }
}


async function getLaporanPdf(req, res) {
  try {
    const { startDate, endDate } = req.query;

    const pdfBuffer = await service.getLaporanBJSortirRejectPdf({
      startDate,
      endDate,
    });

    const fileName = `Laporan-BJ-Sortir-Reject-${startDate}-sd-${endDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");

    // Tampil langsung di browser
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    // Kalau mau langsung download, pakai ini:
    // res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("getLaporanPdf error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Gagal membuat PDF laporan",
    });
  }
}

module.exports = {
  getLabelInfo,
  getAll,
  getLaporan,
  getLaporanHtml,
  getLaporanPdf,
  getDetail,
  create,
  createReject,
  updateSortirReject,
  deleteSortirReject,
};
