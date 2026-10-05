const spkService = require("./spk-barang-jadi-service");
const { getActorId, getActorUsername, makeRequestId } = require("../../core/utils/http-context");

async function getMonitoring(req, res) {
  try {
    const result = await spkService.getMonitoring({
      search: req.query.search,
      status: req.query.status,
      sort: req.query.sort,
      dir: req.query.dir,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });

    return res.status(200).json({
      success: true,
      message: "Data monitoring SPK berhasil diambil",
      totalData: result.total,
      data: result.data,
      meta: {
        ...result.meta,
        summary: result.summary,
      },
    });
  } catch (err) {
    console.error("[SPKBarangJadi][getMonitoring]", err);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : err.message || "Error",
    });
  }
}

async function createSpk(req, res) {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized (actorId missing)",
      });
    }

    const actorUsername = getActorUsername(req) || req.username || "system";
    const requestId = String(makeRequestId(req) || "").trim();
    if (requestId) res.setHeader("x-request-id", requestId);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const items = (Array.isArray(body.items) ? body.items : []).map((item) => ({
      IdBJ: item?.IdBJ ?? item?.idBJ ?? null,
      QtySPK: item?.QtySPK ?? item?.qtySpk ?? item?.qty ?? null,
    }));

    const payload = {
      tanggal: body.tanggal || body.tgl || null,
      keterangan: body.keterangan ?? body.remark ?? null,
      items,
    };

    const result = await spkService.createSpk(payload, { actorId });

    return res.status(201).json({
      success: true,
      message: "SPK berhasil dibuat",
      data: result,
      meta: {
        actorId,
        actorUsername,
        requestId,
      },
    });
  } catch (err) {
    console.error("[SPKBarangJadi][createSpk]", err);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : err.message || "Error",
      error: {
        message: err.message,
      },
    });
  }
}

async function getSpkDetail(req, res) {
  try {
    const result = await spkService.getSpkDetail(req.params.noSPK);
    return res.status(200).json({
      success: true,
      message: "Detail SPK berhasil diambil",
      data: result,
    });
  } catch (err) {
    console.error("[SPKBarangJadi][getSpkDetail]", err);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : err.message || "Error",
    });
  }
}

async function getSpkHistory(req, res) {
  try {
    const result = await spkService.getSpkHistory({
      idBJ: req.query.idBJ,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });

    return res.status(200).json({
      success: true,
      message: "Riwayat SPK berhasil diambil",
      totalData: result.total,
      data: result.data,
      meta: result.meta,
    });
  } catch (err) {
    console.error("[SPKBarangJadi][getSpkHistory]", err);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : err.message || "Error",
    });
  }
}

module.exports = { getMonitoring, createSpk, getSpkDetail, getSpkHistory };
