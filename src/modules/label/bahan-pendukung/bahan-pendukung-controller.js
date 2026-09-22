// bahan-pendukung-controller.js
const service = require("./bahan-pendukung-service");
const {
  getActorId,
  getActorUsername,
  makeRequestId,
} = require("../../../core/utils/http-context");
const { getIo } = require("../../../core/utils/socket-instance");
const { generateLabelPdf } = require("../../../core/utils/pdf/label-generator");
const {
  buildBahanPendukungLabelHtml,
} = require("../../../core/utils/pdf/templates/bahan-pendukung-label-pdf/bahan-pendukung-label-pdf");

// GET /labels/bahan-pendukung?page=&limit=&search=
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
    console.error("Get Bahan Pendukung List Error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

exports.update = async (req, res) => {
  const { noBahanPendukung } = req.params;

  try {
    const NoBahanPendukung = String(noBahanPendukung || "").trim();
    if (!NoBahanPendukung) {
      return res.status(400).json({ success: false, message: "noBahanPendukung wajib diisi" });
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

    const result = await service.updateBahanPendukung(NoBahanPendukung, payload);

    return res.status(200).json({
      success: true,
      message: "Bahan Pendukung berhasil diupdate",
      data: result,
    });
  } catch (err) {
    console.error("Update Bahan Pendukung Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

exports.delete = async (req, res) => {
  const { noBahanPendukung } = req.params;

  try {
    const NoBahanPendukung = String(noBahanPendukung || "").trim();
    if (!NoBahanPendukung) {
      return res.status(400).json({ success: false, message: "noBahanPendukung wajib diisi" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ success: false, message: "Unauthorized (idUsername missing)" });
    }

    const payload = { actorId, requestId: makeRequestId(req) };
    const result = await service.deleteBahanPendukung(NoBahanPendukung, payload);

    return res.status(200).json({
      success: true,
      message: `Bahan Pendukung ${NoBahanPendukung} berhasil dihapus`,
      data: result,
    });
  } catch (err) {
    console.error("Delete Bahan Pendukung Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

// GET /labels/bahan-pendukung/:noBahanPendukung/pdf
exports.generatePdf = async (req, res) => {
  try {
    const NoBahanPendukung = String(req.params.noBahanPendukung || "").trim();
    if (!NoBahanPendukung) {
      return res.status(400).json({ success: false, message: "noBahanPendukung wajib diisi" });
    }

    const row = await service.getByNoBahanPendukung(NoBahanPendukung);

    const d = new Date(row.CreatedAt);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    const printed = row.HasBeenPrinted || 0;
    const kodeLabel = printed > 0 ? `BP${mm}${yy}CY${printed}` : `BP${mm}${yy}`;

    const data = {
      noLabel: row.NoBahanPendukung,
      namaProduk: row.NamaCabinetMaterial,
      kode: row.NoBahanPendukung,
      tanggal: kodeLabel,
      createBy: row.CreateBy || "-",
      watermarkText: "",
    };

    const pdfBuffer = await generateLabelPdf(data, buildBahanPendukungLabelHtml, {
      width: "60mm",
      height: "40mm",
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="label-${NoBahanPendukung}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });

    return res.end(pdfBuffer);
  } catch (err) {
    console.error("Bahan Pendukung PDF Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

exports.incrementHasBeenPrinted = async (req, res) => {
  const { noBahanPendukung } = req.params;

  try {
    const NoBahanPendukung = String(noBahanPendukung || "").trim();
    if (!NoBahanPendukung) {
      return res.status(400).json({ success: false, message: "noBahanPendukung wajib diisi" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ success: false, message: "Unauthorized (idUsername missing)" });
    }

    const result = await service.incrementHasBeenPrinted({
      NoBahanPendukung,
      actorId,
      requestId: makeRequestId(req),
    });

    const io = getIo();
    if (io) io.emit("print_confirmed", { noLabel: NoBahanPendukung, hasBeenPrinted: result.HasBeenPrinted });

    return res.status(200).json({
      success: true,
      message: "HasBeenPrinted berhasil ditambah",
      data: result,
    });
  } catch (err) {
    console.error("Increment HasBeenPrinted (Bahan Pendukung) Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || "Terjadi kesalahan server" });
  }
};

// GET /labels/bahan-pendukung/stok
exports.getStok = async (req, res) => {
  try {
    const data = await service.getStok();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("Get Stok Bahan Pendukung Error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

// GET /labels/bahan-pendukung/:idcabinetmaterial/label
exports.getLabelByIdCabinetMaterial = async (req, res) => {
  try {
    const idCabinetMaterial = parseInt(req.params.idcabinetmaterial, 10);

    if (!Number.isFinite(idCabinetMaterial)) {
      return res.status(400).json({
        success: false,
        message: "idcabinetmaterial wajib berupa angka",
      });
    }

    const data = await service.getLabelByIdCabinetMaterial(idCabinetMaterial);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Label Bahan Pendukung By IdCabinetMaterial Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
    });
  }
};
