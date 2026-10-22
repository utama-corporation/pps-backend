jest.mock("../../../core/config/db", () => ({ sql: require("mssql"), poolPromise: Promise.resolve({}) }));

const { _validateCreate } = require("../stock-opname-ascend-service");

const base = {
  tanggal: "2026-10-21",
  allWarehouses: false,
  warehouseIds: [1, 2],
  selections: [{ categoryId: 3, familyIds: [10, 11] }],
};

describe("SO Ascend validateCreate", () => {
  it("menerima input valid dan menghilangkan duplikat", () => {
    const out = _validateCreate({ ...base, warehouseIds: [1, 1, 2] });
    expect(out.warehouseIds).toEqual([1, 2]);
    expect(out.selections).toEqual([{ categoryId: 3, familyIds: [10, 11] }]);
  });

  it("tanggal wajib format yyyy-mm-dd", () => {
    expect(() => _validateCreate({ ...base, tanggal: "21/10/2026" })).toThrow(/Tanggal/);
  });

  it("warehouse wajib kecuali ALL", () => {
    expect(() => _validateCreate({ ...base, warehouseIds: [] })).toThrow(/warehouse/);
    expect(_validateCreate({ ...base, allWarehouses: true, warehouseIds: [] }).allWarehouses).toBe(true);
  });

  it("minimal satu famili; kategori tanpa famili diabaikan", () => {
    expect(() => _validateCreate({ ...base, selections: [] })).toThrow(/Family/);
    expect(() =>
      _validateCreate({ ...base, selections: [{ categoryId: 3, familyIds: [] }] }),
    ).toThrow(/Family/);
  });

  it("menolak id bukan angka positif (cegah injeksi ke IN (...))", () => {
    expect(() => _validateCreate({ ...base, warehouseIds: ["1; DROP TABLE x"] })).toThrow(/tidak valid/);
    expect(() =>
      _validateCreate({ ...base, selections: [{ categoryId: 3, familyIds: [-1] }] }),
    ).toThrow(/tidak valid/);
  });
});
