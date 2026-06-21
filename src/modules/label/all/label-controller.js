const labelService = require('./label-service');

async function getAllLabelsHandler(req, res) {
  try {
    const page      = parseInt(req.query.page) || 1;
    const limit     = parseInt(req.query.limit) || 50;
    const kategori  = req.query.kategori || null;
    const idlokasi  = req.query.idlokasi || null;
    const blok      = req.query.blok || null; // 🔹 tambahkan blok dari query params

    const result = await labelService.getAllLabels(page, limit, kategori, idlokasi, blok);

    return res.json({
      success: true,
      message: `Data label${kategori ? ` (${kategori})` : ''}${
        idlokasi ? ` di lokasi ${idlokasi}` : ''
      }${blok ? ` (blok ${blok})` : ''} berhasil diambil`,

      // metadata & informasi filter
      kodeKategori : result.kodeKategori,
      kategori : result.kategori,
      idlokasi : result.idlokasi,
      blok     : result.blok,

      // pagination info
      totalData   : result.total,
      currentPage : result.page,
      totalPages  : result.totalPages,
      perPage     : result.limit,

      // agregat total
      totalQty   : result.totalQty ?? 0,
      totalBerat : result.totalBerat ?? 0,

      // payload utama
      data: result.data
    });

  } catch (err) { 
    console.error('Error fetching all labels:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server', 
      error: err.message 
    });
  }
}


// 🟢 Handler baru: Update lokasi berdasarkan NomorLabel
async function updateLabelLocationHandler(req, res) {
  try {
    const { labelCode, idLokasi, blok } = req.body;
    const { idUsername } = req;


    // Validasi input wajib
    if (!labelCode || !idLokasi || !blok) {
      return res.status(400).json({
        success: false,
        message: 'labelCode, idLokasi, dan blok wajib dikirim di body request'
      });
    }

    const result = await labelService.updateLabelLocation(labelCode, idLokasi, blok, idUsername);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);

  } catch (err) {
    console.error('Error updating label location:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server',
      error: err.message 
    });
  }
}


async function getAllLabelsV2Handler(req, res) {
  const { username } = req;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const kategori = req.query.kategori || null;
  const idlokasi = req.query.idlokasi || null;
  const blok = req.query.blok || null;

  console.log("Fetching all labels v2 | Username:", username, "| Page:", page, "| Blok:", blok);

  try {
    const result = await labelService.getAllLabelsV2(page, limit, kategori, idlokasi, blok);

    return res.json({
      success: true,
      message: result.data && result.data.length > 0
        ? "Data label berhasil diambil"
        : "Data label tidak ditemukan",
      totalData: result.total,
      currentPage: result.page,
      totalPages: result.totalPages,
      perPage: result.limit,
      data: result.data || [],
    });
  } catch (err) {
    console.error("Error fetching labels v2:", err);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server",
      error: err.message,
    });
  }
}

module.exports = {
  getAllLabelsHandler,
  getAllLabelsV2Handler,
  updateLabelLocationHandler
};
