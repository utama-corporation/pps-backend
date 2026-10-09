function normalizeLabelCode(labelCode) {
  return String(labelCode || "").trim();
}

function detectCategory(labelCode) {
  const code = normalizeLabelCode(labelCode);
  if (code.startsWith("A.")) return "bahanBaku";
  if (code.startsWith("BA.")) return "barangJadi";
  // BF. (reject) harus dicek SEBELUM B. supaya tidak tertelan prefix 2 huruf.
  if (code.startsWith("BF.")) return "reject";
  if (code.startsWith("B.")) return "washing";
  if (code.startsWith("D.")) return "broker";
  if (code.startsWith("F.")) return "crusher";
  if (code.startsWith("V.")) return "gilingan";
  if (code.startsWith("BB.")) return "furnitureWip";
  if (code.startsWith("M.")) return "bonggolan";
  if (code.startsWith("H.")) return "mixer";
  if (code.startsWith("BF.")) return "reject";
  return null;
}

const CREATE_METHOD_BY_CATEGORY = {
  bahanBaku: "createBongkarSusunBahanBaku",
  washing: "createBongkarSusunWashing",
  broker: "createBongkarSusunBroker",
  crusher: "createBongkarSusunCrusher",
  gilingan: "createBongkarSusunGilingan",
  furnitureWip: "createBongkarSusunFurnitureWip",
  barangJadi: "createBongkarSusunBarangJadi",
  bonggolan: "createBongkarSusunBonggolan",
  mixer: "createBongkarSusunMixer",
  reject: "createBongkarSusunReject",
};

const LABEL_INFO_METHOD_BY_CATEGORY = {
  bahanBaku: "getLabelInfoBahanBaku",
  washing: "getLabelInfoWashing",
  broker: "getLabelInfoBroker",
  crusher: "getLabelInfoCrusher",
  gilingan: "getLabelInfoGilingan",
  furnitureWip: "getLabelInfoFurnitureWip",
  barangJadi: "getLabelInfoBarangJadi",
  bonggolan: "getLabelInfoBonggolan",
  mixer: "getLabelInfoMixer",
  reject: "getLabelInfoReject",
};

module.exports = {
  detectCategory,
  normalizeLabelCode,
  CREATE_METHOD_BY_CATEGORY,
  LABEL_INFO_METHOD_BY_CATEGORY,
};
