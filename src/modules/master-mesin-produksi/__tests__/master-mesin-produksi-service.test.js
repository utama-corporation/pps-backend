jest.mock("../../../core/config/db", () => ({ poolPromise: Promise.resolve({}) }));

const service = require("../master-mesin-produksi-service");

describe("master-mesin-produksi-service validasi", () => {
  const inject = service._resolveType("inject");
  const broker = service._resolveType("broker");

  test("slug tidak dikenal ditolak", () => {
    expect(() => service._resolveType("MstUser; DROP TABLE x")).toThrow(/tidak dikenali/);
    expect(() => service._resolveType("constructor")).toThrow(/tidak dikenali/);
  });

  test("10 jenis mesin terdaftar", () => {
    expect(service.listTypes().map((t) => t.key)).toEqual([
      "broker", "crusher", "gilingan", "hot-stamping", "inject",
      "mixer", "packing", "pasang-kunci", "spanner", "washing",
    ]);
  });

  test("nama, kapasitas, UOM wajib", () => {
    expect(() => service._validateInput(broker, { namaMesin: " ", kapasitas: 1, idUOM: 1 })).toThrow(/Nama mesin/);
    expect(() => service._validateInput(broker, { namaMesin: "A", idUOM: 1 })).toThrow(/Kapasitas/);
    expect(() => service._validateInput(broker, { namaMesin: "A", kapasitas: 1 })).toThrow(/UOM/);
  });

  test("koma desimal diterima, negatif/huruf ditolak", () => {
    const ok = service._validateInput(broker, { namaMesin: " M1 ", kapasitas: "12,5", idUOM: 2 });
    expect(ok).toMatchObject({ namaMesin: "M1", kapasitas: 12.5, idUOM: 2, enable: true });
    expect(() => service._parseDecimal("abc", "Kapasitas")).toThrow(/tidak valid/);
    expect(() => service._parseDecimal("-1", "Kapasitas")).toThrow(/negatif/);
  });

  test("kolom tambahan hanya untuk inject; kosong = 0", () => {
    const r = service._validateInput(inject, { namaMesin: "I", kapasitas: 1, idUOM: 1, klemLebar: "3,25" });
    expect(r.extra).toEqual({ ShortWeightPS: 0, KlemLebar: 3.25, KlemTinggi: 0 });
    expect(service._validateInput(broker, { namaMesin: "B", kapasitas: 1, idUOM: 1, klemLebar: 9 }).extra).toEqual({});
  });
});
