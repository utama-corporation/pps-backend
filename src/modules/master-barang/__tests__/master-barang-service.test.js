jest.mock("../../../core/config/db", () => ({ poolPromise: Promise.resolve({}) }));

const service = require("../master-barang-service");

const cfg = (slug) => service._resolveType(slug);

describe("master-barang validateInput", () => {
  it("menolak jenis master yang tidak dikenal", () => {
    expect(() => service._resolveType("bukan-jenis")).toThrow(/tidak dikenali/);
  });

  it("nama wajib diisi", () => {
    expect(() => service._validateInput(cfg("crusher"), { nama: "  " })).toThrow(/wajib diisi/);
  });

  it("item code wajib untuk data aktif, boleh kosong untuk nonaktif", () => {
    expect(() => service._validateInput(cfg("crusher"), { nama: "A" })).toThrow(/Item Code/);
    const out = service._validateInput(cfg("crusher"), { nama: "A", enable: false });
    expect(out.values.itemCode).toBeNull();
  });

  it("barang jadi: Tipe BJ wajib, angka koma jadi desimal", () => {
    const body = { nama: "B", itemCode: "X", idUOM: 1, beratSTD: "1,5", pcsPerLabel: "10" };
    expect(() => service._validateInput(cfg("barang-jadi"), body)).toThrow(/Tipe BJ/);
    const out = service._validateInput(cfg("barang-jadi"), { ...body, idBJType: 3 });
    expect(out.values).toMatchObject({ beratSTD: 1.5, pcsPerLabel: 10, idBJType: 3, idTypeSubBarang: null });
  });

  it("bahan baku: UOM opsional, isDisableMinMax default true", () => {
    const out = service._validateInput(cfg("bahan-baku"), { nama: "ABS" });
    expect(out.values).toMatchObject({ idUOM: null, isDisableMinMax: true, isReject: false });
  });

  it("menolak angka negatif / bukan angka", () => {
    const base = { nama: "G", itemCode: "1" };
    expect(() => service._validateInput(cfg("gilingan"), { ...base, saldoAwal: "-1" })).toThrow(/negatif/);
    expect(() => service._validateInput(cfg("gilingan"), { ...base, saldoAwal: "abc" })).toThrow(/tidak valid/);
  });
});
