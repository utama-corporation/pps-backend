// barang-dagang-controller.js
const service = require("./barang-dagang-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../../core/utils/http-context");
const { getIo } = require("../../../core/utils/socket-instance");
const { generateLabelPdf } = require("../../../core/utils/pdf/label-generator");
const {
  buildBarangDagangLabelHtml,
} = require("../../../core/utils/pdf/templates/barang-dagang-label-pdf/barang-dagang-label-pdf");

// GET /labels/barang-dagang?page=&limit=&search=
exports.getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const search = (req.query.search || "").trim();
    const includeUsed = String(req.query.includeUsed || "").toLowerCase() === "true";

    const { data, total } = await service.getAll({ page, limit, search, includeUsed });
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.status(200).json({
      success: true,
      data,
      meta: { page, limit, total, totalPages, includeUsed },
    });
  } catch (err) {
    console.error("Get Barang Dagang List Error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

exports.update = async (req, res) => {
  const { noBarangDagang } = req.params;

  try {
    const NoBarangDagang = String(noBarangDagang || "").trim();
    if (!NoBarangDagang) {
      return res.status(400).json({ success: false, message: "noBarangDagang wajib diisi" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ success: false, message: "Unauthorized (idUsername missing)" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { actorId: _clientActorId, requestId: _clientRequestId, ...safeBody } = body;

    const payload = {
      ...safeBody,
      actorId,
      requestId: makeRequestId(req),
    };

    payload.header = payload.header && typeof payload.header === "object" ? payload.header : {};

    const result = await service.updateBarangDagang(NoBarangDagang, payload);

    return res.status(200).json({
      success: true,
      message: "Barang Dagang berhasil diupdate",
      data: result,
    });
  } catch (err) {
    console.error("Update Barang Dagang Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

exports.delete = async (req, res) => {
  const { noBarangDagang } = req.params;

  try {
    const NoBarangDagang = String(noBarangDagang || "").trim();
    if (!NoBarangDagang) {
      return res.status(400).json({ success: false, message: "noBarangDagang wajib diisi" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ success: false, message: "Unauthorized (idUsername missing)" });
    }

    const payload = { actorId, requestId: makeRequestId(req) };
    const result = await service.deleteBarangDagang(NoBarangDagang, payload);

    return res.status(200).json({
      success: true,
      message: `Barang Dagang ${NoBarangDagang} berhasil dihapus`,
      data: result,
    });
  } catch (err) {
    console.error("Delete Barang Dagang Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

// GET /labels/barang-dagang/:noBarangDagang/pdf
exports.generatePdf = async (req, res) => {
  try {
    const NoBarangDagang = String(req.params.noBarangDagang || "").trim();
    if (!NoBarangDagang) {
      return res.status(400).json({ success: false, message: "noBarangDagang wajib diisi" });
    }

    const row = await service.getByNoBarangDagang(NoBarangDagang);

    const d = new Date(row.CreatedAt);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    const printed = row.HasBeenPrinted || 0;
    const kodeLabel = printed > 0 ? `BD${mm}${yy}CY${printed}` : `BD${mm}${yy}`;

    const data = {
      noLabel: row.NoBarangDagang,
      namaProduk: row.NamaBarangDagang,
      kode: row.NoBarangDagang,
      qty: row.Qty,
      tanggal: kodeLabel,
      createBy: row.CreateBy || "-",
      watermarkText: "",
    };

    const pdfBuffer = await generateLabelPdf(data, buildBarangDagangLabelHtml, {
      width: "60mm",
      height: "40mm",
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="label-${NoBarangDagang}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });

    return res.end(pdfBuffer);
  } catch (err) {
    console.error("Barang Dagang PDF Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

exports.incrementHasBeenPrinted = async (req, res) => {
  const { noBarangDagang } = req.params;

  try {
    const NoBarangDagang = String(noBarangDagang || "").trim();
    if (!NoBarangDagang) {
      return res.status(400).json({ success: false, message: "noBarangDagang wajib diisi" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ success: false, message: "Unauthorized (idUsername missing)" });
    }

    const result = await service.incrementHasBeenPrinted({
      NoBarangDagang,
      actorId,
      requestId: makeRequestId(req),
    });

    const io = getIo();
    if (io) io.emit("print_confirmed", { noLabel: NoBarangDagang, hasBeenPrinted: result.HasBeenPrinted });

    return res.status(200).json({
      success: true,
      message: "HasBeenPrinted berhasil ditambah",
      data: result,
    });
  } catch (err) {
    console.error("Increment HasBeenPrinted (Barang Dagang) Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};
