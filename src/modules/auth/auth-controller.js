const jwt = require("jsonwebtoken");
const authService = require("./auth-service");
const getUserPermissions = require("../../core/utils/get-user-permissions");

// 🔹 NIK hanya boleh angka dan tidak boleh kosong
function isValidNik(value) {
  const s = String(value ?? "").trim();
  return s.length > 0 && /^[0-9]+$/.test(s);
}

function normalizeNik(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * POST /api/auth/login2
 *
 * Body: { username, password, nik?, confirmNik? }
 *
 * Alur NIK (semuanya lewat endpoint ini — TIDAK ada token yang dikeluarkan
 * selama user belum punya NIK di MstUsername):
 *   1. Credentials salah                       -> 401/403/404
 *   2. Credentials benar, NIK sudah ada        -> 200 { success:true, token, user }
 *   3. Credentials benar, NIK kosong, tanpa nik-> 200 { success:false, errorType:'nik_required' }
 *   4. + nik dikirim, tidak ketemu di Ascend   -> 200 { success:false, errorType:'nik_not_found' }
 *   5. + nik ketemu, confirmNik != true        -> 200 { success:false, errorType:'nik_confirm', employee }
 *   6. + nik ketemu, confirmNik === true       -> simpan ke MstUsername, lalu 200 { success:true, token, user }
 */
async function login(req, res) {
  const { username, password, nik, confirmNik } = req.body;

  try {
    // 🔹 Validasi input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username dan password harus diisi",
        errorType: "validation",
      });
    }

    // 🔹 Verifikasi user
    const verifyResult = await authService.verifyUser(username, password);

    if (!verifyResult.success) {
      // 🔹 Return error dengan status code yang sesuai
      const statusCode =
        verifyResult.errorType === "user_not_found"
          ? 404
          : verifyResult.errorType === "user_inactive"
            ? 403
            : 401; // wrong_password

      return res.status(statusCode).json({
        success: false,
        message: verifyResult.message,
        errorType: verifyResult.errorType,
      });
    }

    const user = verifyResult.user;

    // ================================================================
    // 🔒 GATE NIK — wajib sebelum token dikeluarkan
    // ================================================================
    let resolvedNik = normalizeNik(user.Nik);
    // CompanyID (nama database Ascend) + EmployeeID dipakai untuk ambil
    // FullName dari HRM_Employees. Untuk user yang NIK-nya baru diikat di
    // bawah, nilai di `user` masih basi -> pakai hasil lookup Ascend.
    let resolvedCompanyId = user.CompanyID;
    let resolvedEmployeeId = user.EmployeeID;

    if (!resolvedNik) {
      const providedNik = String(nik ?? "").trim();

      // 3) Belum kirim NIK -> minta lengkapi, tidak ada token
      if (!providedNik) {
        return res.status(200).json({
          success: false,
          errorType: "nik_required",
          message:
            "Akun Anda belum memiliki NIK. Lengkapi NIK untuk melanjutkan.",
        });
      }

      // Format NIK salah
      if (!isValidNik(providedNik)) {
        return res.status(400).json({
          success: false,
          errorType: "validation",
          message: "NIK wajib diisi dan hanya boleh berupa angka",
        });
      }

      // Lookup ke 3 database Ascend (AS_GSU / AS_UC_2017 / AS_RU)
      const employee = await authService.findEmployeeByCode(providedNik);

      // 4) Tidak ketemu
      if (!employee) {
        return res.status(200).json({
          success: false,
          errorType: "nik_not_found",
          message: "NIK tidak ditemukan",
        });
      }

      // 5) Ketemu tapi belum dikonfirmasi user -> kirim data karyawan, belum simpan
      if (confirmNik !== true) {
        return res.status(200).json({
          success: false,
          errorType: "nik_confirm",
          message: "Konfirmasi data karyawan",
          employee: {
            employeeId: employee.EmployeeID,
            employeeCode: employee.EmployeeCode,
            fullName: employee.FullName,
            companyId: employee.CompanyID,
          },
        });
      }

      // 6) Dikonfirmasi -> simpan EmployeeID + CompanyID + NIK ke MstUsername
      const updated = await authService.bindUserNik({
        username: user.Username,
        nik: providedNik,
        employeeId: employee.EmployeeID,
        companyId: employee.CompanyID,
      });

      if (!updated) {
        return res.status(500).json({
          success: false,
          errorType: "server_error",
          message: "Gagal menyimpan NIK. Silakan coba lagi.",
        });
      }

      resolvedNik = providedNik;
      resolvedCompanyId = employee.CompanyID;
      resolvedEmployeeId = employee.EmployeeID;
    }

    // ================================================================
    // ✅ NIK sudah ada / baru saja disimpan -> keluarkan token
    // ================================================================
    const permissions = await getUserPermissions(user.IdUsername);
    const group = await authService.getUserGroup(user.IdUsername);

    // FullName diambil dari HRM_Employees pada database sesuai CompanyID.
    // Fallback ke FName + LName di MstUsername kalau tidak ketemu.
    const hrmFullName = await authService.getEmployeeFullName({
      companyId: resolvedCompanyId,
      employeeId: resolvedEmployeeId,
      nik: resolvedNik,
    });
    const fullName =
      hrmFullName || `${user.FName ?? ""} ${user.LName ?? ""}`.trim();

    const token = jwt.sign(
      {
        idUsername: user.IdUsername,
        username: user.Username,
      },
      process.env.SECRET_KEY,
      { expiresIn: "12h" },
    );

    res.status(200).json({
      success: true,
      message: "Login berhasil",
      token,
      user: {
        idUsername: user.IdUsername,
        username: user.Username,
        fullName,
        nik: resolvedNik,
        companyId: resolvedCompanyId ?? null,
        idUGroup: group?.idUGroup ?? null,
        uGroupName: group?.uGroupName ?? null,
        permissions,
      },
    });
  } catch (err) {
    console.error("Login error:", err);

    // 🔹 Differentiate database errors
    if (err.name === "ConnectionError") {
      return res.status(503).json({
        success: false,
        message:
          "Database sedang tidak dapat diakses. Silakan coba lagi nanti.",
        errorType: "database_connection",
      });
    }

    // 🔹 Generic server error
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan di server",
      errorType: "server_error",
    });
  }
}

module.exports = { login };
