const express = require("express");
const router = express.Router();
const verifyToken = require("../../core/middleware/verify-token");
const ctrl = require("./sortir-reject-v2-controller");

router.get("/label/:labelCode", verifyToken, ctrl.getLabelInfo);
router.get("/", verifyToken, ctrl.getAll);
router.get("/laporan/html", verifyToken, ctrl.getLaporanHtml);
router.get("/laporan/pdf", verifyToken, ctrl.getLaporanPdf);
router.get("/laporan", verifyToken, ctrl.getLaporan);
router.get("/:noBJSortir", verifyToken, ctrl.getDetail);
router.post("/", verifyToken, ctrl.create);
router.post("/:noBJSortir/reject", verifyToken, ctrl.createReject);
router.put("/:noBJSortir", verifyToken, ctrl.updateSortirReject);
router.delete("/:noBJSortir", verifyToken, ctrl.deleteSortirReject);

module.exports = router;
