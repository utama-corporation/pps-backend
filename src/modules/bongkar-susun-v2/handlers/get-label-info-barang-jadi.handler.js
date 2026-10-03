const { conflict } = require("../../../core/utils/http-error");
const { getByNoBJ } = require("../../label/packing/packing-service");

exports.getLabelInfoBarangJadi = async (labelCode) => {
  const row = await getByNoBJ(labelCode);

  if (row.DateUsage) {
    throw conflict(`Label ${row.NoBJ} sudah terpakai`);
  }

  // Label yang sudah pernah dipecah (IsPartial = 1) TIDAK lagi otomatis
  // ditolak: operator boleh scan label fisik yang masih ada di gudang.
  // getByNoBJ sudah menghitung sisa pcs di field Pcs
  // (Pcs parent - SUM(BarangJadiPartial.Pcs)), jadi pcs di bawah adalah
  // jumlah yang benar-benar masih bisa dipakai, bukan pcs asli label.
  const isPartial = row.IsPartial === true || row.IsPartial === 1;
  const remainingPcs = Number(row.Pcs || 0);

  if (remainingPcs <= 0) {
    throw conflict(`Label ${row.NoBJ} sudah habis, tidak ada pcs tersisa`);
  }

  return {
    labelCode: row.NoBJ,
    category: "barangJadi",
    dateCreate: row.DateCreate,
    idJenis: row.IdBJ,
    namaJenis: row.NamaBJ,
    // Sisa pcs yang masih tersedia (bukan Pcs asli label kalau label
    // sudah pernah dipecah).
    pcs: remainingPcs,
    isPartial,
    hasBeenPrinted: row.HasBeenPrinted ?? 0,
    createBy: row.CreateBy,
    mesin: row.Mesin,
    shift: row.Shift,
  };
};
