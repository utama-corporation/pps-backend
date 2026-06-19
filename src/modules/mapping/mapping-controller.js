const mappingService = require("./mapping-service");
const ALLOWED_LAYOUT_CELL_TYPES = new Set([
  "lokasi",
  "aisle",
  "lift",
  "label",
  "empty",
]);

async function getMapping(req, res) {
  const { username } = req;
  console.log("Fetching mapping blok-warehouse | Username:", username);

  try {
    const data = await mappingService.getBlokWarehouseMapping();

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data mapping blok-warehouse tidak ditemukan",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: "Data mapping blok-warehouse berhasil diambil",
      data,
      totalData: data.length,
    });
  } catch (error) {
    console.error("Error fetching mapping blok-warehouse:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getLokasiByBlok(req, res) {
  const { username } = req;
  const { blok } = req.query;
  console.log(
    "Fetching lokasi by blok from mapping | Username:",
    username,
    "| Blok:",
    blok,
  );

  if (!blok || !String(blok).trim()) {
    return res.status(400).json({
      success: false,
      message: "Parameter query 'blok' wajib diisi",
    });
  }

  try {
    const data = await mappingService.getLokasiByBlok(String(blok).trim());

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data lokasi tidak ditemukan untuk blok tersebut",
        data: [],
      });
    }

    return res.json({
      success: true,
      message: "Data lokasi berdasarkan blok berhasil diambil",
      data,
      totalData: data.length,
    });
  } catch (error) {
    console.error("Error fetching lokasi by blok from mapping:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getLayoutByBlok(req, res) {
  const { username } = req;
  const blok = String(req.params.blok || "").trim();
  console.log("Fetching layout by blok | Username:", username, "| Blok:", blok);

  if (!blok) {
    return res.status(400).json({
      success: false,
      message: "Parameter path 'blok' wajib diisi",
    });
  }

  try {
    const data = await mappingService.getLayoutByBlok(blok);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Data layout tidak ditemukan untuk blok tersebut",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data layout berhasil diambil",
      data,
    });
  } catch (error) {
    console.error("Error fetching layout by blok:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function saveLayoutByBlok(req, res) {
  const { username } = req;
  const blok = String(req.params.blok || "").trim();
  const { rows, cols, cells } = req.body || {};

  console.log("Saving layout by blok | Username:", username, "| Blok:", blok);

  if (!blok) {
    return res.status(400).json({
      success: false,
      message: "Parameter path 'blok' wajib diisi",
    });
  }

  if (!Number.isInteger(rows) || rows < 0) {
    return res.status(400).json({
      success: false,
      message: "Field 'rows' wajib berupa integer >= 0",
    });
  }

  if (!Number.isInteger(cols) || cols < 0) {
    return res.status(400).json({
      success: false,
      message: "Field 'cols' wajib berupa integer >= 0",
    });
  }

  if (!Array.isArray(cells)) {
    return res.status(400).json({
      success: false,
      message: "Field 'cells' wajib berupa array",
    });
  }

  for (const [index, cell] of cells.entries()) {
    if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col)) {
      return res.status(400).json({
        success: false,
        message: `Cell pada index ${index} wajib memiliki 'row' dan 'col' berupa integer`,
      });
    }

    if (!Number.isInteger(cell.rowSpan) || cell.rowSpan <= 0) {
      return res.status(400).json({
        success: false,
        message: `Cell pada index ${index} wajib memiliki 'rowSpan' berupa integer > 0`,
      });
    }

    if (!Number.isInteger(cell.colSpan) || cell.colSpan <= 0) {
      return res.status(400).json({
        success: false,
        message: `Cell pada index ${index} wajib memiliki 'colSpan' berupa integer > 0`,
      });
    }

    const cellType = String(cell.cellType || "")
      .trim()
      .toLowerCase();
    if (!ALLOWED_LAYOUT_CELL_TYPES.has(cellType)) {
      return res.status(400).json({
        success: false,
        message:
          "Field 'cellType' hanya boleh bernilai: lokasi, aisle, lift, label, empty",
      });
    }

    if (cellType === "lokasi" && cell.idLokasi === undefined) {
      return res.status(400).json({
        success: false,
        message: `Cell lokasi pada index ${index} wajib memiliki 'idLokasi'`,
      });
    }

    if (cellType === "label" && !String(cell.labelText || "").trim()) {
      return res.status(400).json({
        success: false,
        message: `Cell label pada index ${index} wajib memiliki 'labelText'`,
      });
    }
  }

  try {
    const data = await mappingService.saveLayoutByBlok(blok, {
      rows,
      cols,
      cells,
    });

    return res.status(200).json({
      success: true,
      message: "Data layout berhasil disimpan",
      data,
    });
  } catch (error) {
    console.error("Error saving layout by blok:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function createLokasi(req, res) {
  const { username } = req;
  const blok = String(req.params.blok || "").trim();
  const { IdLokasi, IdKategori, IdJenis, Description, Enable } = req.body || {};

  console.log(
    "Creating lokasi | Username:",
    username,
    "| Blok:",
    blok,
    "| IdLokasi:",
    IdLokasi,
  );

  if (!blok) {
    return res.status(400).json({
      success: false,
      message: "Parameter path 'blok' wajib diisi",
    });
  }

  if (!Number.isInteger(IdLokasi) || IdLokasi <= 0) {
    return res.status(400).json({
      success: false,
      message: "Field 'IdLokasi' wajib berupa integer valid",
    });
  }

  try {
    const created = await mappingService.createLokasi(blok, {
      IdLokasi,
      IdKategori,
      IdJenis,
      Description,
      Enable,
    });

    if (!created) {
      return res.status(500).json({
        success: false,
        message: "Gagal menambahkan data lokasi",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Data lokasi berhasil ditambahkan",
    });
  } catch (error) {
    console.error("Error creating lokasi:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function updateLokasi(req, res) {
  const { username } = req;
  const blok = String(req.params.blok || "").trim();
  const idLokasi = parseInt(req.params.idLokasi, 10);
  const { IdKategori, IdJenis, Description, Enable } = req.body || {};

  console.log(
    "Updating lokasi | Username:",
    username,
    "| Blok:",
    blok,
    "| IdLokasi:",
    idLokasi,
  );

  if (!blok) {
    return res.status(400).json({
      success: false,
      message: "Parameter path 'blok' wajib diisi",
    });
  }

  if (!Number.isInteger(idLokasi) || idLokasi <= 0) {
    return res.status(400).json({
      success: false,
      message: "Parameter path 'idLokasi' wajib berupa integer valid",
    });
  }

  try {
    const updated = await mappingService.updateLokasi(blok, idLokasi, {
      IdKategori,
      IdJenis,
      Description,
      Enable,
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Data lokasi tidak ditemukan",
      });
    }

    return res.json({
      success: true,
      message: "Data lokasi berhasil diperbarui",
    });
  } catch (error) {
    console.error("Error updating lokasi:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

module.exports = {
  getMapping,
  getLokasiByBlok,
  getLayoutByBlok,
  saveLayoutByBlok,
  createLokasi,
  updateLokasi,
};
