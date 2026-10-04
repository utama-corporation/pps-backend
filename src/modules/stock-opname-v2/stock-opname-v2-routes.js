const express = require("express");
const router = express.Router();
const verifyToken = require("../../core/middleware/verify-token");
const attachPermissions = require("../../core/middleware/attach-permissions");
const requirePermission = require("../../core/middleware/require-permission");
const stockOpnameV2Controller = require("./stock-opname-v2-controller");
const { isUserAllowedForLokasi } = require("./stock-opname-v2-service");

// Guard endpoint label per lokasi (".../blok/:blok/lokasi/:locationId/label"
// di bawah) — user harus ditugaskan (MstUserLokasiAccess) ke Blok/IdLokasi
// untuk NoSO yang sedang diakses, kecuali admin (permission "*" atau
// "stockopname:create").
async function requireLokasiAccess(req, res, next) {
  try {
    if (
      req.userPermissions?.has("*") ||
      req.userPermissions?.has("stockopname:create")
    ) {
      return next();
    }

    const { stockOpnameNo, blok, locationId } = req.params;
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
      stockOpnameNo,
    });

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: `Anda tidak memiliki akses ke lokasi ${blok}/${idLokasi} untuk ${stockOpnameNo}`,
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

router.get(
  "/stock-opname-v2/kategori",
  verifyToken,
  stockOpnameV2Controller.listKategoriHandler,
);

router.get(
  "/stock-opname-v2/kategori/:categoryId/jenis",
  verifyToken,
  stockOpnameV2Controller.listJenisHandler,
);

router.get(
  "/stock-opname-v2/kategori/:categoryId/riwayat",
  verifyToken,
  stockOpnameV2Controller.listRiwayatHandler,
);

// Riwayat sesi stock opname LINTAS kategori (semua sesi, bukan per kategori)
// dengan paging server-side — dipakai panel "Riwayat Stock Opname" di tablet.
// Query opsional: year, month, status, search, page, pageSize.
// ⚠️ Daftarkan sebelum route "/stock-opname-v2/transaksi/:stockOpnameNo/..."
// di bawah, meski keduanya tidak akan tabrakan (jumlah segment URL beda).
router.get(
  "/stock-opname-v2/transaksi",
  verifyToken,
  stockOpnameV2Controller.listAllRiwayatHandler,
);

// ⚠️ Daftarkan SEBELUM POST "/stock-opname-v2/transaksi" (statis vs
// dokumentasi urutan route, meski beda method tidak akan tabrakan) — dipakai
// FE untuk menampilkan preview jumlah label sebelum benar-benar generate .
router.get(
  "/stock-opname-v2/transaksi/preview",
  verifyToken,
  stockOpnameV2Controller.previewLabelCountHandler,
);

router.post(
  "/stock-opname-v2/transaksi",
  verifyToken,
  stockOpnameV2Controller.generateStockOpnameHandler,
);

// Dipakai FE utk dialog konfirmasi sebelum PATCH .../complete di bawah —
// rangkuman total/per-jenis/per-blok label yang sudah vs belum discan.
router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/complete-summary",
  verifyToken,
  stockOpnameV2Controller.getCompleteSummaryHandler,
);

router.patch(
  "/stock-opname-v2/transaksi/:stockOpnameNo/complete",
  verifyToken,
  stockOpnameV2Controller.completeStockOpnameHandler,
);

router.delete(
  "/stock-opname-v2/transaksi/:stockOpnameNo",
  verifyToken,
  stockOpnameV2Controller.deleteStockOpnameHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/jenis",
  verifyToken,
  stockOpnameV2Controller.getJenisInNosoHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/jenis/:typeId/label",
  verifyToken,
  stockOpnameV2Controller.getSnapshotHandler,
);

router.post(
  "/stock-opname-v2/transaksi/:stockOpnameNo/hasil",
  verifyToken,
  attachPermissions,
  stockOpnameV2Controller.insertHasilHandler,
);

// Koreksi scan salah lokasi: hapus baris hasil yang salah supaya labelnya
// bisa discan ulang dengan lokasi yang benar. Aksi supervisor, bukan alur
// scan normal — gated permission "stockopname:create".
router.delete(
  "/stock-opname-v2/transaksi/:stockOpnameNo/hasil/:labelNo",
  verifyToken,
  attachPermissions,
  requirePermission("stockopname:create"),
  stockOpnameV2Controller.deleteHasilHandler,
);

// Rangkuman siapa saja yang sudah scan pada NoSO ini beserta jumlah label
// masing-masing — dipakai FE utk monitoring progres per user (bukan per
// lokasi tugas seperti ".../lokasi" di bawah).
router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/scan-summary",
  verifyToken,
  stockOpnameV2Controller.getScanUserSummaryHandler,
);

// Laporan cetak (PDF) — rangkuman total/per-jenis/per-blok/per-user scan,
// dipakai kepala gudang untuk arsip fisik / lampiran setelah SO selesai
// (tapi juga bisa dicetak kapan saja selama SO masih berjalan).
router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/laporan/pdf",
  verifyToken,
  stockOpnameV2Controller.getLaporanPdfHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/blok",
  verifyToken,
  stockOpnameV2Controller.listBlokHandler, 
);

// Dipakai app scan: daftar lokasi (lintas blok) pada NoSO ini, discope
// otomatis ke user yang login (berdasarkan MstUserLokasiAccess) — bukan
// endpoint per-blok seperti ".../blok/:blok/lokasi" di bawah.
router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/lokasi",
  verifyToken,
  attachPermissions,
  stockOpnameV2Controller.getMyLokasiHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/blok/:blok/lokasi",
  verifyToken,
  stockOpnameV2Controller.getLocationsHandler,
);

router.get(
  "/stock-opname-v2/transaksi/:stockOpnameNo/blok/:blok/lokasi/:locationId/label",
  verifyToken,
  attachPermissions,
  requireLokasiAccess,
  stockOpnameV2Controller.getSnapshotHandler,
);

// Lokasi tugas user yang login, lintas NoSO/kategori sekaligus (tidak perlu
// tahu NoSO-nya lebih dulu) — bandingkan dengan ".../transaksi/:stockOpnameNo/lokasi"
// di atas yang scoped ke satu NoSO tertentu.
router.get(
  "/stock-opname-v2/my-lokasi",
  verifyToken,
  stockOpnameV2Controller.listMyLokasiHandler,
);

// ================================================================
// Penugasan lokasi (MstUserLokasiAccess) — dikelola kepala gudang, di-scope
// per NoSO. Semua route ini butuh verifyToken + attachPermissions terlebih
// dulu (dipasang di router.use di bawah), lalu permission "stockopname:create".
// ================================================================
router.use("/stock-opname-v2/lokasi-access", verifyToken, attachPermissions);

// Daftar semua user (dipakai FE utk pilih user saat assign akses lokasi).
router.get(
  "/stock-opname-v2/lokasi-access/users",
  requirePermission("stockopname:create"),
  stockOpnameV2Controller.listAllUsersHandler,
);

router.get(
  "/stock-opname-v2/lokasi-access/blok/:blok/lokasi/:idLokasi",
  requirePermission("stockopname:create"),
  stockOpnameV2Controller.listUsersByLokasiHandler,
);

router.get(
  "/stock-opname-v2/lokasi-access/user/:idUsername",
  requirePermission("stockopname:create"),
  stockOpnameV2Controller.listLokasiByUserHandler,
);

router.post(
  "/stock-opname-v2/lokasi-access",
  requirePermission("stockopname:create"),
  stockOpnameV2Controller.assignAccessHandler,
);

router.delete(
  "/stock-opname-v2/lokasi-access/:stockOpnameNo/:blok/:idLokasi/:idUsername",
  requirePermission("stockopname:create"),
  stockOpnameV2Controller.revokeAccessHandler,
);

// Diekspos sebagai properti tambahan (bukan default export) supaya bisa
// di-unit-test terpisah tanpa perlu supertest/Express app penuh.
router.requireLokasiAccess = requireLokasiAccess;

module.exports = router;
