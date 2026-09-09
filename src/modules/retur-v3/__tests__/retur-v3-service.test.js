const mockQuery = jest.fn();
const mockInput = jest.fn(function input() {
  return this;
});
const mockRequestInstance = { input: mockInput, query: mockQuery };
const mockRequest = jest.fn(() => mockRequestInstance);

jest.mock("../../../core/config/db", () => {
  const sql = {
    VarChar: jest.fn((n) => `VarChar(${n})`),
    NVarChar: Object.assign(jest.fn((n) => `NVarChar(${n})`), { MAX: "NVarChar(MAX)" }),
    Int: "Int",
    Date: "Date",
    DateTime: "DateTime",
    Decimal: jest.fn((p, s) => `Decimal(${p},${s})`),
    Bit: "Bit",
    Transaction: jest.fn().mockImplementation(() => ({
      begin: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
    })),
    Request: jest.fn().mockImplementation(() => mockRequestInstance),
    ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" },
  };
  return {
    sql,
    poolPromise: Promise.resolve({ request: mockRequest }),
  };
});

const { sql } = require("../../../core/config/db");
const service = require("../retur-v3-service");

const ctx = { actorId: 1, actorUsername: "tester", requestId: "rid-1" };

beforeEach(() => {
  mockQuery.mockReset();
  mockInput.mockClear();
  mockRequest.mockClear();
  sql.Request.mockClear();
});

describe("createHeader validation", () => {
  it("throws badReq when idPembeli is missing", async () => {
    await expect(
      service.createHeader({ tanggal: "2026-08-13" }, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws badReq when tanggal is missing", async () => {
    await expect(
      service.createHeader({ idPembeli: 1 }, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("addItems blocked once header is not PENDING", () => {
  it("throws conflict if header StatusRetur != PENDING", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [] }) // applyAuditContext session context exec
      .mockResolvedValueOnce({ recordset: [{ StatusRetur: "DIGANTI" }] }); // header select

    await expect(
      service.addItems(
        "RV.0000000001",
        [{ kodeKategori: "barangjadi", idJenis: 1, pcs: 5, kategoriInput: "BAGUS" }],
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("decide transition guard", () => {
  it("rejects double-decide (header already decided)", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [] }) // audit context
      .mockResolvedValueOnce({ recordset: [{ StatusRetur: "DIGANTI" }] }); // header select

    await expect(
      service.decide("RV.0000000001", "TIDAK_DIGANTI", {}, ctx),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects invalid decision value", async () => {
    await expect(
      service.decide("RV.0000000001", "MAYBE", ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects deciding a header with no items", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [] }) // audit context
      .mockResolvedValueOnce({ recordset: [{ StatusRetur: "PENDING" }] }) // header select
      .mockResolvedValueOnce({ recordset: [{ cnt: 0 }] }); // item count

    await expect(
      service.decide("RV.0000000001", "DIGANTI", {}, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("generate-reject requires berat + idReject", () => {
  it("throws badReq when berat is missing", async () => {
    const { generateRejectLabel } = require("../handlers/generate-reject.handler");
    await expect(
      generateRejectLabel("RV.0000000001", 1, { idReject: 2 }, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws badReq when idReject is missing", async () => {
    const { generateRejectLabel } = require("../handlers/generate-reject.handler");
    await expect(
      generateRejectLabel("RV.0000000001", 1, { berat: 3 }, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("generateLabel idempotency", () => {
  it("throws conflict when item already has GeneratedLabelCode", async () => {
    mockQuery.mockResolvedValueOnce({
      recordset: [
        {
          IdItem: 1,
          NoRetur: "RV.0000000001",
          KodeKategori: "barangjadi",
          KategoriInput: "BAGUS",
          IdJenis: 10,
          Pcs: 5,
          GeneratedLabelCode: "BA.0000000099",
        },
      ],
    }); // exports.generateLabel's initial item lookup (pool.request(), not tx)

    mockQuery.mockResolvedValueOnce({ recordset: [] }); // audit context inside handler
    mockQuery.mockResolvedValueOnce({
      recordset: [{ StatusRetur: "TIDAK_DIGANTI", IdWarehouse: 1 }],
    }); // header select inside handler
    mockQuery.mockResolvedValueOnce({
      recordset: [
        {
          IdItem: 1,
          NoRetur: "RV.0000000001",
          KodeKategori: "barangjadi",
          KategoriInput: "BAGUS",
          IdJenis: 10,
          Pcs: 5,
          GeneratedLabelCode: "BA.0000000099",
        },
      ],
    }); // item re-select (UPDLOCK) inside handler

    await expect(
      service.generateLabel("RV.0000000001", 1, {}, ctx),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("turnover scan auto-detect (single-button scan)", () => {
  it("rejects when no returned item matches the scanned label's kategori+jenis", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [] }) // audit context
      .mockResolvedValueOnce({ recordset: [{ StatusRetur: "DIGANTI" }] }) // header select
      .mockResolvedValueOnce({
        recordset: [
          { Code: "BA.0000000123", IdJenis: 10, Pcs: 3, DateUsage: null },
        ],
      }) // BarangJadi label lookup (found)
      .mockResolvedValueOnce({
        recordset: [
          { NoLabel: "BA.0000000123", IdJenis: 10, ParentPcs: 3, IsPartial: 0 },
        ],
      }) // lockParentAndAvailablePcs: parent row
      .mockResolvedValueOnce({ recordset: [{ PartialPcs: 0 }] }) // lockParentAndAvailablePcs: partial sum
      .mockResolvedValueOnce({ recordset: [] }); // no matching/available candidate items

    await expect(
      service.scanTurnoverAuto("RV.0000000001", "BA.0000000123", ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("markComplete", () => {
  it("blocks completion until every returned item is fully scanned", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [] }) // audit context
      .mockResolvedValueOnce({
        recordset: [{ StatusRetur: "DIGANTI", IsComplete: false }],
      }) // header select
      .mockResolvedValueOnce({
        recordset: [{ IdItem: 1, Pcs: 5, ScannedPcs: 3 }],
      }); // unfulfilled items query

    await expect(
      service.markComplete("RV.0000000001", ctx),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("is idempotent: rejects when already complete", async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [] }) // audit context
      .mockResolvedValueOnce({
        recordset: [{ StatusRetur: "DIGANTI", IsComplete: true }],
      }); // header select

    await expect(
      service.markComplete("RV.0000000001", ctx),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
