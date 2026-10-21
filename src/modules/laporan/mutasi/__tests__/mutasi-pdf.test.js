// src/modules/laporan/mutasi/__tests__/mutasi-pdf.test.js
const { buildMutasiHtml, splitColumns, getConfig } = require("../mutasi-pdf");

function row(jenis, nama, values) {
  return { ...values, [getConfig(jenis).name]: nama };
}

describe("splitColumns", () => {
  test("memisahkan kolom nama, nilai utama, dan rincian", () => {
    const keys = [
      "Jenis",
      "BeratAwal",
      "BeratMasuk",
      "BeratKeluar",
      "BeratAkhir",
      "BeratADJKeluar",
      "BeratBSUKeluar",
    ];
    const { nameKey, coreKeys, detailKeys } = splitColumns("washing", keys);
    expect(nameKey).toBe("Jenis");
    expect(coreKeys).toEqual([
      "BeratAwal",
      "BeratMasuk",
      "BeratKeluar",
      "BeratAkhir",
    ]);
    expect(detailKeys).toEqual(["BeratADJKeluar", "BeratBSUKeluar"]);
  });

  test("memakai daftar kolom dari config saat hasil kosong", () => {
    const { nameKey, coreKeys, detailKeys } = splitColumns("bonggolan", []);
    expect(nameKey).toBe("NamaBonggolan");
    expect(coreKeys).toHaveLength(4);
    expect(detailKeys).toContain("KeluarNot");
  });

  test("jenis furniture-wip memakai satuan Pcs", () => {
    expect(getConfig("furniture-wip").unit).toBe("Pcs");
    expect(getConfig("washing").unit).toBe("Kg");
  });
});

describe("buildMutasiHtml", () => {
  test("menampilkan judul, periode, dan ringkasan", () => {
    const html = buildMutasiHtml({
      jenis: "washing",
      tglAwal: "2026-10-01",
      tglAkhir: "2026-10-21",
      keys: ["Jenis", "BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
      rows: [
        { Jenis: "PP GIL BIRU", BeratAwal: 100, BeratMasuk: 20, BeratKeluar: 30, BeratAkhir: 90 },
      ],
    });
    expect(html).toContain("Laporan Mutasi Washing");
    expect(html).toContain("01 Oktober 2026");
    expect(html).toContain("21 Oktober 2026");
    expect(html).toContain("Rekap Saldo");
    expect(html).toContain("PP GIL BIRU");
    expect(html).toContain("100,00");
  });

  test("menampilkan baris TOTAL", () => {
    const html = buildMutasiHtml({
      jenis: "crusher",
      tglAwal: "2026-10-01",
      tglAkhir: "2026-10-21",
      keys: [
        "NamaCrusher",
        "BeratAwal",
        "BeratMasuk",
        "BeratKeluar",
        "BeratAkhir",
        "BeratBSUInput",
      ],
      rows: [
        { NamaCrusher: "CRUS A", BeratAwal: 10, BeratMasuk: 5, BeratKeluar: 2, BeratAkhir: 13, BeratBSUInput: 1 },
        { NamaCrusher: "CRUS B", BeratAwal: 20, BeratMasuk: 1, BeratKeluar: 3, BeratAkhir: 18, BeratBSUInput: 2 },
      ],
    });
    expect(html).toContain("Rincian Mutasi");
    expect(html).toContain("Input BSU (Kg)");
    // total Berat Awal = 10 + 20 = 30
    expect(html).toContain("30,00");
  });

  test("menampilkan pesan kosong saat tidak ada data", () => {
    const html = buildMutasiHtml({
      jenis: "broker",
      tglAwal: "2026-10-01",
      tglAkhir: "2026-10-21",
      keys: [],
      rows: [],
    });
    expect(html).toContain("Tidak ada data.");
  });

  test("melakukan escaping pada nilai dari database", () => {
    const html = buildMutasiHtml({
      jenis: "washing",
      tglAwal: "2026-10-01",
      tglAkhir: "2026-10-21",
      keys: ["Jenis", "BeratAwal", "BeratMasuk", "BeratKeluar", "BeratAkhir"],
      rows: [
        { Jenis: "<script>A & B", BeratAwal: 1, BeratMasuk: 0, BeratKeluar: 0, BeratAkhir: 1 },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;A &amp; B");
  });
});
