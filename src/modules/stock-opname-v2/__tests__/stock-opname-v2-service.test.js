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
