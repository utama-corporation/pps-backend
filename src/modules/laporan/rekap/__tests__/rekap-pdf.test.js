// src/modules/laporan/rekap/__tests__/rekap-pdf.test.js
const { buildRekapHtml } = require("../rekap-pdf");

function row(dimType, itemCode, jenis, pcs, berat, idWarehouse = "1050") {
  return { DimType: dimType, ItemCode: itemCode, Jenis: jenis, Pcs: pcs, Berat: berat, IdWarehouse: idWarehouse };
}

describe("buildRekapHtml", () => {
  it("memakai judul sesuai jenis rekap", () => {
    const html = buildRekapHtml({ jenis: "hot-stamping", tglAkhir: "2026-06-22", rows: [] });
    expect(html).toContain("Laporan Rekap Produksi Hot Stamping FWIP");
    expect(html).toContain("22 Juni 2026");
  });

  it("mengelompokkan baris urut Input, Output, Waste", () => {
    const html = buildRekapHtml({
      jenis: "hot-stamping",
      tglAkhir: "2026-06-22",
      rows: [
        row("Waste", "2.1.2.6.12", "REJECT MERAH LEMARI", 0, 8),
        row("Output", "2.1.2.9.01.03", "OUTER FOOT PAD KC ORANGE", 8, 0),
        row("Input", "2.1.2.8.01.03", "PK 3000 - UPPER DOOR HANDLE", 30, 0),
      ],
    });
    const urutan = ["INPUT", "OUTPUT", "WASTE"].map((tipe) => html.indexOf(`>${tipe}<`));
    expect(urutan.every((i) => i > -1)).toBe(true);
    expect(urutan[0]).toBeLessThan(urutan[1]);
    expect(urutan[1]).toBeLessThan(urutan[2]);
  });

  it("menghitung subtotal per kelompok dan total keseluruhan", () => {
    const html = buildRekapHtml({
      jenis: "hot-stamping",
      tglAkhir: "2026-06-22",
      rows: [
        row("Input", "A", "BAHAN A", 30, 0),
        row("Input", "B", "BAHAN B", 23, 0),
        row("Output", "C", "HASIL C", 8, 0),
        row("Waste", "D", "REJECT D", 0, 8),
      ],
    });
    expect(html).toContain("Subtotal Input");
    expect(html).toContain("Subtotal Output");
    expect(html).toContain("Subtotal Waste");
    expect(html).toContain("53"); // subtotal input
    expect(html).toContain("61"); // total pcs
    expect(html).toContain("8,00"); // total berat
  });

  it("menampilkan pesan kosong saat tidak ada data", () => {
    const html = buildRekapHtml({ jenis: "washing", tglAkhir: "2026-01-01", rows: [] });
    expect(html).toContain("Tidak ada data.");
  });

  it("melakukan escaping pada nilai dari database", () => {
    const html = buildRekapHtml({
      jenis: "hot-stamping",
      tglAkhir: "2026-06-22",
      rows: [row("Input", "<script>", "A & B <b>", 1, 0)],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });
});
