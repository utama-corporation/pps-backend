const { buildReportDoc } = require("../report-pdfmake");

const baseSummary = (categoryCode, categoryName) => ({
  stockOpnameNo: "SO.0000000010",
  categoryCode,
  categoryName,
  date: new Date("2026-09-01T00:00:00.000Z"),
  total: { labelCount: 10, scannedCount: 7, unscannedCount: 3, totalWeight: 100, totalPcs: 100 },
  perJenis: [],
  perBlok: [],
});

function unscannedTable(doc) {
  const titleIndex = doc.content.findIndex((item) => item.text === "Label Belum Ditemukan");
  return doc.content.slice(titleIndex + 1).find((item) => item.table)?.table;
}

describe("stock opname v2 pdfmake report", () => {
  it("versi stock tetap mencetak daftar per label", () => {
    const doc = buildReportDoc({
      summary: baseSummary("washing", "Washing"),
      scanSummary: { data: [] },
      unscannedLabels: { totalRecords: 1, totalUnscannedWeight: 5, data: [{ labelNo: "W.1", blok: "A", locationId: "L01", typeName: "A", weight: 5 }] },
      locationMatch: { mismatches: [], mismatchCount: 0 },
    });
    const table = unscannedTable(doc);
    expect(table.body[0].map((c) => c.text)).toEqual(["No. Label / Tgl", "Jenis", "Tercatat", "Berat"]);
    expect(table.body[2][0].text).toBe("TOTAL (1 label)");
  });

  it("summarizes unscanned labels per jenis (weight categories)", () => {
    const doc = buildReportDoc({
      versi: "accounting",
      summary: baseSummary("washing", "Washing"),
      scanSummary: { data: [] },
      unscannedLabels: {
        totalRecords: 3,
        totalUnscannedWeight: 30,
        data: [],
        groups: [
          { typeId: 2, typeName: "B", labelCount: 1, totalWeight: 5 },
          { typeId: 1, typeName: "A", labelCount: 2, totalWeight: 25 },
        ],
      },
      locationMatch: { mismatches: [], mismatchCount: 0 },
    });

    const table = unscannedTable(doc);
    expect(table.body[0].map((c) => c.text)).toEqual(["No", "Jenis", "Jumlah Label", "Sum(Berat)"]);
    expect(table.body[1].map((c) => c.text)).toEqual(["1", "A", "2", "25,00"]);
    expect(table.body[2].map((c) => c.text)).toEqual(["2", "B", "1", "5,00"]);
    expect(table.body[3].map((c) => c.text)).toEqual(["", "TOTAL", "3", "30,00"]);
  });

  it("uses Sum(Pcs) for pcs categories and falls back to detail rows", () => {
    const doc = buildReportDoc({
      versi: "accounting",
      summary: baseSummary("barangjadi", "Barang Jadi"),
      scanSummary: { data: [] },
      unscannedLabels: {
        totalRecords: 2,
        totalUnscannedPcs: 15,
        data: [
          { labelNo: "BJ.1", typeName: "X", pcs: 10 },
          { labelNo: "BJ.2", typeName: "X", pcs: 5 },
        ],
      },
      locationMatch: { mismatches: [], mismatchCount: 0 },
    });

    const table = unscannedTable(doc);
    expect(table.body[0][3].text).toBe("Sum(Pcs)");
    expect(table.body[1].map((c) => c.text)).toEqual(["1", "X", "2", "15"]);
    expect(table.body[2].map((c) => c.text)).toEqual(["", "TOTAL", "2", "15"]);
  });
});
