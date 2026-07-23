jest.mock("../stock-opname-v2-service", () => ({
  isUserAllowedForLokasi: jest.fn(),
}));

// stock-opname-v2-routes.js meng-import attachPermissions, yang transitif
// meng-import get-user-permissions.js -> core/config/db. Tanpa mock ini,
// require() module tsb memicu koneksi mssql sungguhan saat file di-load,
// walau tidak pernah dipanggil di test (bocor jadi unhandled connection
// error setelah proses Jest selesai).
jest.mock("../../../core/config/db", () => ({
  sql: { Int: jest.fn(() => "Int"), VarChar: jest.fn(() => "VarChar") },
  poolPromise: Promise.resolve({ request: () => ({ input: () => ({ query: jest.fn() }) }) }),
}));

const { requireLokasiAccess } = require("../stock-opname-v2-routes");
const { isUserAllowedForLokasi } = require("../stock-opname-v2-service");

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  isUserAllowedForLokasi.mockReset();
});

it("bypasses the DB check for super admin (wildcard permission)", async () => {
  const req = {
    idUsername: 7,
    params: { stockOpnameNo: "SO.01", blok: "A", locationId: "25" },
    userPermissions: new Set(["*"]),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(isUserAllowedForLokasi).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

it("bypasses the DB check when the user has stockopname:create permission", async () => {
  const req = {
    idUsername: 7,
    params: { stockOpnameNo: "SO.01", blok: "A", locationId: "25" },
    userPermissions: new Set(["stockopname:create"]),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(isUserAllowedForLokasi).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

it("calls next when the user is assigned to the lokasi for that NoSO", async () => {
  isUserAllowedForLokasi.mockResolvedValueOnce(true);
  const req = {
    idUsername: 7,
    params: { stockOpnameNo: "SO.01", blok: "A", locationId: "25" },
    userPermissions: new Set(),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(isUserAllowedForLokasi).toHaveBeenCalledWith({
    blok: "A",
    idLokasi: 25,
    idUsername: 7,
    stockOpnameNo: "SO.01",
  });
  expect(next).toHaveBeenCalled();
});

it("returns 403 when the user is not assigned to the lokasi for that NoSO", async () => {
  isUserAllowedForLokasi.mockResolvedValueOnce(false);
  const req = {
    idUsername: 7,
    params: { stockOpnameNo: "SO.01", blok: "A", locationId: "25" },
    userPermissions: new Set(),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});
