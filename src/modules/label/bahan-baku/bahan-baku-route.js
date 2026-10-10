// routes/master/bahan-baku-routes.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../../../core/middleware/verify-token");
const attachPermissions = require("../../../core/middleware/attach-permissions");
const requirePermission = require("../../../core/middleware/require-permission");

const ctrl = require("./bahan-baku-controller");

router.use(verifyToken, attachPermissions);

/** Lolos bila user punya salah satu dari codes (atau wildcard "*"). */
const requireAnyPermission = (codes) => (req, res, next) => {
  const perms = req.userPermissions;
  if (!perms) {
    return res
      .status(500)
      .json({ success: false, message: "Permissions not attached" });
  }
  if (perms.has("*") || codes.some((c) => perms.has(c))) return next();
  return res.status(403).json({
    success: false,
    message: "Forbidden: insufficient permission",
    requiredAnyOf: codes,
  });
};

// GET all (pagination + search ?page=&limit=&search=)
router.get(
  "/labels/bahan-baku",
  requirePermission("label_bahanbaku:read"),
  ctrl.getAll,
);

// GET all bahan baku proses (prefix "AB.") (pagination + search ?page=&limit=&search=)
router.get(
  "/labels/bahan-baku-proses",
  requirePermission("label_bahanbaku:read"),
  ctrl.getAllProses,
);

// GET pallet list by NoBahanBaku
router.get(
  "/labels/bahan-baku/:nobahanbaku/pallet",
  requirePermission("label_bahanbaku:read"),
  ctrl.getPalletByNoBahanBaku,
);

router.get(
  "/labels/bahan-baku/:nobahanbaku/pallet/:nopallet",
  requirePermission("label_bahanbaku:read"),
  ctrl.getDetailByNoBahanBakuAndNoPallet,
);

// PUT update pallet header by NoBahanBaku and NoPallet
// (dipakai halaman Label Bahan Baku & Penerimaan Bahan Baku)
router.put(
  "/labels/bahan-baku/:nobahanbaku/pallet/:nopallet",
  requireAnyPermission([
    "label_bahanbaku:update",
    "qc_label:update",
    "penerimaanbahanbaku:update",
  ]),
  ctrl.updateByNoBahanBakuAndNoPallet,
);

router.patch(
  "/labels/bahan-baku/:nobahanbaku/pallet/:nopallet/print",
  requireAnyPermission([
    "label_bahanbaku:update",
    "penerimaanbahanbaku:update",
  ]),
  ctrl.incrementHasBeenPrinted,
);

// GET /labels/bahan-baku/:nobahanbaku/pallet/:nopallet/pdf
router.get(
  "/labels/bahan-baku/:nobahanbaku/pallet/:nopallet/pdf",
  requirePermission("label_bahanbaku:read"),
  ctrl.generatePdf,
);

module.exports = router;
