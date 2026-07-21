jest.mock("../../../core/config/db", () => {
  const mQuery = jest.fn();
  const mInput = jest.fn();

  const MockRequest = jest.fn().mockImplementation(() => {
    const req = {
      input: (...args) => {
        mInput(...args);
        return req;
      },
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
    },
    poolPromise: Promise.resolve(mPool),
    __mocks: { mQuery, mInput, MockRequest, mPool },
  };
});

const service = require("../user-lokasi-access-service");
const db = require("../../../core/config/db");
const { mQuery } = db.__mocks;

beforeEach(() => {
  mQuery.mockReset();
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
  });
});

describe("isUserAllowedForLokasi", () => {
  it("returns true when a row is found", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [{ found: 1 }] });

    const allowed = await service.isUserAllowedForLokasi({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
    });

    expect(allowed).toBe(true);
  });

  it("returns false when no row is found", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [] });

    const allowed = await service.isUserAllowedForLokasi({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
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

    const map = await service.listAllowedUsersGroupedByLokasi("A");

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

    const map = await service.listAllowedUsersGroupedByLokasi("A");

    expect(map.size).toBe(0);
  });
});

describe("assignAccess", () => {
  it("resolves with the assigned tuple", async () => {
    mQuery.mockResolvedValueOnce({ recordset: [] });

    const result = await service.assignAccess({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
    });

    expect(result).toEqual({ blok: "A", idLokasi: 25, idUsername: 7 });
  });
});

describe("revokeAccess", () => {
  it("resolves when a row was deleted", async () => {
    mQuery.mockResolvedValueOnce({ rowsAffected: [1] });

    const result = await service.revokeAccess({
      blok: "A",
      idLokasi: 25,
      idUsername: 7,
    });

    expect(result).toEqual({ blok: "A", idLokasi: 25, idUsername: 7 });
  });

  it("throws a 404 error when nothing was deleted", async () => {
    mQuery.mockResolvedValueOnce({ rowsAffected: [0] });

    await expect(
      service.revokeAccess({ blok: "A", idLokasi: 25, idUsername: 7 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
