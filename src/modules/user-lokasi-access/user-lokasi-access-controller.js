const service = require("./user-lokasi-access-service");

async function listAllUsersHandler(req, res) {
  try {
    const data = await service.listAllUsers();
    return res.json({
      success: true,
      message: "Data user berhasil diambil",
      data,
      totalRecords: data.length,
    });
  } catch (error) {
    console.error("Error fetching all users:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function listUsersByLokasiHandler(req, res) {
  const { blok, idLokasi } = req.params;

  try {
    const data = await service.listUsersByLokasi(blok, Number(idLokasi));
    return res.json({
      success: true,
      message: "Data user lokasi berhasil diambil",
      data,
      totalRecords: data.length,
    });
  } catch (error) {
    console.error("Error fetching users by lokasi:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function listLokasiByUserHandler(req, res) {
  const { idUsername } = req.params;

  try {
    const data = await service.listLokasiByUser(Number(idUsername));
    return res.json({
      success: true,
      message: "Data lokasi user berhasil diambil",
      data,
      totalRecords: data.length,
    });
  } catch (error) {
    console.error("Error fetching lokasi by user:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function assignAccessHandler(req, res) {
  const { blok, idLokasi, idUsername } = req.body || {};

  try {
    const result = await service.assignAccess({
      blok,
      idLokasi: Number(idLokasi),
      idUsername: Number(idUsername),
    });
    return res.status(201).json({
      success: true,
      message: `User ${idUsername} berhasil ditugaskan ke lokasi ${blok}/${idLokasi}`,
      data: result,
    });
  } catch (error) {
    console.error("Error assigning lokasi access:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

async function revokeAccessHandler(req, res) {
  const { blok, idLokasi, idUsername } = req.params;

  try {
    const result = await service.revokeAccess({
      blok,
      idLokasi: Number(idLokasi),
      idUsername: Number(idUsername),
    });
    return res.json({
      success: true,
      message: `Akses user ${idUsername} ke lokasi ${blok}/${idLokasi} berhasil dicabut`,
      data: result,
    });
  } catch (error) {
    console.error("Error revoking lokasi access:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      code: error.code,
    });
  }
}

module.exports = {
  listAllUsersHandler,
  listUsersByLokasiHandler,
  listLokasiByUserHandler,
  assignAccessHandler,
  revokeAccessHandler,
};
