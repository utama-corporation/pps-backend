// src/modules/dashboard-home/__tests__/dashboard-home-service.test.js
// Tanpa database: db diganti tiruan yang mengembalikan recordset sesuai isi query,
// dan master-mesin diganti canned response.

jest.mock("../../../core/config/db", () => {
  const defaultImpl = (q) => {
    if (q.includes("WITH Hari")) {
      return Promise.resolve({
        recordset: [
          { date: "2026-11-10", produksi: 5, penjualan: 2 },
          { date: "2026-11-11", produksi: 7, penjualan: 3 },
        ],
      });
    }
    if (q.includes("BongkarSusun_h")) return Promise.resolve({ recordset: [{ cnt: 4 }] });
    if (q.includes("BJSortirReject_h")) return Promise.resolve({ recordset: [{ cnt: 2 }] });
    if (q.includes("BJJual_h")) return Promise.resolve({ recordset: [{ cur: 8, prev: 4, today: 2 }] });
    if (q.includes("_h")) {
      const rows = {
        WashingProduksi_h: 10, BrokerProduksi_h: 11, CrusherProduksi_h: 12, MixerProduksi_h: 30,
        InjectProduksi_h: 14, GilinganProduksi_h: 15, HotStamping_h: 16, PasangKunci_h: 17,
        Spanner_h: 18, PackingProduksi_h: 19,
      };
      return Promise.resolve({
        recordset: [
          { k: "washing", cur: 10, prev: 5, today: 1 },
          { k: "broker", cur: 11, prev: 5.5, today: 1 },
          { k: "crusher", cur: 12, prev: 6, today: 1 },
          { k: "mixer", cur: 30, prev: 15, today: 1 },
          { k: "inject", cur: 14, prev: 7, today: 1 },
          { k: "gilingan", cur: 15, prev: 7.5, today: 1 },
          { k: "hotstamping", cur: 16, prev: 8, today: 1 },
          { k: "pasangkunci", cur: 17, prev: 8.5, today: 1 },
          { k: "spanner", cur: 18, prev: 9, today: 1 },
          { k: "packing", cur: 19, prev: 9.5, today: 1 },
        ],
      });
    }
    return Promise.resolve({ recordset: [] });
  };
  const mQuery = jest.fn(defaultImpl);
  const Request = jest.fn().mockImplementation(() => {
    const req = { input: () => req, query: (q) => mQuery(q) };
    return req;
  });
  const mkType = (name) => () => name;
  return {
    sql: { VarChar: mkType("VarChar"), Int: mkType("Int"), Date: mkType("Date"), Request },
    poolPromise: Promise.resolve({ request: () => new Request() }),
    __mQuery: mQuery,
    __defaultImpl: defaultImpl,
  };
});

jest.mock("../../master-mesin/master-mesin-service", () => {
  const rows = [
    { MachineStatus: "current" },
    { MachineStatus: "pending" },
    { MachineStatus: "idle" },
  ];
  const named = () => jest.fn(async () => rows);
  return {
    getWashingByNoProduksi: named(),
    getBrokerByNoProduksi: named(),
    getCrusherByNoProduksi: named(),
    getGilinganByNoProduksi: named(),
    getMixerByNoProduksi: named(),
    getInjectByNoProduksi: named(),
    getStampingByNoProduksi: named(),
    getPasangKunciByNoProduksi: named(),
    getSpannerByNoProduksi: named(),
    getPackingByNoProduksi: named(),
  };
});

const service = require("../dashboard-home-service");
const db = require("../../../core/config/db");

beforeEach(() => {
  service.clearCache();
  db.__mQuery.mockImplementation(db.__defaultImpl);
});

describe("getHome dashboard PPS", () => {
  test("full access: semua domain, aktivitas, dan tren", async () => {
    const today = new Date(2026, 10, 19);
    const data = await service.getHome({ permissions: ["*"], range: 7, today });
    expect(data.range_days).toBe(7);
    expect(data.to).toBe("2026-11-18");
    expect(data.prev_to).toBe("2026-11-11");
    const domains = Object.fromEntries(data.domains.map((d) => [d.key, d]));
    expect(domains.produksi.primary.value).toBe(10 + 11 + 12 + 30 + 14 + 15 + 16 + 17 + 18 + 19);
    expect(domains.produksi.delta.direction).toBe("up");
    expect(domains.produksi.delta.value).toBe(100);
    expect(domains.produksi.secondary[0].value).toBe(10);
    expect(domains.produksi.depts).toHaveLength(10);
    expect(domains.penjualan.primary.value).toBe(8);
    expect(domains.penjualan.delta.value).toBe(100);
    expect(domains.mesin.primary.value).toBe(10);
    expect(domains.mesin.secondary).toEqual([
      { label: "Pending", value: 10, unit: "mesin" },
      { label: "Idle", value: 10, unit: "mesin" },
    ]);
    expect(data.activity).toEqual([
      { key: "bongkar_susun", label: "Bongkar Susun", value: 4, error: null },
      { key: "sortir_reject", label: "Sortir Reject", value: 2, error: null },
    ]);
    expect(data.trend).toEqual([
      { date: "2026-11-10", produksi: 5, penjualan: 2 },
      { date: "2026-11-11", produksi: 7, penjualan: 3 },
    ]);
  });

  test("izin terbatas: hanya departemen berizin yang ikut dijumlah", async () => {
    const data = await service.getHome({ permissions: ["produksi_mixer:read"], range: 7 });
    const domains = Object.fromEntries(data.domains.map((d) => [d.key, d]));
    expect(domains.produksi.primary.value).toBe(30);
    expect(domains.produksi.depts).toEqual([
      { key: "mixer", label: "Mixer", value: 30, today: 1 },
    ]);
    expect(domains.penjualan).toBeUndefined();
    expect(domains.mesin).toBeDefined();
    expect(data.activity).toHaveLength(2);
    expect(data.trend).toBeDefined();
  });

  test("izin penjualan saja: produksi & tren produksi tidak tampil, tren penjualan tetap", async () => {
    const data = await service.getHome({ permissions: ["penjualan:read"], range: 7 });
    const keys = data.domains.map((d) => d.key);
    expect(keys).toEqual(["penjualan", "mesin"]);
    expect(data.trend).toBeDefined();
  });

  test("produksi gagal diperlakukan sebagai error, bagian lain tetap jalan", async () => {
    db.__mQuery.mockImplementation((q) =>
      q.includes("Produksi_h") && !q.includes("WITH Hari") && q.includes("UNION ALL")
        ? Promise.reject(new Error("boom"))
        : db.__defaultImpl(q),
    );
    const data = await service.getHome({ permissions: ["*"], range: 7 });
    const domains = Object.fromEntries(data.domains.map((d) => [d.key, d]));
    expect(domains.produksi.error).toBe("Data belum dapat dimuat.");
    expect(domains.mesin).toBeDefined();
    expect(data.activity[0].value).toBe(4);
    expect(data.trend).toBeDefined();
  });

  test("periods & pct", () => {
    const p = service.periods(7, new Date(2026, 10, 19));
    expect(p).toEqual({
      today: "2026-11-19",
      from: "2026-11-12",
      to: "2026-11-18",
      prevFrom: "2026-11-05",
      prevTo: "2026-11-11",
    });
    expect(service.pct(110, 100)).toBe(10);
    expect(service.pct(80, 100)).toBe(-20);
    expect(service.pct(10, 0)).toBeNull();
  });
});

describe("kolom tanggal per tabel", () => {
  // Mock db tidak tahu skema, jadi salah nama kolom (mis. BJSortirReject_h
  // pakai TglBJSortir, bukan Tanggal) baru ketahuan di server. Cocokkan
  // dengan kolom tanggal yang dipakai fitur tutup transaksi.
  test("setiap query memakai kolom tanggal yang benar", async () => {
    const { TUTUP_TRANSAKSI_SOURCES } = require("../../../core/config/tutup-transaksi-config");
    db.__mQuery.mockClear();
    await service.getHome({ permissions: ["*"], range: 7, today: new Date(2026, 10, 19) });
    const queries = db.__mQuery.mock.calls.map(([q]) => q);
    let checked = 0;
    for (const { table, dateColumn } of Object.values(TUTUP_TRANSAKSI_SOURCES)) {
      const name = table.replace(/^dbo\./, "");
      for (const q of queries) {
        if (!new RegExp(`\\b${name}\\b`).test(q)) continue;
        checked++;
        expect({ table: name, usesDateColumn: q.includes(dateColumn) }).toEqual({
          table: name,
          usesDateColumn: true,
        });
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("controller home", () => {
  const ctrl = require("../dashboard-home-controller");
  const res = () => ({
    code: 200,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  });

  test("range tidak valid ditolak 400", async () => {
    const r = res();
    await ctrl.home({ query: { range: "5" }, userPermissions: new Set() }, r);
    expect(r.code).toBe(400);
    expect(r.body.message).toContain("range");
  });

  test("range valid mengembalikan payload", async () => {
    const r = res();
    await ctrl.home({ query: { range: "7" }, userPermissions: new Set(["*"]) }, r);
    expect(r.body.success).toBe(true);
    expect(Array.isArray(r.body.data.domains)).toBe(true);
  });
});
