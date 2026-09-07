const { buildReportDoc } = require("../report-pdfmake");

describe("stock opname v2 pdfmake report", () => {
  it("uses full unscanned groups for the Label Belum Ditemukan table when detail rows are limited", () => {
    const doc = buildReportDoc({
      summary: {
        stockOpnameNo: "SO.0000000010",
        categoryCode: "washing",
        categoryName: "Washing",
        date: new Date("2026-09-01T00:00:00.000Z"),
        total: {
          labelCount: 10,
          scannedCount: 7,
          unscannedCount: 3,
          totalWeight: 100,
        },
        perJenis: [],
        perBlok: [],
      },
      scanSummary: { data: [] },
      unscannedLabels: {
        totalRecords: 3,
        totalUnscannedWeight: 30,
        groups: [
          { typeId: 1, typeName: "A", labelCount: 2, totalWeight: 25 },
          { typeId: 2, typeName: "B", labelCount: 1, totalWeight: 5 },
        ],
        data: [
          { labelNo: "W.1", typeId: 1, typeName: "A", weight: 10 },
          { labelNo: "W.2", typeId: 2, typeName: "B", weight: 5 },
        ],
      },
      locationMatch: { mismatches: [], mismatchCount: 0 },
    });

    const titleIndex = doc.content.findIndex(
      (item) => item.text === "Label Belum Ditemukan",
    );
    const table = doc.content
      .slice(titleIndex + 1)
      .find((item) => item.table)?.table;

    expect(table.body).toEqual([
      expect.any(Array),
      [
        { text: "1", style: "cellC" },
        { text: "A", style: "cell" },
        { text: "2", style: "cellR" },
        { text: "25,00", style: "cellR" },
      ],
      [
        { text: "2", style: "cellC" },
        { text: "B", style: "cell" },
        { text: "1", style: "cellR" },
        { text: "5,00", style: "cellR" },
      ],
      [
        { text: "", style: "cell" },
        { text: "TOTAL (3 label)", style: "cell" },
        { text: "", style: "cell" },
        { text: "30,00", style: "cellR" },
      ],
    ]);
  });
});
