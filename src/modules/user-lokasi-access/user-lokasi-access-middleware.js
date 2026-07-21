const { isUserAllowedForLokasi } = require("./user-lokasi-access-service");

async function requireLokasiAccess(req, res, next) {
  try {
    if (
      req.userPermissions?.has("*") ||
      req.userPermissions?.has("stockopname:create")
    ) {
      return next();
    }

    const { blok, locationId } = req.params;
    const idLokasi = Number(locationId);

    if (!blok || !Number.isInteger(idLokasi)) {
      return res.status(400).json({
        success: false,
        message: "Parameter 'blok' dan 'locationId' wajib valid",
      });
    }

    const allowed = await isUserAllowedForLokasi({
      blok,
      idLokasi,
      idUsername: req.idUsername,
    });

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: `Anda tidak memiliki akses ke lokasi ${blok}/${idLokasi}`,
      });
    }

    next();
  } catch (error) {
    console.error("Error checking lokasi access:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

module.exports = requireLokasiAccess;
