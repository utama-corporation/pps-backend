const { conflict } = require("../../../core/utils/http-error");
const {
  getByNoBahanPendukung,
} = require("../../label/bahan-pendukung/bahan-pendukung-service");

exports.getLabelInfoBahanPendukung = async (labelCode) => {
  const row = await getByNoBahanPendukung(labelCode);

  if (row.DateUsage) {
    throw conflict(`Label ${row.NoBahanPendukung} sudah terpakai`);
  }

  if (row.IsPartial === true || row.IsPartial === 1) {
    throw conflict("Tidak dapat sortir reject label yang sudah di partial");
  }

  return {
    labelCode: row.NoBahanPendukung,
    category: "bahanPendukung",
    dateCreate: row.CreatedAt,
    idJenis: row.IdCabinetMaterial,
    namaJenis: row.NamaCabinetMaterial,
    pcs: Number(row.Qty ?? 0) || 0,
    hasBeenPrinted: row.HasBeenPrinted ?? 0,
    createBy: row.CreateBy,
    mesin: null,
    shift: null,
  };
};
