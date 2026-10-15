const { buildReportDoc } = require("../report-pdfmake");

describe("stock opname v2 pdfmake report", () => {
  it("lists unscanned labels per label with the same columns as the location mismatch table", () => {
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
        data: [
          {
            labelNo: "W.1",
            labelDate: new Date("2026-08-01T00:00:00.000Z"),
            blok: "A",
            locationId: "L01",
            typeId: 1,
            typeName: "A",
            weight: 10,
          },
          {
            labelNo: "W.2",
            labelDate: null,
            blok: "B",
            locationId: "L02",
            typeId: 2,
            typeName: "B",
            weight: 5,
          },
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

    expect(table.body[0]).toEqual([
      { text: "No. Label / Tgl", style: "hdrCell" },
      { text: "Jenis", style: "hdrCell" },
      { text: "Tercatat", style: "hdrCellC" },
      { text: "Berat", style: "hdrCellR" },
    ]);
    expect(table.body).toHaveLength(4);
    expect(table.body[2]).toEqual([
      { text: "W.2", style: "cell" },
      { text: "B", style: "cell" },
      { text: "BL02", style: "cellC" },
      { text: "5,00", style: "cellR" },
    ]);
    expect(table.body[3]).toEqual([
      { text: "TOTAL (3 label)", style: "cell" },
      { text: "", style: "cell" },
      { text: "", style: "cellC" },
      { text: "30,00", style: "cellR" },
    ]);
  });

  it("notes how many unscanned labels were omitted when detail rows are limited", () => {
    const data = Array.from({ length: 3 }, (_, i) => ({
      labelNo: `W.${i}`,
      labelDate: null,
      blok: "A",
      locationId: `L0${i}`,
      typeName: "A",
      weight: 1,
    }));

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
        totalRecords: 10,
        totalUnscannedWeight: 40,
        data,
      },
      locationMatch: { mismatches: [], mismatchCount: 0 },
    });

    const note = doc.content.find((item) =>
      String(item.text || "").startsWith("Menampilkan"),
    );
    expect(note.text).toBe("Menampilkan 3 dari 10 label belum ditemukan.");
  });
});
