// src/modules/label/mixer/__tests__/mixer-service-blok-qc.test.js
// Regression test: penginputan QC (yang tidak mengirim field Blok) TIDAK BOLEH
// mengosongkan kolom Blok pada header label mixer.
//
// Bug lama: mixer-service memakai `header.Blok ?? null` pada dynamic UPDATE.
// Karena `?? null` mengubah `undefined` (tidak dikirim) menjadi NULL, kolom
// Blok ikut ter-update NULL setiap kali QC diinput. Akibatnya label hilang
// dari screen Mapping–Layout dan riwayat perpindahan lokasi di dbo.AuditTrail
// mencatat "blok dihapus" (contoh: H.0000029581).

// ====== MOCK DB CONFIG (core/config/db) ======================================
jest.mock('../../../../core/config/db', () => {
  const mBegin = jest.fn();
  const mCommit = jest.fn();
  const mRollback = jest.fn();

  const MockTransaction = jest.fn().mockImplementation(() => ({
    begin: mBegin,
    commit: mCommit,
    rollback: mRollback,
  }));

  const makeType = (name) => jest.fn(() => name);

  return {
    sql: {
      VarChar: makeType('VarChar'),
      NVarChar: makeType('NVarChar'),
      Int: makeType('Int'),
      Decimal: makeType('Decimal'),
      Date: makeType('Date'),
      DateTime: makeType('DateTime'),
      Bit: makeType('Bit'),
      MAX: 'MAX',
      ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
      Request: jest.fn(),
      Transaction: MockTransaction,
    },
    poolPromise: Promise.resolve({ request: () => ({}) }),
    __mocks: { mBegin, mCommit, mRollback },
  };
});

// ====== MOCK GUARD TUTUP TRANSAKSI ===========================================
jest.mock('../../../../core/shared/tutup-transaksi-guard', () => {
  const actual = jest.requireActual(
    '../../../../core/shared/tutup-transaksi-guard',
  );
  return {
    ...actual,
    assertNotLocked: jest.fn(async () => true),
  };
});

// ====== MOCK REPOSITORY MIXER ================================================
jest.mock('../repositories/mixer-read.repository', () => ({
  getMixerHeaderForUpdate: jest.fn(async () => ({
    NoMixer: 'H.0000029581',
    DateCreate: new Date('2026-10-16T00:00:00Z'),
  })),
  isMixerFromBongkarSusun: jest.fn(async () => false),
}));

jest.mock('../repositories/mixer-write.repository', () => ({
  setAuditContext: jest.fn(async () => {}),
  updateMixerHeaderDynamic: jest.fn(async () => {}),
  deleteActiveDetails: jest.fn(async () => 0),
  insertMixerDetailsBulk: jest.fn(async () => 0),
  clearOutputsByNoMixer: jest.fn(async () => {}),
}));

const service = require('../mixer-service');
const writeRepo = require('../repositories/mixer-write.repository');
const { __mocks } = require('../../../../core/config/db');
const { mCommit, mRollback } = __mocks;

const NO_MIXER = 'H.0000029581';

function lastSetParts() {
  const calls = writeRepo.updateMixerHeaderDynamic.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

function setColumns() {
  const call = lastSetParts();
  if (!call) return [];
  return call.setParts.map((p) => p.split('=')[0].trim());
}

describe('updateMixerCascade — Blok tidak boleh terhapus saat input QC', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('payload QC tanpa Blok TIDAK menyertakan Blok di statement UPDATE', async () => {
    await service.updateMixerCascade({
      NoMixer: NO_MIXER,
      actorId: 1,
      requestId: 'req-qc-1',
      header: {
        Moisture: 0.26,
        MaxMeltTemp: 230,
        MinMeltTemp: 220,
        MFI: 22.56,
        Moisture2: 0.23,
        Moisture3: 0.36,
      },
    });

    expect(mCommit).toHaveBeenCalled();
    const cols = setColumns();
    expect(cols).toContain('Moisture');
    expect(cols).toContain('MFI');
    expect(cols).not.toContain('Blok');
    expect(cols).not.toContain('IdLokasi');
  });

  test('payload QC tanpa field QC lain tidak menghapus nilai lama (tidak ada kolom QC kosong)', async () => {
    await service.updateMixerCascade({
      NoMixer: NO_MIXER,
      actorId: 1,
      requestId: 'req-qc-2',
      header: { Moisture: 0.3 },
    });

    const cols = setColumns();
    expect(cols).toContain('Moisture');
    expect(cols).not.toContain('MFI');
    expect(cols).not.toContain('MaxMeltTemp');
    expect(cols).not.toContain('MinMeltTemp');
    expect(cols).not.toContain('Moisture2');
    expect(cols).not.toContain('Moisture3');
    expect(cols).not.toContain('Blok');
  });

  test('Blok eksplisit NULL tetap dikosongkan (bila memang sengaja dikosongkan)', async () => {
    await service.updateMixerCascade({
      NoMixer: NO_MIXER,
      actorId: 1,
      requestId: 'req-qc-3',
      header: { Blok: null },
    });

    const call = lastSetParts();
    expect(call.setParts.join(', ')).toContain('Blok = @Blok');
    const blokBind = call.bind.find((b) => b.name === 'Blok');
    expect(blokBind.value).toBeNull();
  });

  test('Blok yang dikirim (mapping) tetap ditulis', async () => {
    await service.updateMixerCascade({
      NoMixer: NO_MIXER,
      actorId: 1,
      requestId: 'req-map-1',
      header: { Blok: 'LDN', IdLokasi: 1 },
    });

    const call = lastSetParts();
    expect(call.setParts.join(', ')).toContain('Blok = @Blok');
    expect(call.setParts.join(', ')).toContain('IdLokasi = @IdLokasi');
    const blokBind = call.bind.find((b) => b.name === 'Blok');
    expect(blokBind.value).toBe('LDN');
  });
});
