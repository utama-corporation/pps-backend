// controllers/spanner-production-controller.js
const spannerService = require("./spanner-production-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../../core/utils/http-context");
const {
  toInt,
  toFloat,
  normalizeTime,
  toBit,
  toIntUndef,
  toFloatUndef,
  toBitUndef,
  toStrUndef,
  toJamInt,
} = require("../../../core/utils/parse");

async function getAllProduksi(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSizeRaw = parseInt(req.query.pageSize, 10) || 20;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

  // support both ?noProduksi= and ?search=
  const search =
    (typeof req.query.noProduksi === "string" && req.query.noProduksi) ||
    (typeof req.query.search === "string" && req.query.search) ||
    "";

  try {
    const { data, total } = await spannerService.getAllProduksi(
      page,
      pageSize,
      search,
    );

    return res.status(200).json({
      success: true,
      message: "Spanner_h retrieved successfully",
      totalData: total,
      data,
      meta: {
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1,
        search,
      },
    });
  } catch (error) {
    console.error("Error fetching Spanner_h:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getProductionByDate(req, res) {
  const { username } = req;
  const date = req.params.date;

  console.log("🔍 Fetching Spanner_h | Username:", username, "| date:", date);

  try {
    const data = await spannerService.getProductionByDate(date);

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(200).json({
        success: true,
        message: `No spanner production data found for date ${date}`,
        totalData: 0,
        data: [],
        meta: { date },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Spanner production data for ${date} retrieved successfully`,
      totalData: data.length,
      data,
      meta: { date },
    });
  } catch (error) {
    console.error("Error fetching Spanner_h:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function createProduksi(req, res) {
  try {
    // ===============================
    // Audit context
    // ===============================
    const actorId = getActorId(req);
    if (!actorId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized (actorId missing)" });
    }

    const actorUsername =
      getActorUsername(req) || req.username || req.user?.username || "system";

    const requestId = String(makeRequestId(req) || "").trim();
    if (requestId) res.setHeader("x-request-id", requestId);

    // ===============================
    // Body tanpa audit fields dari client
    // ===============================
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const {
      createBy: _cCreateBy,
      checkBy1: _cCheckBy1,
      checkBy2: _cCheckBy2,
      approveBy: _cApproveBy,
      ...b
    } = body;

    // ===============================
    // Payload business
    // ===============================
    const idOperators = Array.isArray(b.idOperators)
      ? b.idOperators.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : b.idOperator != null
        ? [toInt(b.idOperator)].filter(Boolean)
        : [];

    const payload = {
      tglProduksi: b.tglProduksi,
      idMesin: toInt(b.idMesin),
      idOperators,
      outputJenisId: toInt(b.outputJenisId),
      idRegu: toInt(b.idRegu),
      shift: toInt(b.shift),
      jamKerja: b.jamKerja ?? null,
      hourMeter: toFloat(b.hourMeter),
      hourStart: normalizeTime(b.hourStart) ?? null,
      hourEnd: normalizeTime(b.hourEnd) ?? null,
      createBy: actorUsername,
      checkBy1: null,
      checkBy2: null,
      approveBy: null,
    };

    // ===============================
    // Quick validation
    // ===============================
    const must = [];
    if (!payload.tglProduksi) must.push("tglProduksi");
    if (payload.idMesin == null) must.push("idMesin");
    if (idOperators.length === 0) must.push("idOperators");
    if (payload.outputJenisId == null) must.push("outputJenisId");
    if (payload.idRegu == null) must.push("idRegu");
    if (payload.shift == null) must.push("shift");

    if (must.length) {
      return res.status(400).json({
        success: false,
        message: `Field wajib: ${must.join(", ")}`,
        error: { fields: must },
      });
    }

    // ===============================
    // Call service
    // ===============================
    const result = await spannerService.createSpannerProduksi(payload, {
      actorId,
      actorUsername,
      requestId,
    });

    return res.status(201).json({
      success: true,
      message: "Spanner_h created",
      data: result.header,
      meta: { audit: result.audit },
    });
  } catch (err) {
    console.error("[Spanner][createSpannerProduksi]", err);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message:
        status === 500 ? "Internal Server Error" : err.message || "Error",
      error: {
        message: err.message,
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      meta:
        err.actorId && err.actorUsername
          ? {
              actorId: err.actorId,
              actorUsername: err.actorUsername,
              requestId: err.requestId,
            }
          : undefined,
    });
  }
}

async function updateProduksi(req, res) {
  try {
    // ===============================
    // Audit context
    // ===============================
    const actorId = getActorId(req);
    if (!actorId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized (actorId missing)" });
    }

    const actorUsername =
      getActorUsername(req) || req.username || req.user?.username || "system";

    const requestId = String(makeRequestId(req) || "").trim();
    if (requestId) res.setHeader("x-request-id", requestId);

    // ===============================
    // Route param
    // ===============================
    const noProduksi = String(req.params.noProduksi || "").trim();
    if (!noProduksi) {
      return res
        .status(400)
        .json({ success: false, message: "noProduksi wajib" });
    }

    // ===============================
    // Body (tanpa audit fields client)
    // ===============================
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const {
      updateBy: _cUpdateBy,
      checkBy1: _cCheckBy1,
      checkBy2: _cCheckBy2,
      approveBy: _cApproveBy,
      ...b
    } = body;

    // ===============================
    // Payload business
    // ===============================
    const payload = {
      // optional
      tglProduksi: b.tglProduksi,

      idMesin: b.idMesin !== undefined ? toInt(b.idMesin) : undefined,
      idOperator: b.idOperator !== undefined ? toInt(b.idOperator) : undefined,
      shift: b.shift !== undefined ? toInt(b.shift) : undefined,

      jamKerja: b.jamKerja, // boleh null

      hourMeter: b.hourMeter !== undefined ? toFloat(b.hourMeter) : undefined,

      // penting: distinguish "tidak dikirim" vs null
      hourStart: b.hourStart ?? undefined,
      hourEnd: b.hourEnd ?? undefined,

      checkBy1: b.checkBy1,
      checkBy2: b.checkBy2,
      approveBy: b.approveBy,
    };

    // ===============================
    // Call service
    // ===============================
    const result = await spannerService.updateSpannerProduksi(
      noProduksi,
      payload,
      { actorId, actorUsername, requestId },
    );

    return res.status(200).json({
      success: true,
      message: "Spanner_h updated",
      data: result.header,
      meta: {
        audit: result.audit || { actorId, actorUsername, requestId },
      },
    });
  } catch (err) {
    const status = err.statusCode || err.status || 500;

    return res.status(status).json({
      success: false,
      message:
        status === 500 ? "Internal Server Error" : err.message || "Error",
      error: {
        message: err.message,
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      meta:
        err.actorId && err.actorUsername
          ? {
              actorId: err.actorId,
              actorUsername: err.actorUsername,
              requestId: err.requestId,
            }
          : undefined,
    });
  }
}

async function deleteProduksi(req, res) {
  try {
    // ===============================
    // Audit context
    // ===============================
    const actorId = getActorId(req);
    if (!actorId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized (actorId missing)" });
    }

    const actorUsername =
      getActorUsername(req) || req.username || req.user?.username || "system";

    const requestId = String(makeRequestId(req) || "").trim();
    if (requestId) res.setHeader("x-request-id", requestId);

    // ===============================
    // Get noProduksi
    // ===============================
    const noProduksi = String(req.params.noProduksi || "").trim();
    if (!noProduksi) {
      return res
        .status(400)
        .json({ success: false, message: "noProduksi wajib" });
    }

    // ===============================
    // Call service with audit context
    // ===============================
    const result = await spannerService.deleteSpannerProduksi(noProduksi, {
      actorId,
      actorUsername,
      requestId,
    });

    return res.status(200).json({
      success: true,
      message: "Spanner_h deleted",
      meta: { audit: result.audit },
    });
  } catch (err) {
    console.error("[Spanner][deleteSpannerProduksi]", err);

    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : err.message,
      error: {
        message: err.message,
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      meta:
        err.actorId && err.actorUsername
          ? {
              audit: {
                actorId: err.actorId,
                actorUsername: err.actorUsername,
                requestId: err.requestId,
              },
            }
          : undefined,
    });
  }
}

async function getInputsByNoProduksi(req, res) {
  const noProduksi = String(req.params.noProduksi || "").trim();
  if (!noProduksi) {
    return res
      .status(400)
      .json({ success: false, message: "noProduksi is required" });
  }

  try {
    const data = await spannerService.fetchInputs(noProduksi);
    return res
      .status(200)
      .json({ success: true, message: "Inputs retrieved", data });
  } catch (e) {
    console.error("[spanner.getInputsByNoProduksi]", e);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: e.message,
    });
  }
}

async function getOutputsByNoProduksi(req, res) {
  const noProduksi = String(req.params.noProduksi || "").trim();
  if (!noProduksi) {
    return res
      .status(400)
      .json({ success: false, message: "noProduksi is required" });
  }

  try {
    const data = await spannerService.fetchOutputs(noProduksi);
    return res
      .status(200)
      .json({ success: true, message: "Outputs retrieved", data });
  } catch (e) {
    console.error("[spanner.getOutputsByNoProduksi]", e);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: e.message,
    });
  }
}

async function getOutputsRejectByNoProduksi(req, res) {
  const noProduksi = String(req.params.noProduksi || "").trim();
  if (!noProduksi) {
    return res
      .status(400)
      .json({ success: false, message: "noProduksi is required" });
  }

  try {
    const data = await spannerService.fetchOutputsReject(noProduksi);
    return res
      .status(200)
      .json({ success: true, message: "Outputs retrieved", data });
  } catch (e) {
    console.error("[spanner.getOutputsRejectByNoProduksi]", e);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: e.message,
    });
  }
}

async function upsertInputsAndPartials(req, res) {
  const noProduksi = String(req.params.noProduksi || "").trim();

  if (!noProduksi) {
    return res.status(400).json({
      success: false,
      message: "noProduksi is required",
      error: {
        field: "noProduksi",
        message: "Parameter noProduksi tidak boleh kosong",
      },
    });
  }

  // ✅ Pastikan body object
  const body = req.body && typeof req.body === "object" ? req.body : {};

  // ✅ Strip client audit fields (jangan percaya dari client)
  const {
    actorId: _clientActorId,
    actorUsername: _clientActorUsername,
    actor: _clientActor,
    requestId: _clientRequestId,
    ...payload
  } = body;

  // ✅ Get trusted audit context from token/session
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized (idUsername missing)",
    });
  }

  const actorUsername =
    getActorUsername(req) || req.username || req.user?.username || "system";
  const requestId = String(makeRequestId(req) || "").trim();

  // Optional: echo header for tracing
  if (requestId) res.setHeader("x-request-id", requestId);

  // ✅ Validate: at least one input exists
  const hasInput = [
    "furnitureWip",
    "cabinetMaterial",
    "furnitureWipPartial",
  ].some(
    (key) =>
      payload[key] && Array.isArray(payload[key]) && payload[key].length > 0,
  );

  if (!hasInput) {
    return res.status(400).json({
      success: false,
      message: "Tidak ada data input yang diberikan",
      error: {
        message:
          "Request body harus berisi minimal satu array input yang tidak kosong",
      },
    });
  }

  try {
    // ✅ Forward audit context ke service
    const ctx = { actorId, actorUsername, requestId };

    const result = await spannerService.upsertInputsAndPartials(
      noProduksi,
      payload,
      ctx,
    );

    // Support beberapa bentuk return (backward compatible)
    const success = result?.success !== undefined ? !!result.success : true;
    const hasWarnings = !!result?.hasWarnings;
    const data = result?.data ?? result;

    let statusCode = 200;
    let message = "Inputs & partials processed successfully";

    if (!success) {
      const totalInvalid = Number(data?.summary?.totalInvalid ?? 0);
      const totalInserted = Number(data?.summary?.totalInserted ?? 0);
      const totalUpdated = Number(data?.summary?.totalUpdated ?? 0); // ✅ Support UPSERT
      const totalPartialsCreated = Number(
        data?.summary?.totalPartialsCreated ?? 0,
      );

      if (totalInvalid > 0) {
        statusCode = 422;
        message = "Beberapa data tidak valid";
      } else if (
        totalInserted + totalUpdated === 0 &&
        totalPartialsCreated === 0
      ) {
        statusCode = 400;
        message = "Tidak ada data yang berhasil diproses";
      }
    } else if (hasWarnings) {
      message = "Inputs & partials processed with warnings";
    }

    return res.status(statusCode).json({
      success,
      message,
      data,
      meta: {
        noProduksi,
        hasInput,
        audit: { actorId, actorUsername, requestId },
      },
    });
  } catch (e) {
    console.error("[inject.upsertInputsAndPartials]", e);
    const status = e.statusCode || e.status || 500;

    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : e.message,
      error: {
        message: e.message,
        details: process.env.NODE_ENV === "development" ? e.stack : undefined,
      },
    });
  }
}

async function deleteInputsAndPartials(req, res) {
  const noProduksi = String(req.params.noProduksi || "").trim();

  if (!noProduksi) {
    return res.status(400).json({
      success: false,
      message: "noProduksi is required",
      error: {
        field: "noProduksi",
        message: "Parameter noProduksi tidak boleh kosong",
      },
    });
  }

  // ✅ Strip client audit fields
  const {
    actorId: _clientActorId,
    actorUsername: _clientActorUsername,
    actor: _clientActor,
    requestId: _clientRequestId,
    ...payload
  } = req.body || {};

  // ✅ Get trusted audit context
  const actorId = getActorId(req);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized (idUsername missing)",
    });
  }

  const actorUsername =
    getActorUsername(req) || req.username || req.user?.username || "system";
  const requestId = String(makeRequestId(req) || "").trim();

  if (requestId) res.setHeader("x-request-id", requestId);

  // ✅ Validate input
  const hasInput = [
    "furnitureWip",
    "cabinetMaterial",
    "furnitureWipPartial",
  ].some(
    (key) =>
      payload[key] && Array.isArray(payload[key]) && payload[key].length > 0,
  );

  if (!hasInput) {
    return res.status(400).json({
      success: false,
      message: "Tidak ada data input yang diberikan",
      error: {
        message:
          "Request body harus berisi minimal satu array input yang tidak kosong",
      },
    });
  }

  try {
    // ✅ Forward audit context
    const ctx = { actorId, actorUsername, requestId };

    const result = await spannerService.deleteInputsAndPartials(
      noProduksi,
      payload,
      ctx,
    );

    const { success, hasWarnings, data } = result;

    let statusCode = 200;
    let message = "Inputs & partials deleted successfully";

    if (!success) {
      statusCode = 404;
      message = "Tidak ada data yang berhasil dihapus";
    } else if (hasWarnings) {
      message = "Inputs & partials deleted with warnings";
    }

    return res.status(statusCode).json({
      success,
      message,
      data,
      meta: {
        noProduksi,
        hasInput,
        audit: { actorId, actorUsername, requestId },
      },
    });
  } catch (e) {
    console.error("[inject.deleteInputsAndPartials]", e);
    const status = e.statusCode || e.status || 500;

    return res.status(status).json({
      success: false,
      message: status === 500 ? "Internal Server Error" : e.message,
      error: {
        message: e.message,
        details: process.env.NODE_ENV === "development" ? e.stack : undefined,
      },
    });
  }
}

async function splitProduksiTime(req, res) {
  const normalizeSqlTimeToHms = (value) => {
    if (value == null) return value;
    if (value instanceof Date) {
      const hh = String(value.getUTCHours()).padStart(2, "0");
      const mm = String(value.getUTCMinutes()).padStart(2, "0");
      const ss = String(value.getUTCSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    const raw = String(value).trim();
    const m = /(\d{2}):(\d{2}):(\d{2})/.exec(raw);
    return m ? `${m[1]}:${m[2]}:${m[3]}` : raw;
  };

  const idMesinRaw = String(req.params.idMesin || "").trim();
  const tanggal = String(req.params.tanggal || "").trim();

  const idMesin = Number(idMesinRaw);
  if (!Number.isInteger(idMesin) || idMesin <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "idMesin harus integer positif" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return res.status(400).json({
      success: false,
      message: "tanggal harus format YYYY-MM-DD",
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const hourStart = String(body.hourStart || "").trim();
  const outputJenisId = Number(body.outputJenisId);

  if (!hourStart) {
    return res.status(400).json({
      success: false,
      message: "hourStart wajib diisi",
    });
  }
  const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
  if (!timeRegex.test(hourStart)) {
    return res.status(400).json({
      success: false,
      message: "Format hourStart harus HH:mm atau HH:mm:ss",
    });
  }
  if (!Number.isInteger(outputJenisId) || outputJenisId <= 0) {
    return res.status(400).json({
      success: false,
      message: "outputJenisId wajib integer positif",
    });
  }

  const actorId = getActorId(req);
  if (!actorId) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized (idUsername missing)" });
  }

  const actorUsername =
    getActorUsername(req) || req.username || req.user?.username || "system";
  const requestId = String(makeRequestId(req) || "").trim();
  if (requestId) res.setHeader("x-request-id", requestId);

  try {
    const ctx = { actorId, actorUsername, requestId };
    const result = await spannerService.splitProduksiTime(
      { idMesin, tanggal },
      { hourStart, outputJenisId },
      ctx,
    );

    const header = result?.header
      ? {
          ...result.header,
          HourStart: normalizeSqlTimeToHms(result.header.HourStart),
          HourEnd: normalizeSqlTimeToHms(result.header.HourEnd),
        }
      : result?.header;

    return res.status(201).json({
      success: true,
      message: "Produksi berhasil di-split",
      data: {
        ...result,
        header,
      },
      meta: { audit: { actorId, actorUsername, requestId } },
    });
  } catch (err) {
    console.error("[spanner.splitProduksiTime]", err);
    const status = err.statusCode || err.status || 500;
    return res.status(status).json({
      success: false,
      message:
        status === 500 ? "Internal Server Error" : err.message || "Error",
      error: {
        message: err.message,
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
    });
  }
}

module.exports = {
  getAllProduksi,
  getProductionByDate,
  createProduksi,
  updateProduksi,
  deleteProduksi,
  getInputsByNoProduksi,
  getOutputsByNoProduksi,
  getOutputsRejectByNoProduksi,
  upsertInputsAndPartials,
  deleteInputsAndPartials,
  splitProduksiTime,
};
