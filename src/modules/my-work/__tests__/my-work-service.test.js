// Tanpa database: db diganti tiruan yang mencatat query dan mengembalikan
// recordset sesuai tabel yang di-query.

const mockQueries = [];
let mockFailSO = false;

jest.mock("../../../core/config/db", () => {
  const respond = (q, inputs) => {
    mockQueries.push({ q, inputs });
    if (q.includes("StockOpname_h")) {
      if (mockFailSO) return Promise.reject(new Error("boom"));
      return Promise.resolve({ recordset: [{ no: "SO.01", tgl: "2026-11-20" }] });
    }
    if (q.includes("SPKBarangJadi_H")) {
      return Promise.resolve({ recordset: [{ no: "SPK.01", tgl: "2026-11-19", Keterangan: "Minggu ini" }] });
    }
    if (q.includes("HasBeenPrinted")) {
      return Promise.resolve({
        recordset: [
          { module: "label-packing", no: "BB.0001", tgl: "2026-11-19" },
          { module: "label-reject", no: "BF.0002", tgl: "2026-11-20" },
        ],
      });
    }
    if (q.includes("IsComplete")) {
      return Promise.resolve({
        recordset: [
          // shift sudah lewat -> pending
          { module: "mixer", no: "I.01", tgl: "2026-11-20", Shift: 1, HourStart: "08:00:00", HourEnd: "16:00:00", IsComplete: false },
          // shift sedang berjalan (now = 21 Nov 10:00) -> current, tidak masuk
          { module: "mixer", no: "I.02", tgl: "2026-11-21", Shift: 1, HourStart: "08:00:00", HourEnd: "16:00:00", IsComplete: false },
          // sudah lewat, departemen lain
          { module: "washing", no: "W.01", tgl: "2026-11-21", Shift: 1, HourStart: "00:00:00", HourEnd: "06:00:00", IsComplete: false },
        ],
      });
    }
    return Promise.resolve({ recordset: [] });
  };
  const request = () => {
    const inputs = {};
    return {
      input(k, _t, v) {
        inputs[k] = v;
        return this;
      },
      query: (q) => respond(q, inputs),
    };
  };
  return { sql: { VarChar: () => "varchar" }, poolPromise: Promise.resolve({ request }) };
});

const service = require("../my-work-service");

const now = new Date(2026, 10, 21, 10, 0, 0);
const ALL = ["*"];

beforeEach(() => {
  mockQueries.length = 0;
  mockFailSO = false;
});

test("summary lists every queue for a super admin with counts", async () => {
  const s = await service.getSummary({ username: "nancy", permissions: ALL, now });
  expect(s.queues.map((q) => [q.key, q.count])).toEqual([
    ["produksi_pending", 2],
    ["label_unprinted", 2],
    ["stock_opname", 1],
    ["spk_open", 1],
  ]);
  expect(s.total).toBe(6);
});

test("mockQueries are scoped to the token username and permitted sources only", async () => {
  await service.getSummary({
    username: "nancy",
    permissions: ["produksi_mixer:read", "label_reject:read"],
    now,
  });
  const prod = mockQueries.find((x) => x.q.includes("IsComplete") && !x.q.includes("StockOpname"));
  expect(prod.inputs.u).toBe("nancy");
  expect(prod.q).toContain("dbo.MixerProduksi_h");
  expect(prod.q).not.toContain("dbo.WashingProduksi_h");
  const label = mockQueries.find((x) => x.q.includes("HasBeenPrinted"));
  expect(label.q).toContain("dbo.RejectV2");
  expect(label.q).not.toContain("dbo.BarangJadi");
  expect(label.inputs.since).toBe("2026-10-23");
  expect(mockQueries.some((x) => x.q.includes("StockOpname_h"))).toBe(false);
  expect(mockQueries.some((x) => x.q.includes("SPKBarangJadi_H"))).toBe(false);
});

test("no permissions means no queues and no mockQueries", async () => {
  const s = await service.getSummary({ username: "x", permissions: [], now });
  expect(s.queues).toEqual([]);
  expect(s.total).toBe(0);
  expect(mockQueries).toHaveLength(0);
});

test("only shifts that are over count as pending, newest first", async () => {
  const r = await service.getItems({ key: "produksi_pending", username: "nancy", permissions: ALL, now });
  expect(r.items.map((i) => i.no)).toEqual(["W.01", "I.01"]);
  expect(r.items[0].module).toBe("washing");
  expect(r.items[1].subtitle).toBe("Shift 1 · 08:00–16:00");
});

test("search filters by number and title", async () => {
  const r = await service.getItems({
    key: "label_unprinted",
    search: "reject",
    username: "nancy",
    permissions: ALL,
    now,
  });
  expect(r.items.map((i) => i.no)).toEqual(["BF.0002"]);
  expect(r.total).toBe(1);
});

test("unknown or forbidden queue returns null", async () => {
  expect(await service.getItems({ key: "nope", username: "a", permissions: ALL, now })).toBeNull();
  expect(
    await service.getItems({ key: "spk_open", username: "a", permissions: ["stockopname:read"], now }),
  ).toBeNull();
});

test("a failing queue reports an error without breaking the others", async () => {
  mockFailSO = true;
  const s = await service.getSummary({ username: "nancy", permissions: ALL, now });
  const so = s.queues.find((q) => q.key === "stock_opname");
  expect(so.count).toBeNull();
  expect(so.error).toBeTruthy();
  expect(s.total).toBe(5);
});
