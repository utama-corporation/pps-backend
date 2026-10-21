// src/modules/label/broker/__tests__/broker-service-qc-bongkar-susun.test.js
// Penginputan QC untuk label broker yang berasal dari Bongkar Susun.

// ====== MOCK DB CONFIG (core/config/db) ======================================
jest.mock('../../../../core/config/db', () => {
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

  const mBegin = jest.fn();
  const mCommit = jest.fn();
  const mRollback = jest.fn();

  const MockTransaction = jest.fn().mockImplementation(() => ({
    begin: mBegin,
    commit: mCommit,
    rollback: mRollback,
  }));

  const makeType = (name) => jest.fn(() => name);

  const mPool = {
    request: () => new MockRequest(),
  };

  return {
    sql: {
      VarChar: makeType('VarChar'),
      NVarChar: makeType('NVarChar'),
      Int: makeType('Int'),
      Decimal: makeType('Decimal'),
      Date: makeType('Date'),
      Bit: makeType('Bit'),
      MAX: 'MAX',
      ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
      Request: MockRequest,
      Transaction: MockTransaction,
    },
    poolPromise: Promise.resolve(mPool),
    __mocks: { mQuery, mInput, MockRequest, MockTransaction, mBegin, mCommit, mRollback },
  };
});

// ====== MOCK GUARD TUTUP TRANSAKSI ===========================================
jest.mock('../../../../core/shared/tutup-transaksi-guard', () => {
  const actual = jest.requireActual('../../../../core/shared/tutup-transaksi-guard');
  return {
    ...actual,
    assertNotLocked: jest.fn(async () => true),
  };
});

const service = require('../broker-service');
const db = require('../../../../core/config/db');
const { __mocks } = db;
const { mQuery, mCommit, mRollback } = __mocks;
const { assertNotLocked } = require('../../../../core/shared/tutup-transaksi-guard');

const NO_BROKER = 'D.0000020633';

function setupMock({ fromBongkarSusun }) {
  mQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('sp_set_session_context')) return { recordset: [] };
    if (sql.includes('FROM dbo.Broker_h WITH (UPDLOCK, HOLDLOCK)')) {
      return {
        recordset: [
          {
            NoBroker: NO_BROKER,
            DateCreate: new Date('2026-10-21T00:00:00Z'),
          },
        ],
      };
    }
    if (sql.includes('FROM dbo.BongkarSusunOutputBroker')) {
      return { recordset: fromBongkarSusun ? [{ '1': 1 }] : [] };
    }
    return { recordset: [] };
  });
}

function findUpdateSql() {
  const call = mQuery.mock.calls.find(([text]) =>
    String(text).includes('UPDATE dbo.Broker_h'),
  );
  return call ? String(call[0]) : null;
}

describe('updateBrokerCascade — QC label dari Bongkar Susun', () => {
  beforeEach(() => {
    mQuery.mockReset();
    mCommit.mockReset();
    mRollback.mockReset();
    assertNotLocked.mockClear();
  });

  test('QC-only pada label BS berhasil (Density/Moisture/MFI)', async () => {
    setupMock({ fromBongkarSusun: true });

    const result = await service.updateBrokerCascade({
      NoBroker: NO_BROKER,
      actorId: 1,
      requestId: 'req-1',
      header: {
        Density: 0.8,
        Density2: 0.81,
        Density3: 0.82,
        Moisture: 0.2,
        MFI: 25.5,
      },
    });

    expect(result.header.NoBroker).toBe(NO_BROKER);
    expect(mCommit).toHaveBeenCalled();
    const updateSql = findUpdateSql();
    expect(updateSql).toContain('UPDATE dbo.Broker_h');
    expect(updateSql).toContain('Density');
    expect(updateSql).toContain('MFI');
  });

  test('QC + perubahan status (IdStatus) pada label BS berhasil', async () => {
    setupMock({ fromBongkarSusun: true });

    await service.updateBrokerCascade({
      NoBroker: NO_BROKER,
      actorId: 1,
      requestId: 'req-2',
      header: { Density: 0.8, Moisture: 0.2, IdStatus: 1 },
    });

    expect(mCommit).toHaveBeenCalled();
    expect(findUpdateSql()).toContain('IdStatus');
  });

  test('QC label BS divalidasi ke periode saat QC (DateQc), bukan DateCreate label', async () => {
    setupMock({ fromBongkarSusun: true });

    await service.updateBrokerCascade({
      NoBroker: NO_BROKER,
      actorId: 1,
      requestId: 'req-3',
      header: { Density: 0.8, DateQc: '2026-10-21' },
    });

    expect(assertNotLocked).toHaveBeenCalled();
    expect(assertNotLocked.mock.calls[0][0].action).toBe(
      `update QC broker ${NO_BROKER}`,
    );
    expect(assertNotLocked.mock.calls[0][0].date).toEqual(
      new Date('2026-10-21T00:00:00Z'),
    );
  });

  test('perubahan data label (bukan QC) pada label BS tetap ditolak 409', async () => {
    setupMock({ fromBongkarSusun: true });

    await expect(
      service.updateBrokerCascade({
        NoBroker: NO_BROKER,
        actorId: 1,
        requestId: 'req-4',
        header: { IdJenisPlastik: 99 },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mCommit).not.toHaveBeenCalled();
    expect(mRollback).toHaveBeenCalled();
  });

  test('perubahan detail sak pada label BS tetap ditolak 409', async () => {
    setupMock({ fromBongkarSusun: true });

    await expect(
      service.updateBrokerCascade({
        NoBroker: NO_BROKER,
        actorId: 1,
        requestId: 'req-5',
        header: { Density: 0.8 },
        details: [{ NoSak: 1, Berat: 15 }],
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mCommit).not.toHaveBeenCalled();
  });

  test('label broker biasa (bukan BS) tetap bisa diupdate penuh', async () => {
    setupMock({ fromBongkarSusun: false });

    await service.updateBrokerCascade({
      NoBroker: NO_BROKER,
      actorId: 1,
      requestId: 'req-6',
      header: { IdJenisPlastik: 99 },
    });

    expect(mCommit).toHaveBeenCalled();
    expect(findUpdateSql()).toContain('IdJenisPlastik');
  });
});
