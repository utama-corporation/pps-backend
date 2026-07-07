const service = require("./master-mesin-service");

function mapInjectStatus(machineStatus) {
  if (machineStatus === "aktif") return "current";
  if (machineStatus === "pending") return "pending";
  return "idle";
}

async function getByIdBagian(req, res) {
  const { username } = req;

  // Enforced numeric by route, but still parse & guard
  const idStr = req.params.idbagian;
  const idBagianMesin = Number.parseInt(idStr, 10);

  // Optional toggle: include disabled via query ?includeDisabled=1
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  if (!Number.isInteger(idBagianMesin)) {
    return res.status(400).json({
      success: false,
      message: "idbagian must be an integer",
    });
  }

  console.log(
    "🔍 Fetching MstMesin by IdBagianMesin | Username:",
    username,
    "| IdBagianMesin:",
    idBagianMesin,
    "| includeDisabled:",
    includeDisabled,
  );

  try {
    const data = await service.getByIdBagian({
      idBagianMesin,
      includeDisabled,
    });
    return res.status(200).json({
      success: true,
      message: "Data MstMesin by IdBagianMesin berhasil diambil",
      idBagianMesin,
      includeDisabled,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin by IdBagianMesin:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getBroker(req, res) {
  const { username } = req;
  const idBagianMesin = 2;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  console.log(
    "🔍 Fetching MstMesin broker | Username:",
    username,
    "| IdBagianMesin:",
    idBagianMesin,
    "| includeDisabled:",
    includeDisabled,
  );

  try {
    const rows = await service.getBrokerByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });
    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };
    const activeShiftMeta = rows[0]
      ? {
          currentDate: rows[0].CurrentDate ?? null,
          currentTime: rows[0].CurrentTime ?? null,
          shift: rows[0].ActiveShift ?? null,
          hourStart: rows[0].ActiveShiftHourStart ?? null,
          hourEnd: rows[0].ActiveShiftHourEnd ?? null,
          validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
        }
      : {
          currentDate: null,
          currentTime: null,
          shift: null,
          hourStart: null,
          hourEnd: null,
          validFrmDate: null,
        };
    const data = rows.map((row) => ({
      IdMesin: row.IdMesin,
      NamaMesin: row.NamaMesin,
      Bagian: row.Bagian,
      Target: row.Target,
      NoProduksi: row.NoProduksi ?? null,
      TglProduksi: row.TglProduksi ?? null,
      IdRegu: row.IdRegu ?? null,
      NamaRegu: row.NamaRegu ?? null,
      OutputJenisId: row.OutputJenisId ?? null,
      OutputJenisNama: row.OutputJenisNama ?? null,
      OutputJenisItemCode: row.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(row.IdOperators),
      Operators: row.Operators ?? "",
      Shift: row.Shift ?? null,
      HourStart: row.HourStart ?? null,
      HourEnd: row.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data broker per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin broker:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getWashing(req, res) {
  const { username } = req;
  const idBagianMesin = 7;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  console.log(
    "🔍 Fetching MstMesin washing | Username:",
    username,
    "| IdBagianMesin:",
    idBagianMesin,
    "| includeDisabled:",
    includeDisabled,
  );

  try {
    const rows = await service.getWashingByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const activeShiftMeta = rows[0]
      ? {
          currentDate: rows[0].CurrentDate ?? null,
          currentTime: rows[0].CurrentTime ?? null,
          shift: rows[0].ActiveShift ?? null,
          hourStart: rows[0].ActiveShiftHourStart ?? null,
          hourEnd: rows[0].ActiveShiftHourEnd ?? null,
          validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
        }
      : {
          currentDate: null,
          currentTime: null,
          shift: null,
          hourStart: null,
          hourEnd: null,
          validFrmDate: null,
        };

    const data = rows.map((row) => ({
      IdMesin: row.IdMesin,
      NamaMesin: row.NamaMesin,
      Bagian: row.Bagian,
      Target: row.Target,
      NoProduksi: row.NoProduksi ?? null,
      TglProduksi: row.TglProduksi ?? null,
      IdRegu: row.IdRegu ?? null,
      NamaRegu: row.NamaRegu ?? null,
      OutputJenisId: row.OutputJenisId ?? null,
      OutputJenisNama: row.OutputJenisNama ?? null,
      OutputJenisItemCode: row.OutputJenisItemCode ?? null,
      IdOperator: row.IdOperator ?? null,
      NamaOperator: row.NamaOperator ?? null,
      Shift: row.Shift ?? null,
      HourStart: row.HourStart ?? null,
      HourEnd: row.HourEnd ?? null,
      IsBlower: row.IsBlower ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data washing per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin washing:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getCrusher(req, res) {
  const { username } = req;
  const idBagianMesin = 3;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  console.log(
    "🔍 Fetching MstMesin crusher | Username:",
    username,
    "| IdBagianMesin:",
    idBagianMesin,
    "| includeDisabled:",
    includeDisabled,
  );

  try {
    const rows = await service.getCrusherByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta = rows[0]
      ? {
          currentDate: rows[0].CurrentDate ?? null,
          currentTime: rows[0].CurrentTime ?? null,
          shift: rows[0].ActiveShift ?? null,
          hourStart: rows[0].ActiveShiftHourStart ?? null,
          hourEnd: rows[0].ActiveShiftHourEnd ?? null,
          validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
        }
      : {
          currentDate: null,
          currentTime: null,
          shift: null,
          hourStart: null,
          hourEnd: null,
          validFrmDate: null,
        };

    const data = rows.map((row) => ({
      IdMesin: row.IdMesin,
      NamaMesin: row.NamaMesin,
      Bagian: row.Bagian,
      Target: row.Target,
      NoProduksi: row.NoProduksi ?? null,
      TglProduksi: row.TglProduksi ?? null,
      IdRegu: row.IdRegu ?? null,
      NamaRegu: row.NamaRegu ?? null,
      OutputJenisId: row.OutputJenisId ?? null,
      OutputJenisNama: row.OutputJenisNama ?? null,
      OutputJenisItemCode: row.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(row.IdOperators),
      Operators: row.Operators ?? "",
      Shift: row.Shift ?? null,
      HourStart: row.HourStart ?? null,
      HourEnd: row.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data crusher per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin crusher:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getGilingan(req, res) {
  const { username } = req;
  const idBagianMesin = 3;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  console.log(
    "🔍 Fetching MstMesin gilingan | Username:",
    username,
    "| IdBagianMesin:",
    idBagianMesin,
    "| includeDisabled:",
    includeDisabled,
  );

  try {
    const rows = await service.getGilinganByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta = rows[0]
      ? {
          currentDate: rows[0].CurrentDate ?? null,
          currentTime: rows[0].CurrentTime ?? null,
          shift: rows[0].ActiveShift ?? null,
          hourStart: rows[0].ActiveShiftHourStart ?? null,
          hourEnd: rows[0].ActiveShiftHourEnd ?? null,
          validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
        }
      : {
          currentDate: null,
          currentTime: null,
          shift: null,
          hourStart: null,
          hourEnd: null,
          validFrmDate: null,
        };

    const data = rows.map((row) => ({
      IdMesin: row.IdMesin,
      NamaMesin: row.NamaMesin,
      Bagian: row.Bagian,
      Target: row.Target,
      NoProduksi: row.NoProduksi ?? null,
      TglProduksi: row.TglProduksi ?? null,
      IdRegu: row.IdRegu ?? null,
      NamaRegu: row.NamaRegu ?? null,
      OutputJenisId: row.OutputJenisId ?? null,
      OutputJenisNama: row.OutputJenisNama ?? null,
      OutputJenisItemCode: row.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(row.IdOperators),
      Operators: row.Operators ?? "",
      Shift: row.Shift ?? null,
      HourStart: row.HourStart ?? null,
      HourEnd: row.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data gilingan per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin gilingan:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getMixer(req, res) {
  const idBagianMesin = 5;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  try {
    const rows = await service.getMixerByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta =
      rows.length > 0
        ? {
            noShift: rows[0].ActiveShift ?? null,
            hourStart: rows[0].ActiveShiftHourStart ?? null,
            hourEnd: rows[0].ActiveShiftHourEnd ?? null,
            validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
            currentDate: rows[0].CurrentDate ?? null,
            currentTime: rows[0].CurrentTime ?? null,
          }
        : null;

    const data = rows.map((r) => ({
      IdMesin: r.IdMesin,
      NamaMesin: r.NamaMesin,
      Bagian: r.Bagian,
      IdBagianMesin: r.IdBagianMesin,
      Target: r.Target ?? null,
      NoProduksi: r.NoProduksi ?? null,
      TglProduksi: r.TglProduksi ?? null,
      IdRegu: r.IdRegu ?? null,
      NamaRegu: r.NamaRegu ?? null,
      OutputJenisId: r.OutputJenisId ?? null,
      OutputJenisNama: r.OutputJenisNama ?? null,
      OutputJenisItemCode: r.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(r.IdOperators),
      Operators: r.Operators ?? "",
      Shift: r.Shift ?? null,
      HourStart: r.HourStart ?? null,
      HourEnd: r.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data mixer per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin mixer:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getInject(req, res) {
  const idBagianMesin = 4;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  try {
    const rows = await service.getInjectByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta =
      rows.length > 0
        ? {
            noShift: rows[0].ActiveShift ?? null,
            hourStart: rows[0].ActiveShiftHourStart ?? null,
            hourEnd: rows[0].ActiveShiftHourEnd ?? null,
            validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
            currentDate: rows[0].CurrentDate ?? null,
            currentTime: rows[0].CurrentTime ?? null,
          }
        : null;

    const data = rows.map((r) => ({
      IdMesin: r.IdMesin,
      NamaMesin: r.NamaMesin,
      Bagian: r.Bagian,
      IdBagianMesin: r.IdBagianMesin,
      Target: r.Target ?? null,
      NoProduksi: r.NoProduksi ?? null,
      TglProduksi: r.TglProduksi ?? null,
      IdRegu: r.IdRegu ?? null,
      NamaRegu: r.NamaRegu ?? null,
      IdCetakan: r.IdCetakan ?? null,
      NamaCetakan: r.NamaCetakan ?? null,
      IdWarna: r.IdWarna ?? null,
      Warna: r.Warna ?? null,
      IdFurnitureMaterial: r.IdFurnitureMaterial ?? null,
      NamaFurnitureMaterial: r.NamaFurnitureMaterial ?? null,
      OutputCategory: r.OutputCategory ?? null,
      Outputs: Array.isArray(r.Outputs) ? r.Outputs : [],
      IdOperators: normalizeIdOperators(r.IdOperators),
      Operators: r.Operators ?? "",
      Shift: r.Shift ?? null,
      HourStart: r.HourStart ?? null,
      HourEnd: r.HourEnd ?? null,
      status: mapInjectStatus(r.MachineStatus),
      standarBerat: r.standarBerat ?? r.StandarBerat ?? null,
      standarCycleTime: r.standarCycleTime ?? r.StandarCycleTime ?? null,
      counterCurrent: r.counterCurrent ?? r.CounterCurrent ?? null,
      counterAtReset: r.counterAtReset ?? r.CounterAtReset ?? null,
      lastResetAt: r.lastResetAt ?? r.LastResetAt ?? null,
      lastResetBy: r.lastResetBy ?? r.LastResetBy ?? null,
      counterUpdatedAt: r.counterUpdatedAt ?? r.CounterUpdatedAt ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data inject per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin inject:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getStamping(req, res) {
  const idBagianMesin = 8;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  try {
    const rows = await service.getStampingByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta =
      rows.length > 0
        ? {
            noShift: rows[0].ActiveShift ?? null,
            hourStart: rows[0].ActiveShiftHourStart ?? null,
            hourEnd: rows[0].ActiveShiftHourEnd ?? null,
            validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
            currentDate: rows[0].CurrentDate ?? null,
            currentTime: rows[0].CurrentTime ?? null,
          }
        : null;

    const data = rows.map((r) => ({
      IdMesin: r.IdMesin,
      NamaMesin: r.NamaMesin,
      Bagian: r.Bagian,
      IdBagianMesin: r.IdBagianMesin,
      Target: r.Target ?? null,
      NoProduksi: r.NoProduksi ?? null,
      TglProduksi: r.TglProduksi ?? null,
      IdRegu: r.IdRegu ?? null,
      NamaRegu: r.NamaRegu ?? null,
      OutputJenisId: r.OutputJenisId ?? null,
      OutputJenisNama: r.OutputJenisNama ?? null,
      OutputJenisItemCode: r.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(r.IdOperators),
      Operators: r.Operators ?? "",
      Shift: r.Shift ?? null,
      HourStart: r.HourStart ?? null,
      HourEnd: r.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data stamping per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin stamping:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getPasangKunci(req, res) {
  const idBagianMesin = 10;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  try {
    const rows = await service.getPasangKunciByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta =
      rows.length > 0
        ? {
            noShift: rows[0].ActiveShift ?? null,
            hourStart: rows[0].ActiveShiftHourStart ?? null,
            hourEnd: rows[0].ActiveShiftHourEnd ?? null,
            validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
            currentDate: rows[0].CurrentDate ?? null,
            currentTime: rows[0].CurrentTime ?? null,
          }
        : null;

    const data = rows.map((r) => ({
      IdMesin: r.IdMesin,
      NamaMesin: r.NamaMesin,
      Bagian: r.Bagian,
      IdBagianMesin: r.IdBagianMesin,
      Target: r.Target ?? null,
      NoProduksi: r.NoProduksi ?? null,
      TglProduksi: r.TglProduksi ?? null,
      IdRegu: r.IdRegu ?? null,
      NamaRegu: r.NamaRegu ?? null,
      OutputJenisId: r.OutputJenisId ?? null,
      OutputJenisNama: r.OutputJenisNama ?? null,
      OutputJenisItemCode: r.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(r.IdOperators),
      Operators: r.Operators ?? "",
      Shift: r.Shift ?? null,
      HourStart: r.HourStart ?? null,
      HourEnd: r.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data pasang kunci per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin pasang kunci:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getSpanner(req, res) {
  const idBagianMesin = 9;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  try {
    const rows = await service.getSpannerByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta =
      rows.length > 0
        ? {
            noShift: rows[0].ActiveShift ?? null,
            hourStart: rows[0].ActiveShiftHourStart ?? null,
            hourEnd: rows[0].ActiveShiftHourEnd ?? null,
            validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
            currentDate: rows[0].CurrentDate ?? null,
            currentTime: rows[0].CurrentTime ?? null,
          }
        : null;

    const data = rows.map((r) => ({
      IdMesin: r.IdMesin,
      NamaMesin: r.NamaMesin,
      Bagian: r.Bagian,
      IdBagianMesin: r.IdBagianMesin,
      Target: r.Target ?? null,
      NoProduksi: r.NoProduksi ?? null,
      TglProduksi: r.TglProduksi ?? null,
      IdRegu: r.IdRegu ?? null,
      NamaRegu: r.NamaRegu ?? null,
      OutputJenisId: r.OutputJenisId ?? null,
      OutputJenisNama: r.OutputJenisNama ?? null,
      OutputJenisItemCode: r.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(r.IdOperators),
      Operators: r.Operators ?? "",
      Shift: r.Shift ?? null,
      HourStart: r.HourStart ?? null,
      HourEnd: r.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data spanner per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin spanner:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getPacking(req, res) {
  const idBagianMesin = 6;
  const includeDisabled = String(req.query.includeDisabled || "0") === "1";

  try {
    const rows = await service.getPackingByNoProduksi({
      idBagianMesin,
      includeDisabled,
    });

    const normalizeIdOperators = (raw) => {
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          arr = [];
        }
      }
      return [
        ...new Set(
          arr
            .map((v) => Number(v?.value ?? v))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n)),
        ),
      ];
    };

    const activeShiftMeta =
      rows.length > 0
        ? {
            noShift: rows[0].ActiveShift ?? null,
            hourStart: rows[0].ActiveShiftHourStart ?? null,
            hourEnd: rows[0].ActiveShiftHourEnd ?? null,
            validFrmDate: rows[0].ActiveShiftValidFrmDate ?? null,
            currentDate: rows[0].CurrentDate ?? null,
            currentTime: rows[0].CurrentTime ?? null,
          }
        : null;

    const data = rows.map((r) => ({
      IdMesin: r.IdMesin,
      NamaMesin: r.NamaMesin,
      Bagian: r.Bagian,
      IdBagianMesin: r.IdBagianMesin,
      Target: r.Target ?? null,
      NoProduksi: r.NoProduksi ?? null,
      TglProduksi: r.TglProduksi ?? null,
      IdRegu: r.IdRegu ?? null,
      NamaRegu: r.NamaRegu ?? null,
      OutputJenisId: r.OutputJenisId ?? null,
      OutputJenisNama: r.OutputJenisNama ?? null,
      OutputJenisItemCode: r.OutputJenisItemCode ?? null,
      IdOperators: normalizeIdOperators(r.IdOperators),
      Operators: r.Operators ?? "",
      Shift: r.Shift ?? null,
      HourStart: r.HourStart ?? null,
      HourEnd: r.HourEnd ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data packing per NoProduksi hari ini berhasil diambil",
      idBagianMesin,
      includeDisabled,
      activeShift: activeShiftMeta,
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching MstMesin packing:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

module.exports = {
  getByIdBagian,
  getBroker,
  getWashing,
  getCrusher,
  getGilingan,
  getMixer,
  getInject,
  getStamping,
  getSpanner,
  getPasangKunci,
  getPacking,
};
