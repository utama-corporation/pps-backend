function normalizeLabelCode(labelCode) {
  return String(labelCode || "").trim();
}

// Penjualan menerima 3 kategori: furniturewip, barangjadi & barangdagang
function detectCategory(labelCode) {
  const code = normalizeLabelCode(labelCode);
  if (code.startsWith("BA.")) return "barangjadi";
  if (code.startsWith("BB.")) return "furniturewip";
  if (code.startsWith("BD.")) return "barangdagang";
  return null;
}

module.exports = {
  detectCategory,
  normalizeLabelCode,
};
