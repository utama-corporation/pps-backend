// Regression test untuk penentuan "bucket terakhir" pada proses Inject.
//
// Bug yang diperbaiki: perbandingan detik mentah
//   toSec(hourStart) >= toSec(HourEnd) - 3600
// selalu bernilai true untuk shift yang melewati tengah malam
// (mis. shift 3 = 23:00 → 07:00), sehingga bucket PERTAMA dianggap bucket
// penutup shift. Akibatnya label sisa pcs terbit lebih awal dan
// InjectProduksi_h.IsComplete di-set 1 pada bucket 23:00-00:00.
//
// Kasus S.0000034845 (HourStart 23:00, HourEnd 07:00) hanya punya 1 bucket
// dengan PcsInput 100 dari PcsPerLabel 1000, tapi tetap membuat label
// BB.0000077237 (Pcs 100) dan IsComplete = 1.

jest.mock("../../../../core/config/db", () => ({
  sql: { Date: "Date", Int: "Int", VarChar: "VarChar" },
  poolPromise: Promise.resolve({ request: jest.fn() }),
}));

const {
  isLastShiftBucket,
  secondsUntilShiftEnd,
  buildQcBuckets,
} = require("../inject-production-service");

const hourOnly = (t) => String(t).substring(0, 5);

describe("secondsUntilShiftEnd", () => {
  it("menghitung sisa shift normal (07:00 → 15:00)", () => {
    expect(secondsUntilShiftEnd("07:00:00", "15:00:00")).toBe(8 * 3600);
  });

  it("menangani shift yang melewati tengah malam (23:00 → 07:00)", () => {
    // 23:00 → 07:00 = 8 jam, bukan negatif.
    expect(secondsUntilShiftEnd("23:00:00", "07:00:00")).toBe(8 * 3600);
    expect(secondsUntilShiftEnd("00:00:00", "07:00:00")).toBe(7 * 3600);
  });

  it("membaca HourEnd 00:00 sebagai tengah malam, bukan 0 detik", () => {
    expect(secondsUntilShiftEnd("16:00:00", "00:00:00")).toBe(8 * 3600);
  });

  it("menerjemahkan HourStart == HourEnd sebagai shift 24 jam", () => {
    expect(secondsUntilShiftEnd("08:00:00", "08:00:00")).toBe(24 * 3600);
  });

  it("mengembalikan null untuk jam yang tidak terbaca", () => {
    expect(secondsUntilShiftEnd(null, "07:00:00")).toBeNull();
    expect(secondsUntilShiftEnd("23:00:00", null)).toBeNull();
    expect(secondsUntilShiftEnd("bukan jam", "07:00:00")).toBeNull();
  });
});

describe("isLastShiftBucket", () => {
  it("BUG REGRESSION — shift 23:00→07:00: bucket 23:00 bukan bucket terakhir", () => {
    // Inilah kondisi yang memicu bug pada S.0000034845.
    expect(isLastShiftBucket("23:00:00", "07:00:00")).toBe(false);
  });

  it("BUG REGRESSION — shift 16:00→00:01: hanya bucket 00:00 yang terakhir", () => {
    expect(isLastShiftBucket("16:00:00", "00:01:00")).toBe(false);
    expect(isLastShiftBucket("23:00:00", "00:01:00")).toBe(false);
    expect(isLastShiftBucket("00:00:00", "00:01:00")).toBe(true);
  });

  it("BUG REGRESSION — shift 16:00→00:00: hanya bucket 23:00 yang terakhir", () => {
    expect(isLastShiftBucket("16:00:00", "00:00:00")).toBe(false);
    expect(isLastShiftBucket("23:00:00", "00:00:00")).toBe(true);
  });

  it("shift normal: hanya bucket sebelum HourEnd yang terakhir", () => {
    expect(isLastShiftBucket("07:00:00", "15:00:00")).toBe(false);
    expect(isLastShiftBucket("14:00:00", "15:00:00")).toBe(true);
  });

  it("menerima HourEnd dengan maupun tanpa detik", () => {
    expect(isLastShiftBucket("23:00", "07:00")).toBe(false);
    expect(isLastShiftBucket("06:00", "07:00:00")).toBe(true);
  });

  it("hanya satu bucket terakhir per shift, di semua pola jam yang dipakai", () => {
    const shifts = [
      ["07:00:00", "15:00:00"],
      ["15:00:00", "23:00:00"],
      ["23:00:00", "07:00:00"],
      ["16:00:00", "00:01:00"],
      ["16:00:00", "00:00:00"],
      ["08:00:00", "08:00:00"],
      ["23:00:00", "23:00:00"],
    ];

    for (const [hs, he] of shifts) {
      const buckets = buildQcBuckets("2026-10-15", hs, he, 3);
      const flags = buckets.map((b) =>
        isLastShiftBucket(`${hourOnly(b.hourStart)}:00`, he),
      );

      expect({ shift: `${hs}→${he}`, flags }).toEqual({
        shift: `${hs}→${he}`,
        flags: buckets.map((_, i) => i === buckets.length - 1),
      });
    }
  });

  it("bucket penutup selalu bucket terakhir dari buildQcBuckets", () => {
    // Ikon-wrapper: label bucket yang sama harus menghasilkan keputusan sama.
    const cases = [
      ["23:00:00", "07:00:00"],
      ["16:00:00", "00:01:00"],
      ["07:00:00", "15:00:00"],
    ];
    for (const [hs, he] of cases) {
      const buckets = buildQcBuckets("2026-10-15", hs, he, 3);
      const last = buckets[buckets.length - 1];
      expect(isLastShiftBucket(`${hourOnly(last.hourStart)}:00`, he)).toBe(true);
      for (const b of buckets.slice(0, -1)) {
        expect(isLastShiftBucket(`${hourOnly(b.hourStart)}:00`, he)).toBe(false);
      }
    }
  });
});