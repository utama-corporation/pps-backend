jest.mock("../user-lokasi-access-service", () => ({
  isUserAllowedForLokasi: jest.fn(),
}));

const requireLokasiAccess = require("../user-lokasi-access-middleware");
const { isUserAllowedForLokasi } = require("../user-lokasi-access-service");

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
    params: { blok: "A", locationId: "25" },
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
    params: { blok: "A", locationId: "25" },
    userPermissions: new Set(["stockopname:create"]),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(isUserAllowedForLokasi).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
});

it("calls next when the user is assigned to the lokasi", async () => {
  isUserAllowedForLokasi.mockResolvedValueOnce(true);
  const req = {
    idUsername: 7,
    params: { blok: "A", locationId: "25" },
    userPermissions: new Set(),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(isUserAllowedForLokasi).toHaveBeenCalledWith({
    blok: "A",
    idLokasi: 25,
    idUsername: 7,
  });
  expect(next).toHaveBeenCalled();
});

it("returns 403 when the user is not assigned to the lokasi", async () => {
  isUserAllowedForLokasi.mockResolvedValueOnce(false);
  const req = {
    idUsername: 7,
    params: { blok: "A", locationId: "25" },
    userPermissions: new Set(),
  };
  const res = makeRes();
  const next = jest.fn();

  await requireLokasiAccess(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});
