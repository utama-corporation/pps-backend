// Tanpa database: sql.Request diganti tiruan yang menjalankan "DB" kecil di
// memori, supaya efek stok (Qty label, DateUsage, log konsumsi) bisa diuji.

const mockDb = {};

function mockReset() {
  mockDb.header = null; // { NoReturBeli, Tanggal, IdSupplier, Status, Penyelesaian }
  mockDb.items = []; // { IdItem, NoReturBeli, NoLabel, Qty, Remark }
  mockDb.labels = {}; // code -> { IdSupplier, Qty, DateUsage }
  mockDb.konsumsi = []; // { NoProduksi, NoBahanPendukung, QtyKonsumsi }
  mockDb.suppliers = [7, 8];
  mockDb.nextId = 1;
}

jest.mock("../../../core/utils/db-audit-context", () => ({
  applyAuditContext: jest.fn().mockResolvedValue(),
}));
jest.mock("../../../core/utils/sequence-code-helper", () => ({
  generateNextCode: jest.fn().mockResolvedValue("RB.0000000001"),
}));
jest.mock("../../../core/shared/tutup-transaksi-guard", () => ({
  resolveEffectiveDateForCreate: (d) => (d ? String(d).slice(0, 10) : "2026-11-23"),
  assertNotLocked: jest.fn().mockResolvedValue(),
  loadDocDateOnlyFromTable: jest.fn().mockResolvedValue({ docDateOnly: "2026-11-23" }),
  formatYMD: (d) => String(d).slice(0, 10),
}));

jest.mock("../../../core/config/db", () => {
  const run = (q, inp) => {
    const db = mockDb;
    const rs = (recordset) => Promise.resolve({ recordset });
    if (q.includes("COL_LENGTH('dbo.ReturBeli_h'")) {
      return rs([{ HasIsComplete: 1, HasDecisionBy: 1, HasDecisionAt: 1 }]);
    }
    if (q.includes("FROM dbo.MstSupplier WHERE IdSupplier")) {
      return rs(db.suppliers.includes(inp.Id) ? [{ x: 1 }] : []);
    }
    if (q.includes("INSERT INTO dbo.ReturBeli_h")) {
      db.header = {
        NoReturBeli: inp.No,
        Tanggal: inp.Tanggal,
        IdSupplier: inp.IdSupplier,
        Status: "OPEN",
        IsComplete: false,
      };
      return rs([]);
    }
    if (q.includes("FROM dbo.ReturBeli_h WITH (UPDLOCK, HOLDLOCK)")) {
      return rs(db.header && db.header.NoReturBeli === inp.No ? [db.header] : []);
    }
    if (q.includes(";WITH LastClosed AS")) {
      if (!db.header) return rs([]);
      return rs([
        {
          NoReturBeli: db.header.NoReturBeli,
          Tanggal: "2026-11-23",
          IdSupplier: db.header.IdSupplier,
          NmSupplier: "Supplier 7",
          Keterangan: null,
          Status: db.header.Status,
          Penyelesaian: db.header.Penyelesaian ?? null,
          ItemCount: db.items.length,
          TotalQty: db.items.reduce((s, i) => s + Number(i.Qty), 0),
          IsLocked: false,
          CreateBy: "tester",
        },
      ]);
    }
    if (q.includes("FROM dbo.ReturBeli_h h WITH (NOLOCK)")) {
      return rs([{ total: db.header ? 1 : 0 }]);
    }
    if (q.includes("FROM dbo.BahanPendukung WITH (UPDLOCK, HOLDLOCK)")) {
      const l = db.labels[inp.Code];
      return rs(l ? [{ NoBahanPendukung: inp.Code, ...l }] : []);
    }
    if (q.includes("SELECT 1 FROM dbo.ReturBeli_d WHERE NoReturBeli = @No AND NoLabel")) {
      return rs(db.items.filter((i) => i.NoLabel === inp.Code));
    }
    if (q.includes("INSERT INTO dbo.ReturBeli_d")) {
      const IdItem = db.nextId++;
      db.items.push({ IdItem, NoReturBeli: inp.No, NoLabel: inp.Code, Qty: inp.Qty, Remark: inp.Remark });
      db.konsumsi.push({ NoProduksi: inp.No, NoBahanPendukung: inp.Code, QtyKonsumsi: inp.Qty });
      const l = db.labels[inp.Code];
      if (inp.Full) {
        l.Qty = 0;
        l.DateUsage = inp.Tanggal;
      } else {
        l.Qty = Math.round((l.Qty - inp.Qty) * 1000) / 1000;
      }
      return rs([{ IdItem }]);
    }
    if (q.includes("SELECT d.IdItem, d.NoLabel, d.Qty, d.Remark, b.Qty AS SisaLabel")) {
      const i = db.items.find((x) => x.IdItem === inp.Id);
      return rs(
        i
          ? [{ ...i, SisaLabel: db.labels[i.NoLabel].Qty, DateUsage: db.labels[i.NoLabel].DateUsage }]
          : [],
      );
    }
    if (q.includes("UPDATE dbo.ReturBeli_d SET Qty = @Qty, Remark = @Remark")) {
      const i = db.items.find((x) => x.IdItem === inp.Id);
      Object.assign(i, { Qty: inp.Qty, Remark: inp.Remark });
      const k = db.konsumsi.find(
        (x) => x.NoProduksi === inp.No && x.NoBahanPendukung === inp.Code,
      );
      if (k) k.QtyKonsumsi = inp.Qty;
      const l = db.labels[inp.Code];
      l.Qty = inp.Full ? 0 : Math.round(inp.SisaBaru * 1000) / 1000;
      l.DateUsage = inp.Full ? inp.Tanggal : null;
      return rs([]);
    }
    if (q.includes("UPDATE dbo.BahanPendukungKonsumsi_d SET QtyKonsumsi")) return rs([]);
    if (q.includes("WHERE d.IdItem = @Id")) {
      const i = db.items.find((x) => x.IdItem === inp.Id);
      return rs(i ? [{ ...i, SisaLabel: db.labels[i.NoLabel].Qty }] : []);
    }
    if (q.includes("SELECT NoLabel FROM dbo.ReturBeli_d WITH (UPDLOCK, HOLDLOCK)")) {
      const list = db.items.filter((i) => inp.Id == null || i.IdItem === inp.Id);
      return rs(list.map((i) => ({ NoLabel: i.NoLabel })));
    }
    if (q.includes("DECLARE @Lbl TABLE")) {
      const codes = JSON.parse(inp.Json).map((x) => x.code);
      for (const k of db.konsumsi.filter(
        (k) => k.NoProduksi === inp.No && codes.includes(k.NoBahanPendukung),
      )) {
        const l = db.labels[k.NoBahanPendukung];
        l.Qty = Math.round((l.Qty + k.QtyKonsumsi) * 1000) / 1000;
        l.DateUsage = null;
      }
      db.konsumsi = db.konsumsi.filter(
        (k) => !(k.NoProduksi === inp.No && codes.includes(k.NoBahanPendukung)),
      );
      return rs([]);
    }
    if (q.includes("DELETE FROM dbo.ReturBeli_d WHERE IdItem")) {
      db.items = db.items.filter((i) => i.IdItem !== inp.Id);
      return rs([]);
    }
    if (q.includes("DELETE FROM dbo.ReturBeli_h")) {
      db.items = [];
      db.header = null;
      return rs([]);
    }
    if (q.includes("SELECT TOP 1 1 AS x FROM dbo.ReturBeli_d")) {
      return rs(db.items.length ? [{ x: 1 }] : []);
    }
    if (q.includes("SELECT IdItem FROM dbo.ReturBeli_d WHERE NoReturBeli = @No")) {
      return rs(db.items.map((i) => ({ IdItem: i.IdItem })));
    }
    if (q.includes("SELECT COUNT(1) AS n FROM dbo.ReturBeli_d")) {
      return rs([{ n: db.items.length }]);
    }
    if (q.includes("SELECT d.IdItem, d.NoLabel AS LabelCode")) {
      return rs(
        db.items.map((i) => ({
          IdItem: i.IdItem,
          LabelCode: i.NoLabel,
          KodeKategori: "bahanpendukung",
          Qty: i.Qty,
          Remark: i.Remark,
          DateCreate: "2026-11-23",
        })),
      );
    }
    if (q.includes("SELECT d.IdItem, d.NoLabel, d.Qty, d.Remark,")) {
      return rs(
        db.items.map((i) => ({
          IdItem: i.IdItem,
          NoLabel: i.NoLabel,
          Qty: i.Qty,
          Remark: i.Remark,
          DateCreate: "2026-11-23",
        })),
      );
    }
    if (q.includes("SET Penyelesaian = @Penyelesaian, DecisionBy")) {
      Object.assign(db.header, {
        Penyelesaian: inp.Penyelesaian,
        DecisionBy: inp.By,
      });
      return rs([]);
    }
    if (q.includes("UPDATE dbo.ReturBeli_h") && q.includes("SELESAI")) {
      Object.assign(db.header, {
        Status: "SELESAI",
        Penyelesaian: inp.Penyelesaian ?? db.header.Penyelesaian,
        IsComplete: true,
      });
      return rs([]);
    }
    if (q.includes("UPDATE dbo.ReturBeli_h SET")) return rs([]);
    throw new Error(`unexpected query: ${q.slice(0, 100)}`);
  };
  class Request {
    constructor() {
      this.inputs = {};
    }
    input(k, _t, v) {
      this.inputs[k] = v;
      return this;
    }
    query(q) {
      return run(q, this.inputs);
    }
  }
  const sql = {
    VarChar: () => "varchar",
    NVarChar: Object.assign(() => "nvarchar", { MAX: "max" }),
    Int: "int",
    Date: "date",
    Bit: "bit",
    Decimal: () => "decimal",
    ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" },
    Request,
    Transaction: class {
      begin() {
        return Promise.resolve();
      }
      commit() {
        return Promise.resolve();
      }
      rollback() {
        return Promise.resolve();
      }
    },
  };
  return { sql, poolPromise: Promise.resolve({ request: () => new Request() }) };
});

const service = require("../retur-beli-service");
const ctx = { actorId: 1, actorUsername: "tester", requestId: "rid" };
const NO = "RB.0000000001";

async function openRetur() {
  await service.createHeader({ tanggal: "2026-11-23", idSupplier: 7 }, ctx);
}

beforeEach(() => {
  mockReset();
  mockDb.labels = {
    "BP.01": { IdSupplier: 7, Qty: 10, DateUsage: null },
    "BP.02": { IdSupplier: 7, Qty: 4.5, DateUsage: null },
    "BP.LAIN": { IdSupplier: 8, Qty: 5, DateUsage: null },
    "BP.HABIS": { IdSupplier: 7, Qty: 0, DateUsage: "2026-11-01" },
  };
});

describe("header", () => {
  it("creates an OPEN retur with RB. number and v3-style noRetur", async () => {
    const r = await service.createHeader({ tanggal: "2026-11-23", idSupplier: 7 }, ctx);
    expect(r).toMatchObject({ noRetur: NO, noReturBeli: NO, status: "OPEN", idSupplier: 7 });
  });

  it("validates supplier", async () => {
    await expect(service.createHeader({ idSupplier: "x" }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.createHeader({ idSupplier: 99 }, ctx)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("cannot change supplier once items exist", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.01" }, ctx);
    await expect(service.updateHeader(NO, { idSupplier: 8 }, ctx)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("getAllRetur supports search, status and date filters", async () => {
    await openRetur();
    const r = await service.getAllRetur({ page: 1, pageSize: 20, search: "RB", status: "OPEN" });
    expect(r.total).toBe(1);
    expect(r.data[0]).toMatchObject({ NoReturBeli: NO, ItemCount: 0, IsLocked: false });
  });
});

describe("items and stock", () => {
  it("partial return reduces label Qty and logs consumption", async () => {
    await openRetur();
    const item = await service.addItem(NO, { noLabel: "BP.01", qty: 3 }, ctx);
    expect(item.Qty).toBe(3);
    expect(mockDb.labels["BP.01"]).toMatchObject({ Qty: 7, DateUsage: null });
    expect(mockDb.konsumsi).toEqual([
      { NoProduksi: NO, NoBahanPendukung: "BP.01", QtyKonsumsi: 3 },
    ]);
  });

  it("empty qty returns the whole remaining label and marks it used", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.02" }, ctx);
    expect(mockDb.labels["BP.02"]).toMatchObject({ Qty: 0, DateUsage: "2026-11-23" });
    expect(mockDb.items[0].Qty).toBe(4.5);
  });

  it("rejects wrong supplier, used label, duplicate and too much qty", async () => {
    await openRetur();
    await expect(service.addItem(NO, { noLabel: "BP.LAIN" }, ctx)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.addItem(NO, { noLabel: "BP.HABIS" }, ctx)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.addItem(NO, { noLabel: "BP.01", qty: 11 }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.addItem(NO, { noLabel: "BP.01", qty: 0 }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await service.addItem(NO, { noLabel: "BP.01", qty: 1 }, ctx);
    await expect(service.addItem(NO, { noLabel: "BP.01", qty: 1 }, ctx)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockDb.labels["BP.01"].Qty).toBe(9);
  });

  it("addItems accepts a batch (retur-v3 shape)", async () => {
    await openRetur();
    const r = await service.addItems(NO, [{ noLabel: "BP.01", qty: 2 }, { noLabel: "BP.02", qty: 1 }], ctx);
    expect(r).toMatchObject({ noRetur: NO });
    expect(r.items).toHaveLength(2);
    expect(mockDb.labels["BP.01"].Qty).toBe(8);
    expect(mockDb.labels["BP.02"].Qty).toBe(3.5);
  });

  it("updateItem reconciles qty with stock and consumption log", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.01", qty: 2 }, ctx);
    const r = await service.updateItem(NO, 1, { qty: 5, remark: "ubah" }, ctx);
    expect(r.Qty).toBe(5);
    expect(mockDb.labels["BP.01"]).toMatchObject({ Qty: 5 });
    expect(mockDb.konsumsi[0].QtyKonsumsi).toBe(5);

    await service.updateItem(NO, 1, { qty: 10 }, ctx);
    expect(mockDb.labels["BP.01"]).toMatchObject({ Qty: 0, DateUsage: "2026-11-23" });
    await expect(service.updateItem(NO, 1, { qty: 11 }, ctx)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deleting an item restores the exact Qty", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.02" }, ctx);
    await service.deleteItem(NO, 1, ctx);
    expect(mockDb.labels["BP.02"]).toMatchObject({ Qty: 4.5, DateUsage: null });
    expect(mockDb.konsumsi).toEqual([]);
    expect(mockDb.items).toEqual([]);
  });

  it("deleting the document restores every label", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.01", qty: 2.25 }, ctx);
    await service.addItem(NO, { noLabel: "BP.02" }, ctx);
    const r = await service.deleteHeader(NO, ctx);
    expect(r.restoredLabels).toBe(2);
    expect(mockDb.labels["BP.01"].Qty).toBe(10);
    expect(mockDb.labels["BP.02"]).toMatchObject({ Qty: 4.5, DateUsage: null });
    expect(mockDb.header).toBeNull();
  });
});

describe("scan & turnover", () => {
  it("scanAuto adds the whole label and can offer partial confirmation", async () => {
    await openRetur();
    const r = await service.scanLabelAuto(NO, "BP.01", ctx, {});
    expect(r).toMatchObject({ noRetur: NO, noLabel: "BP.01", qty: 10 });
    expect(mockDb.labels["BP.01"].Qty).toBe(0);

    await service.deleteItem(NO, r.idItem, ctx);
    const confirm = await service.scanLabelAuto(NO, "BP.01", ctx, { qty: 12 });
    expect(confirm.needsConfirmation).toBe(true);
    expect(confirm.availableQty).toBe(10);
    expect(mockDb.items).toHaveLength(0);

    const applied = await service.scanLabelAuto(NO, "BP.01", ctx, { qty: 12, confirmPartial: true });
    expect(applied.qty).toBe(10);
  });

  it("getOutputs and getTurnover mirror v3 shape; undoScan restores stock", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.01", qty: 3 }, ctx);
    const outputs = await service.getOutputs(NO);
    expect(outputs[0]).toMatchObject({ LabelCode: "BP.01", Qty: 3 });
    const turnover = await service.getTurnover(NO);
    expect(turnover[0]).toMatchObject({ idTurnover: 1, labelCode: "BP.01", qty: 3 });

    const undone = await service.undoScan(NO, 1, ctx);
    expect(undone).toMatchObject({ noRetur: NO, idTurnover: 1 });
    expect(mockDb.labels["BP.01"].Qty).toBe(10);
  });
});

describe("decision & complete", () => {
  it("decide requires a valid penyelesaian and at least one item", async () => {
    await openRetur();
    await expect(service.decide(NO, "x", {}, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.decide(NO, "DIGANTI", {}, ctx)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("decide then complete locks the document (v3 two-step flow)", async () => {
    await openRetur();
    await service.addItem(NO, { noLabel: "BP.01", qty: 1 }, ctx);
    const d = await service.decide(NO, "potong_tagihan", {}, ctx);
    expect(d).toMatchObject({ noRetur: NO, penyelesaian: "POTONG_TAGIHAN", decision: "POTONG_TAGIHAN" });
    expect(mockDb.header.Status).toBe("OPEN");

    const c = await service.markComplete(NO, {}, ctx);
    expect(c).toMatchObject({ noRetur: NO, status: "SELESAI", isComplete: true });
    expect(mockDb.header.Penyelesaian).toBe("POTONG_TAGIHAN");
    await expect(service.addItem(NO, { noLabel: "BP.02" }, ctx)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.deleteItem(NO, 1, ctx)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.deleteHeader(NO, ctx)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockDb.labels["BP.01"].Qty).toBe(9);
  });

  it("legacy complete(no, { penyelesaian }) still works", async () => {
    await openRetur();
    await expect(service.complete(NO, { penyelesaian: "x" }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.complete(NO, { penyelesaian: "DIGANTI" }, ctx)).rejects.toMatchObject({ statusCode: 409 });
    await service.addItem(NO, { noLabel: "BP.01", qty: 1 }, ctx);
    const r = await service.complete(NO, { penyelesaian: "potong_tagihan" }, ctx);
    expect(r).toMatchObject({ status: "SELESAI", isComplete: true });
    expect(mockDb.header.Penyelesaian).toBe("POTONG_TAGIHAN");
  });
});
