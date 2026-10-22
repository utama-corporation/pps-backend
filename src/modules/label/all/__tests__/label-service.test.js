// src/modules/label/all/__tests__/label-service.test.js

jest.mock("../../../../core/config/db", () => {
  const mQuery = jest.fn();
  const MockRequest = jest.fn().mockImplementation(() => {
    const req = {
      input: () => req,
      query: mQuery,
    };
    return req;
  });

  const makeType = (name) => jest.fn(() => name);
  const mPool = { request: () => new MockRequest() };

  return {
    sql: {
      VarChar: makeType("VarChar"),
      Int: makeType("Int"),
      Date: makeType("Date"),
      NVarChar: makeType("NVarChar"),
      Bit: makeType("Bit"),
      Request: MockRequest,
    },
    poolPromise: Promise.resolve(mPool),
    __mocks: { mQuery },
  };
});

const { mQuery } = require("../../../../core/config/db").__mocks;
const { updateLabelLocation } = require("../label-service");

// Urutan query di updateLabelLocation untuk prefix non-A dengan
// ENABLE_KATEGORI_JENIS_PRECONDITION = false (kondisi kode saat ini):
//   1. availability check (DateUsage) di tabel header kategori
//   2. dbo.MstBlok  -> IdWarehouse asal   (beforeIdWarehouse)
//   3. isLabelInTransit -> dbo.GoodsTransferItemScan_d (IsReceived = 0)
//   4. dbo.MstBlok  -> IdWarehouse tujuan (targetIdWarehouse)
//   5. [BARU] dbo.MstWarehouse -> IdWarehouseGroup utk kedua warehouse
//   6. [BARU] sp_set_session_context (audit actor + requestId)
//   7. UPDATE lokasi
function seedCrossWarehouse({ beforeGroup, targetGroup }) {
  mQuery
    .mockResolvedValueOnce({ recordset: [{ Blok: "A1", IdLokasi: 5, Available: 1 }] })
    .mockResolvedValueOnce({ recordset: [{ IdWarehouse: 1 }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [{ IdWarehouse: 2 }] })
    .mockResolvedValueOnce({
      recordset: [
        { IdWarehouse: 1, IdWarehouseGroup: beforeGroup },
        { IdWarehouse: 2, IdWarehouseGroup: targetGroup },
      ],
    })
    .mockResolvedValueOnce({ recordset: [] }) // sp_set_session_context
    .mockResolvedValueOnce({ rowsAffected: [1] });
}

// labelCode, idLokasi, blok tujuan, idUsername
const ARGS = ["B.0000000001", 7, "B2", 99];

beforeEach(() => {
  mQuery.mockReset();
});

describe("updateLabelLocation — pengecualian lintas warehouse untuk warehouse satu site", () => {
  test("izinkan pindah lintas warehouse bila kedua warehouse satu grup (IdWarehouseGroup sama & non-null)", async () => {
    seedCrossWarehouse({ beforeGroup: 100, targetGroup: 100 });

    const res = await updateLabelLocation(...ARGS);

    expect(res.success).toBe(true);
    expect(res.code).toBeUndefined();
    expect(mQuery).toHaveBeenCalledTimes(7); // termasuk lookup grup + audit context + UPDATE
  });

  test("tolak (CROSS_WAREHOUSE_NOT_ALLOWED) bila grup berbeda", async () => {
    seedCrossWarehouse({ beforeGroup: 100, targetGroup: 200 });

    const res = await updateLabelLocation(...ARGS);

    expect(res.success).toBe(false);
    expect(res.code).toBe("CROSS_WAREHOUSE_NOT_ALLOWED");
    expect(mQuery).toHaveBeenCalledTimes(5); // berhenti sebelum audit context + UPDATE
  });

  test("tolak bila salah satu warehouse ungrouped (IdWarehouseGroup NULL)", async () => {
    seedCrossWarehouse({ beforeGroup: 100, targetGroup: null });

    const res = await updateLabelLocation(...ARGS);

    expect(res.success).toBe(false);
    expect(res.code).toBe("CROSS_WAREHOUSE_NOT_ALLOWED");
  });

  test("tolak bila kedua warehouse ungrouped (keduanya NULL)", async () => {
    seedCrossWarehouse({ beforeGroup: null, targetGroup: null });

    const res = await updateLabelLocation(...ARGS);

    expect(res.success).toBe(false);
    expect(res.code).toBe("CROSS_WAREHOUSE_NOT_ALLOWED");
  });

  test("pindah dalam warehouse yang sama tidak memicu lookup grup ke MstWarehouse", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [{ Blok: "A1", IdLokasi: 5, Available: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ IdWarehouse: 1 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ IdWarehouse: 1 }] }) // tujuan = warehouse yang sama
      .mockResolvedValueOnce({ recordset: [] }) // sp_set_session_context
      .mockResolvedValueOnce({ rowsAffected: [1] }); // langsung UPDATE

    const res = await updateLabelLocation(...ARGS);

    expect(res.success).toBe(true);
    expect(mQuery).toHaveBeenCalledTimes(6); // tidak ada query ke-6 (MstWarehouse)
  });

  test("audit context (actor + requestId) di-set sebelum UPDATE agar Actor di AuditTrail benar", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [{ Blok: "A1", IdLokasi: 5, Available: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ IdWarehouse: 1 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ IdWarehouse: 1 }] })
      .mockResolvedValueOnce({ recordset: [] }) // sp_set_session_context
      .mockResolvedValueOnce({ rowsAffected: [1] });

    await updateLabelLocation("B.0000000001", 7, "B2", 99, "user99", "req-abc");

    const sqlCalls = mQuery.mock.calls.map((c) => String(c[0]));
    const auditIdx = sqlCalls.findIndex((s) => s.includes("sp_set_session_context"));
    const updateIdx = sqlCalls.findIndex((s) => s.includes("UPDATE"));

    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(auditIdx);
  });
});
