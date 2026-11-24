// Tanpa database: SP & query diganti tiruan berisi angka sederhana.

const mockCalls = [];
let mockFailBroker = false;

jest.mock("../../../core/config/db", () => {
  const SP = {
    SP_LapProduktivitasWashing: [
      { NamaMesin: "WASHING 3", Inp: 1000, Outp: 900, Tenggelam: 100 },
      { NamaMesin: "WASHING 2", Inp: 500, Outp: 480, Tenggelam: 20 },
    ],
    SP_LapProduktivitasBroker: [
      { NoProduksi: "E.1", NamaMesin: "BROKER 2", TotalBerat: 1000, OutP: 950, Waste: 30 },
      // baris bahan tambahan: total 0, tidak boleh menggandakan input
      { NoProduksi: "E.1", NamaMesin: "BROKER 2", TotalBerat: 0, OutP: 0, Waste: 0 },
    ],
    sp_LapDashboardProduktifitas: [
      { tipe: "INPUT", Grup: "Mixer", Total: 400 },
      { tipe: "INPUT", Grup: "Mixer", Total: 600 },
      { tipe: "OUTPUT", Grup: "Mixer", Total: 1050 },
      { tipe: "MIXER 1", Grup: "Hasil Mixer", Total: 700 },
      { tipe: "MIXER 2", Grup: "Hasil Mixer", Total: 0 },
    ],
  };
  const request = () => {
    const inputs = {};
    return {
      input(k, _t, v) {
        inputs[k] = v;
        return this;
      },
      execute(name) {
        mockCalls.push({ name, inputs });
        if (name === "SP_LapProduktivitasBroker" && mockFailBroker) {
          return Promise.reject(new Error("boom"));
        }
        return Promise.resolve({ recordset: SP[name] || [] });
      },
      query(text) {
        mockCalls.push({ name: "inject-query", inputs, text });
        return Promise.resolve({
          recordset: [
            { NamaMesin: "INJECT 07", Pcs: 10000, Reject: 20, Docs: 3 },
            { NamaMesin: "INJECT 19", Pcs: 1000, Reject: 400, Docs: 2 },
            { NamaMesin: "INJECT 01", Pcs: 0, Reject: 5, Docs: 1 },
          ],
        });
      },
    };
  };
  return { sql: { Date: "date" }, poolPromise: Promise.resolve({ request }) };
});

const service = require("../kpi-service");

beforeEach(() => {
  mockCalls.length = 0;
  mockFailBroker = false;
  service.clearCache();
});

const metric = (kpi, key) => kpi.metrics.find((m) => m.key === key).value;

test("period is month-to-date of the given day", () => {
  expect(service.period("2026-11-22")).toEqual({ from: "2026-11-01", to: "2026-11-22" });
  expect(service.period("not-a-date")).toBeNull();
});

test("washing, broker and mixer rendemen use the official SP totals", async () => {
  const r = await service.getKpi({ tanggal: "2026-11-22", permissions: ["*"] });
  const by = Object.fromEntries(r.kpis.map((k) => [k.key, k]));
  expect(metric(by.washing, "rendemen")).toBe(92); // 1380 / 1500
  expect(metric(by.washing, "waste")).toBe(8);
  expect(by.washing.rows[0]).toMatchObject({ mesin: "WASHING 3", rendemen: 90, waste: 10, dokumen: null });
  expect(metric(by.broker, "rendemen")).toBe(95);
  expect(by.broker.input).toBe(1000);
  expect(by.broker.rows[0].dokumen).toBe(1);
  expect(metric(by.mixer, "rendemen")).toBe(105);
  expect(by.mixer.rows.map((x) => x.mesin)).toEqual(["MIXER 1"]);
  const wash = mockCalls.find((c) => c.name === "SP_LapProduktivitasWashing");
  expect(wash.inputs).toEqual({ StartDate: "2026-11-01", EndDate: "2026-11-22" });
});

test("inject uses kg reject per 1000 pcs, worst machine first", async () => {
  const r = await service.getKpi({ tanggal: "2026-11-22", permissions: ["injectproduksi:read"] });
  expect(r.kpis.map((k) => k.key)).toEqual(["inject"]);
  const inj = r.kpis[0];
  expect(metric(inj, "pcs")).toBe(11000);
  expect(metric(inj, "reject")).toBe(425);
  expect(metric(inj, "reject_per_1000")).toBe(38.64);
  expect(inj.rows.map((x) => [x.mesin, x.rejectPer1000])).toEqual([
    ["INJECT 19", 400],
    ["INJECT 07", 2],
    ["INJECT 01", null],
  ]);
});

test("laporan:read sees every KPI, no permission sees none and runs nothing", async () => {
  const all = await service.getKpi({ tanggal: "2026-11-22", permissions: ["laporan:read"] });
  expect(all.kpis.map((k) => k.key)).toEqual(["washing", "broker", "mixer", "inject"]);
  mockCalls.length = 0;
  service.clearCache();
  const none = await service.getKpi({ tanggal: "2026-11-22", permissions: [] });
  expect(none.kpis).toEqual([]);
  expect(mockCalls).toHaveLength(0);
});

test("a failing KPI reports an error without breaking the others", async () => {
  mockFailBroker = true;
  const r = await service.getKpi({ tanggal: "2026-11-22", permissions: ["*"] });
  const broker = r.kpis.find((k) => k.key === "broker");
  expect(broker.error).toBeTruthy();
  expect(r.kpis.find((k) => k.key === "washing").error).toBeUndefined();
});
