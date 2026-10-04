const express = require("express");
const router = express.Router();
const authController = require("./auth-controller");
const verifyToken = require("../../core/middleware/verify-token");
const getUserPermissions = require("../../core/utils/get-user-permissions");

router.use(express.json()); // Middleware parsing JSON

// router.post('/login', authController.login);

//FORCE UPDATE FOR MOBILE
// Endpoint ini juga menangani gate NIK (nik_required / nik_confirm) —
// tidak ada token yang dikeluarkan selama user belum punya NIK di MstUsername.
router.post("/login2", authController.login);

// Daftar permission user yang sedang login (dari JWT idUsername).
// Dipakai web untuk menampilkan/menyembunyikan aksi (mis. Kunci/Buka Kunci).
router.get("/me", verifyToken, async (req, res) => {
  try {
    const permissions = await getUserPermissions(req.idUsername);
    return res.status(200).json({
      success: true,
      username: req.username ?? null,
      idUsername: req.idUsername ?? null,
      permissions,
    });
  } catch (err) {
    console.error("[auth.me]", err);
    return res.status(500).json({
      success: false,
      message: "Gagal memuat permission user",
    });
  }
});

module.exports = router;
