const { badReq } = require("../../core/utils/http-error");

// Parse payload opsional inputsPartial: daftar { labelCode, qty } berisi
// jumlah yang dipilih operator untuk label tertentu (bongkar sebagian dari
// sisa). qty pcs (integer) untuk barangJadi/furnitureWip, qty kg (desimal)
// untuk mixer. Return Map<labelCode, qty>. inputs tetap berisi SEMUA kode
// label — field ini hanya override jumlah terpakai, bukan daftar label
// terpisah.
function parseInputsPartial(inputsPartial, inputs) {
  const map = new Map();
  if (inputsPartial == null) return map;
  if (!Array.isArray(inputsPartial)) {
    throw badReq("inputsPartial harus berupa array");
  }
  for (const item of inputsPartial) {
    const rec = (item ?? {});
    const code = String(rec.labelCode ?? "").trim();
    const rawQty = Number(rec.qty);
    if (!code) {
      throw badReq("inputsPartial[].labelCode wajib diisi");
    }
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      throw badReq(
        `inputsPartial qty untuk label ${code} wajib berupa angka lebih dari 0`,
      );
    }
    if (!inputs.includes(code)) {
      throw badReq(`Label ${code} pada inputsPartial tidak ada di inputs`);
    }
    if (map.has(code)) {
      throw badReq(`Label ${code} duplikat di inputsPartial`);
    }
    map.set(code, rawQty);
  }
  return map;
}

// qty yang benar-benar dipakai siklus ini untuk satu label: override dari
// inputsPartial kalau ada, kalau tidak seluruh sisa (availableQty).
// Label dengan used < available tidak di-DateUsage — sisanya masih hidup.
function resolveUsedQty(partialMap, code, availableQty) {
  const available = Number(availableQty || 0);
  const override = partialMap.get(code);
  if (override == null) return available;
  if (override > available) {
    throw badReq(
      `Qty partial label ${code} (${override}) melebihi sisa ${available}`,
    );
  }
  return override;
}

module.exports = { parseInputsPartial, resolveUsedQty };
