jest.mock("../../../core/config/db", () => {
  const mQuery = jest.fn();

  const MockRequest = jest.fn().mockImplementation(() => {
    const req = {
      input: () => req,
      query: mQuery,
    };
    return req;
  });

  const makeType = (name) => jest.fn(() => name);

  const mPool = {
    request: () => new MockRequest(),
  };

  return {
    sql: {
      VarChar: makeType("VarChar"),
      Int: makeType("Int"),
      Request: MockRequest,
    },
    poolPromise: Promise.resolve(mPool),
    __mocks: { mQuery, MockRequest, mPool },
  };
});

const service = require("../stock-opname-v2-service");
const db = require("../../../core/config/db");
const { mQuery } = db.__mocks;

beforeEach(() => {
  mQuery.mockReset();
});

describe("listMyLokasiWithLabelCount", () => {
  it("returns a per-NoSO breakdown for each of the user's lokasi, including when 2 NoSO are active in the same category", async () => {
    mQuery
      .mockResolvedValueOnce({
        recordset: [
          { NoSO: "SO.01", Blok: "A", IdLokasi: 10, IdUsername: 7, description: "Gudang A" },
          { NoSO: "SO.02", Blok: "A", IdLokasi: 10, IdUsername: 7, description: "Gudang A" },
          { NoSO: "SO.02", Blok: "B", IdLokasi: 20, IdUsername: 7, description: "Gudang B" },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          { NoSO: "SO.01", KodeKategori: "washing" },
          { NoSO: "SO.02", KodeKategori: "washing" },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          { blok: "A", locationId: 10, labelCount: 5, totalWeight: 100, scannedCount: 2 },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [
          { blok: "A", locationId: 10, labelCount: 3, totalWeight: 50, scannedCount: 1 },
          { blok: "B", locationId: 20, labelCount: 2, totalWeight: 20, scannedCount: 0 },
        ],
      });

    const result = await service.listMyLokasiWithLabelCount(7);

    expect(result).toEqual([
      { stockOpnameNo: "SO.01", categoryCode: "washing", blok: "A", locationId: 10, description: "Gudang A", labelCount: 5, scannedCount: 2, totalWeight: 100 },
      { stockOpnameNo: "SO.02", categoryCode: "washing", blok: "A", locationId: 10, description: "Gudang A", labelCount: 3, scannedCount: 1, totalWeight: 50 },
      { stockOpnameNo: "SO.02", categoryCode: "washing", blok: "B", locationId: 20, description: "Gudang B", labelCount: 2, scannedCount: 0, totalWeight: 20 },
    ]);
  });

  it("returns an empty array when the user has no lokasi assigned", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [] });

    const result = await service.listMyLokasiWithLabelCount(7);

    expect(result).toEqual([]);
  });

  it("still lists the assigned NoSO with zero counts when there's no matching snapshot data", async () => {
    mQuery
      .mockResolvedValueOnce({
        recordset: [
          { NoSO: "SO.03", Blok: "A", IdLokasi: 1, IdUsername: 7, description: "Lokasi 1" },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [{ NoSO: "SO.03", KodeKategori: "crusher" }],
      })
      .mockResolvedValueOnce({ recordset: [] });

    const result = await service.listMyLokasiWithLabelCount(7);

    expect(result).toEqual([
      { stockOpnameNo: "SO.03", categoryCode: "crusher", blok: "A", locationId: 1, description: "Lokasi 1", labelCount: 0, scannedCount: 0, totalWeight: 0 },
    ]);
  });

  it("still lists the assigned NoSO even when its category can't be resolved (e.g. already completed/removed)", async () => {
    mQuery
      .mockResolvedValueOnce({
        recordset: [
          { NoSO: "SO.99", Blok: "A", IdLokasi: 1, IdUsername: 7, description: "Lokasi 1" },
        ],
      })
      .mockResolvedValueOnce({ recordset: [] });

    const result = await service.listMyLokasiWithLabelCount(7);

    expect(result).toEqual([
      { stockOpnameNo: "SO.99", categoryCode: null, blok: "A", locationId: 1, description: "Lokasi 1", labelCount: 0, scannedCount: 0, totalWeight: 0 },
    ]);
  });
});

describe("listAllUsers", () => {
  it("returns users without the Password column", async () => {
    mQuery.mockResolvedValueOnce({
      recordset: [
        { IdUsername: 7, Username: "budi", FName: "Budi", LName: null },
      ],
    });

    const users = await service.listAllUsers();

    expect(users).toEqual([
      { IdUsername: 7, Username: "budi", FName: "Budi", LName: null },
    ]);
    const [querySql] = mQuery.mock.calls[0];
    expect(querySql).not.toMatch(/Password/i);
    expect(querySql).toMatch(/WHERE IsEnable = 1/);
  });
});

describe("getAllStockOpnameRiwayat", () => {
  it("lists sesi lintas kategori with paging meta and per-NoSO label counts", async () => {
    // Urutan call: (1) list, (2) count, (3) hitung label per kategori
    // washing, (4) hitung label per kategori crusher.
    mQuery
      .mockResolvedValueOnce({
        recordset: [
          {
            NoSO: "SO.002",
            IdKategori: 1,
            Tanggal: "2026-09-02T00:00:00.000Z",
            IsComplete: 1,
            DateComplete: "2026-09-03T00:00:00.000Z",
            KodeKategori: "washing",
            NamaKategori: "Washing",
          },
          {
            NoSO: "SO.001",
            IdKategori: 2,
            Tanggal: "2026-09-01T00:00:00.000Z",
            IsComplete: 0,
            DateComplete: null,
            KodeKategori: "crusher",
            NamaKategori: "Crusher",
          },
        ],
      })
      .mockResolvedValueOnce({ recordset: [{ total: 2 }] })
      .mockResolvedValueOnce({
        recordset: [{ NoSO: "SO.002", labelCount: 10, scannedCount: 10 }],
      })
      .mockResolvedValueOnce({
        recordset: [{ NoSO: "SO.001", labelCount: 4, scannedCount: 1 }],
      });

    const result = await service.getAllStockOpnameRiwayat({ page: 1 });

    expect(result.currentPage).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.totalRecords).toBe(2);
    expect(result.totalPages).toBe(1);
    expect(result.data).toEqual([
      {
        stockOpnameNo: "SO.002",
        categoryId: 1,
        categoryCode: "washing",
        categoryName: "Washing",
        status: "completed",
        labelCount: 10,
        scannedCount: 10,
        startDate: "2026-09-02T00:00:00.000Z",
        completedAt: "2026-09-03T00:00:00.000Z",
      },
      {
        stockOpnameNo: "SO.001",
        categoryId: 2,
        categoryCode: "crusher",
        categoryName: "Crusher",
        status: "in_progress",
        labelCount: 4,
        scannedCount: 1,
        startDate: "2026-09-01T00:00:00.000Z",
        completedAt: null,
      },
    ]);
  });

  it("returns an empty page when no sesi match", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ total: 0 }] });

    const result = await service.getAllStockOpnameRiwayat({});

    expect(result.data).toEqual([]);
    expect(result.totalRecords).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("filters by year/month and status without touching the DB when status is not_started", async () => {
    const result = await service.getAllStockOpnameRiwayat({
      year: 2026,
      month: 9,
      status: "not_started",
    });

    // Setiap baris header sudah mewakili sesi, jadi not_started tidak
    // mungkin ada — hasilnya kosong dan tidak ada query sama sekali.
    expect(result.data).toEqual([]);
    expect(result.totalRecords).toBe(0);
    expect(mQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid month", async () => {
    await expect(
      service.getAllStockOpnameRiwayat({ month: 13 }),
    ).rejects.toThrow("month wajib berupa integer 1-12");
    expect(mQuery).not.toHaveBeenCalled();
  });

  it("rejects an unknown status value", async () => {
    await expect(
      service.getAllStockOpnameRiwayat({ status: "selesai" }),
    ).rejects.toThrow(/status wajib salah satu dari/);
    expect(mQuery).not.toHaveBeenCalled();
  });

  it("keeps the row but zeroes the counts when its category has no snapshot config", async () => {
    mQuery
      .mockResolvedValueOnce({
        recordset: [
          {
            NoSO: "SO.003",
            IdKategori: 9,
            Tanggal: "2026-09-01T00:00:00.000Z",
            IsComplete: 0,
            DateComplete: null,
            KodeKategori: "kategori-tanpa-config",
            NamaKategori: "Tanpa Config",
          },
        ],
      })
      .mockResolvedValueOnce({ recordset: [{ total: 1 }] });

    const result = await service.getAllStockOpnameRiwayat({});

    expect(result.data).toEqual([
      {
        stockOpnameNo: "SO.003",
        categoryId: 9,
        categoryCode: "kategori-tanpa-config",
        categoryName: "Tanpa Config",
        status: "in_progress",
        labelCount: 0,
        scannedCount: 0,
        startDate: "2026-09-01T00:00:00.000Z",
        completedAt: null,
      },
    ]);
  });
});

describe("isUserAllowedForLokasi", () => {
  it("returns true when a row is found for the given NoSO", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [{ found: 1 }] });

    const allowed = await service.isUserAllowedForLokasi({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
      stockOpnameNo: "SO.01",
    });

    expect(allowed).toBe(true);
  });

  it("returns false when no row is found", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [] });

    const allowed = await service.isUserAllowedForLokasi({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
      stockOpnameNo: "SO.01",
    });

    expect(allowed).toBe(false);
  });
});

describe("listAllowedUsersGroupedByLokasi", () => {
  it("groups allowed users by IdLokasi", async () => {
    mQuery.mockResolvedValueOnce({
      recordset: [
        { IdLokasi: 25, IdUsername: 7, Username: "budi", FName: "Budi", LName: null },
        { IdLokasi: 25, IdUsername: 8, Username: "citra", FName: "Citra", LName: "S" },
        { IdLokasi: 30, IdUsername: 7, Username: "budi", FName: "Budi", LName: null },
      ],
    });

    const map = await service.listAllowedUsersGroupedByLokasi("A", "SO.01");

    expect(map.get(25)).toEqual([
      { idUsername: 7, username: "budi", fullName: "Budi" },
      { idUsername: 8, username: "citra", fullName: "Citra S" },
    ]);
    expect(map.get(30)).toEqual([
      { idUsername: 7, username: "budi", fullName: "Budi" },
    ]);
  });

  it("returns an empty map when nothing is assigned in that blok", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [] });

    const map = await service.listAllowedUsersGroupedByLokasi("A", "SO.01");

    expect(map.size).toBe(0);
  });
});

describe("assignAccess", () => {
  it("requires stockOpnameNo", async () => {
    await expect(
      service.assignAccess({ blok: "A", idLokasi: 25, idUsername: 7 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("resolves with the assigned tuple", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const result = await service.assignAccess({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
      stockOpnameNo: "SO.01",
    });

    expect(result).toEqual({
      stockOpnameNo: "SO.01",
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
    });
  });

  it("throws a 409 error naming the user and listing existing lokasi when the max is reached", async () => {
    mQuery.mockResolvedValueOnce({
      recordset: [
        { Blok: "A", IdLokasi: 10, Username: "budi" },
        { Blok: "B", IdLokasi: 20, Username: "budi" },
      ],
    });

    await expect(
      service.assignAccess({
        blok: "C",
        idLokasi: 30,
        idUsername: 7,
        stockOpnameNo: "SO.01",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/budi.*A10, B20/),
    });
  });
});

describe("revokeAccess", () => {
  it("requires stockOpnameNo", async () => {
    await expect(
      service.revokeAccess({ blok: "A", idLokasi: 25, idUsername: 7 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("resolves when a row was deleted", async () => {
    mQuery.mockResolvedValueOnce({ rowsAffected: [1] });

    const result = await service.revokeAccess({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
      stockOpnameNo: "SO.01",
    });

    expect(result).toEqual({
      stockOpnameNo: "SO.01",
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
    });
  });

  it("throws a 404 error when nothing was deleted", async () => {
    mQuery.mockResolvedValueOnce({ rowsAffected: [0] });

    await expect(
      service.revokeAccess({
        blok: "A",
        idLokasi: 25,
        idUsername: 7,
        stockOpnameNo: "SO.01",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("revokeAccessByStockOpname", () => {
  it("deletes every assignment row for the given NoSO", async () => {
    mQuery.mockResolvedValueOnce({ rowsAffected: [3] });

    await service.revokeAccessByStockOpname("SO.01");

    const [querySql] = mQuery.mock.calls[0];
    expect(querySql).toMatch(/DELETE FROM \[dbo\]\.\[MstUserLokasiAccess\]/);
  });

  it("does nothing when stockOpnameNo is empty", async () => {
    await service.revokeAccessByStockOpname("");
    expect(mQuery).not.toHaveBeenCalled();
  });
});

describe("insertStockOpnameHasil", () => {
  const header = { NoSO: "SO.01", IdKategori: 1, IsComplete: false };
  const category = { KodeKategori: "washing" };
  const referenceRow = { NoWashing: "B.2601.0001", JmlhSak: 2, Berat: 10, Blok: "A", IdLokasi: 1 };

  it("throws a 403 error when the scanning user isn't assigned to the scanned lokasi", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [header] })
      .mockResolvedValueOnce({ recordset: [category] })
      .mockResolvedValueOnce({ recordset: [referenceRow] })
      .mockResolvedValueOnce({ recordset: [] }) // dupRes: belum pernah discan
      .mockResolvedValueOnce({ recordset: [] }); // isUserAllowedForLokasi: tidak ditugaskan

    await expect(
      service.insertStockOpnameHasil({
        stockOpnameNo: "SO.01",
        labelNo: "B.2601.0001",
        blok: "A",
        locationId: 1,
        ctx: { actorId: 99, actorUsername: "budi", requestId: "req-1" },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("skips the lokasi-access check when bypassLokasiCheck is true (admin)", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [header] })
      .mockResolvedValueOnce({ recordset: [category] })
      .mockResolvedValueOnce({ recordset: [referenceRow] })
      .mockResolvedValueOnce({ recordset: [] }) // dupRes
      .mockResolvedValueOnce({}); // INSERT

    const result = await service.insertStockOpnameHasil({
      stockOpnameNo: "SO.01",
      labelNo: "B.2601.0001",
      blok: "A",
      locationId: 1,
      ctx: { actorId: 99, actorUsername: "admin", requestId: "req-2", bypassLokasiCheck: true },
    });

    expect(result.labelNo).toBe("B.2601.0001");
    expect(mQuery).toHaveBeenCalledTimes(5);
  });

  it("includes who and where the label was already scanned in the duplicate error message, formatted from the UTC fields mssql maps SQL Server's local DATETIME into", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [header] })
      .mockResolvedValueOnce({ recordset: [category] })
      .mockResolvedValueOnce({ recordset: [referenceRow] })
      .mockResolvedValueOnce({
        recordset: [
          {
            Username: "siti",
            ScannedBlok: "A",
            ScannedIdLokasi: 1,
            // mssql (useUTC default true) maps SQL Server's naive local DATETIME
            // straight into the Date's UTC fields, not local ones.
            DateTimeScan: new Date(Date.UTC(2026, 0, 5, 10, 47, 9)),
          },
        ],
      });

    await expect(
      service.insertStockOpnameHasil({
        stockOpnameNo: "SO.01",
        labelNo: "B.2601.0001",
        ctx: { actorId: 99, actorUsername: "budi", requestId: "req-3" },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("siti di A/1 pada 05/01/2026 10:47:09"),
    });
  });
});

describe("deleteStockOpnameHasil", () => {
  const header = { NoSO: "SO.01", IdKategori: 1, IsComplete: false };
  const category = { KodeKategori: "washing" };

  it("deletes the hasil row for the given label", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [header] })
      .mockResolvedValueOnce({ recordset: [category] })
      .mockResolvedValueOnce({ rowsAffected: [1] });

    const result = await service.deleteStockOpnameHasil({
      stockOpnameNo: "SO.01",
      labelNo: "B.2601.0001",
    });

    expect(result).toEqual({
      stockOpnameNo: "SO.01",
      categoryCode: "washing",
      labelNo: "B.2601.0001",
    });
  });

  it("throws a 404 error when the label was never scanned", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [header] })
      .mockResolvedValueOnce({ recordset: [category] })
      .mockResolvedValueOnce({ rowsAffected: [0] });

    await expect(
      service.deleteStockOpnameHasil({
        stockOpnameNo: "SO.01",
        labelNo: "B.2601.0001",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws a 409 error when the stock opname is already complete", async () => {
    mQuery
      .mockResolvedValueOnce({ recordset: [{ ...header, IsComplete: true }] })
      .mockResolvedValueOnce({ recordset: [category] });

    await expect(
      service.deleteStockOpnameHasil({
        stockOpnameNo: "SO.01",
        labelNo: "B.2601.0001",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
