const sql = require('mssql');
const { poolPromise } = require('../../core/config/db');
const { badReq, notFound } = require('../../core/utils/http-error');

function parseDate(value, label) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badReq(`${label} wajib berformat YYYY-MM-DD`);
  }
  return raw;
}

function parseIntParam(value, label, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badReq(`${label} wajib diisi`);
  }
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw badReq(`${label} harus berupa angka`);
  return n;
}

function normalizeValue(value) {
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    const date = `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    const hh = p(value.getHours());
    const mm = p(value.getMinutes());
    const ss = p(value.getSeconds());
    if (hh === '00' && mm === '00' && ss === '00') return date;
    return `${date} ${hh}:${mm}:${ss}`;
  }
  if (value instanceof Buffer) return value.toString('hex');
  return value;
}

function toResult(result) {
  const recordset = result.recordset || [];
  const columnMap = result.recordset?.columns || {};
  const columnKeys = Object.keys(columnMap);
  const keys = columnKeys.length
    ? columnKeys
    : recordset.length
      ? Object.keys(recordset[0])
      : [];
  const columns = keys.map((key) => ({ key, label: key }));
  const rows = recordset.map((row) => {
    const out = {};
    for (const key of keys) out[key] = normalizeValue(row[key]);
    return out;
  });
  return { columns, rows, totalRows: rows.length };
}

async function runSp(spName, inputs) {
  const pool = await poolPromise;
  const request = pool.request();
  for (const input of inputs) {
    request.input(input.name, input.type, input.value);
  }
  const result = await request.execute(spName);
  return toResult(result);
}

async function runQuery(text, inputs = []) {
  const pool = await poolPromise;
  const request = pool.request();
  for (const input of inputs) {
    request.input(input.name, input.type, input.value);
  }
  const result = await request.query(text);
  return toResult(result);
}

async function getWarehouseOptions() {
  const result = await runQuery(`
    SELECT NamaWarehouse
    FROM [dbo].[MstWarehouse]
    WHERE Enable = 1
    ORDER BY NamaWarehouse ASC;
  `);
  const names = result.rows.map((row) => row.NamaWarehouse);
  return ['ALL', ...names];
}

async function stokBahanBaku({ tglAkhir, warehouse }) {
  const tanggal = parseDate(tglAkhir, 'Tanggal akhir');
  const wh = String(warehouse ?? 'ALL').trim() || 'ALL';
  return runSp('dbo.SP_LapStokBahanBakuV2', [
    { name: 'TglAkhir', type: sql.Date, value: tanggal },
    { name: 'Warehouse', type: sql.VarChar(100), value: wh },
  ]);
}

async function mutasiBahanBaku({ tglAwal, tglAkhir }) {
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runSp('dbo.SP_PPSLapMutasiBahanBaku', [
    { name: 'StartDate', type: sql.Date, value: start },
    { name: 'EndDate', type: sql.Date, value: end },
  ]);
}

const STOK_SP = {
  washing: 'dbo.SP_LapStokWashingV2',
  broker: 'dbo.SP_LapStokBrokerV2',
  bonggolan: 'dbo.SP_LapStokBonggolanV2',
  crusher: 'dbo.SP_LapStokCrusherV2',
  gilingan: 'dbo.SP_LapStokGilinganV2',
  mixer: 'dbo.SP_LapStokMixerV2',
  'furniture-wip': 'dbo.SP_LapStokFurnitureWIPV2',
  'barang-jadi': 'dbo.SP_LapStokBarangjadiV2',
};

async function stokUmum(jenis, { tglAkhir, warehouse }) {
  const sp = STOK_SP[jenis];
  if (!sp) throw notFound(`Laporan stok '${jenis}' tidak dikenal`);
  const tanggal = parseDate(tglAkhir, 'Tanggal akhir');
  const wh = String(warehouse ?? 'ALL').trim() || 'ALL';
  return runSp(sp, [
    { name: 'TglAkhir', type: sql.Date, value: tanggal },
    { name: 'Warehouse', type: sql.VarChar(100), value: wh },
  ]);
}

async function stokReject({ tglAkhir, warehouse }) {
  const tanggal = parseDate(tglAkhir, 'Tanggal akhir');
  const wh = String(warehouse ?? 'ALL').trim() || 'ALL';
  const value = wh === 'ALL' || wh === 'SEMUA' ? null : wh;
  return runSp('dbo.SP_LaporanStockLabelReject', [
    { name: 'TglAkhir', type: sql.Date, value: tanggal },
    { name: 'WarehouseName', type: sql.NVarChar(100), value },
  ]);
}

const MUTASI_SP = {
  washing: 'SP_PPSLapMutasiWashing',
  broker: 'SP_PPSLapMutasiBroker',
  crusher: 'SP_PPSLapMutasiCrusher',
  gilingan: 'SP_PPSLapMutasiGilingan',
  mixer: 'SP_PPSLapMutasiMixer',
  reject: 'SP_PPSLapMutasiReject',
  'furniture-wip': 'SP_PPSLapMutasiFurnitureWIP',
  'barang-jadi': 'SP_PPSLapMutasiBarangJadi',
};

async function mutasiUmum(jenis, { tglAwal, tglAkhir }) {
  const sp = MUTASI_SP[jenis];
  if (!sp) throw notFound(`Laporan mutasi '${jenis}' tidak dikenal`);
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runSp(sp, [
    { name: 'StartDate', type: sql.Date, value: start },
    { name: 'EndDate', type: sql.Date, value: end },
  ]);
}

const PENERIMAAN_QUERY = `
  DECLARE @TglAwal AS Date;
  DECLARE @TglAkhir AS Date;
  SET @TglAwal = @Awal;
  SET @TglAkhir = @Akhir;

  SELECT A.DateCreate, B.DateUsage, A.Jenis, A.NoBahanBaku, B.NoPallet, B.NoSak,
    B.Berat, A.NmSupplier, B.Keterangan, A.Moisture, A.MeltingIndex, A.Elasticity,
    A.IdStatus, A.MoistureSTD, A.MltIndxSTD, A.ElasticSTD
  FROM (
    SELECT A.DateCreate, C.Jenis, A.NoBahanBaku, D.NmSupplier, B.NoPallet,
      B.Moisture, B.MeltingIndex, B.Elasticity, B.IdStatus,
      C.Moisture AS MoistureSTD, C.MeltingIndex AS MltIndxSTD, C.Elasticity AS ElasticSTD
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    INNER JOIN [dbo].[MstSupplier] D ON D.IdSupplier = A.IdSupplier
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
  ) A
  LEFT JOIN (
    SELECT A.DateCreate, D.DateUsage, C.Jenis, A.NoBahanBaku, B.NoPallet,
      D.NoSak AS NoSak, D.Berat AS Berat, B.Keterangan
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    INNER JOIN [dbo].[BahanBaku_d] D ON D.NoBahanBaku = A.NoBahanBaku AND D.NoPallet = B.NoPallet
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
  ) B ON B.NoBahanBaku = A.NoBahanBaku AND B.NoPallet = A.NoPallet
  ORDER BY A.NoBahanBaku, A.NoPallet ASC;
`;

async function penerimaanBahanBaku({ tglAwal, tglAkhir }) {
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runQuery(PENERIMAAN_QUERY, [
    { name: 'Awal', type: sql.Date, value: start },
    { name: 'Akhir', type: sql.Date, value: end },
  ]);
}

const KARTU_STOK_QUERY = `
  SELECT A.DateCreate, A.Jenis, A.NoBahanBaku, A.JlmhPallet, B.JmlhSak,
    C.BeratBB, D.NmSupplier, E.Keterangan
  FROM (
    SELECT A.DateCreate, C.Jenis, A.NoBahanBaku, COUNT(B.NoPallet) AS JlmhPallet
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
    GROUP BY A.DateCreate, C.Jenis, A.NoBahanBaku
  ) A
  LEFT JOIN (
    SELECT A.DateCreate, C.Jenis, A.NoBahanBaku, COUNT(D.NoSak) AS JmlhSak
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    INNER JOIN [dbo].[BahanBaku_d] D ON D.NoBahanBaku = B.NoBahanBaku AND D.NoPallet = B.NoPallet
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
    GROUP BY A.DateCreate, C.Jenis, A.NoBahanBaku
  ) B ON B.DateCreate = A.DateCreate AND B.Jenis = A.Jenis AND B.NoBahanBaku = A.NoBahanBaku
  LEFT JOIN (
    SELECT A.DateCreate, C.Jenis, A.NoBahanBaku, SUM(D.Berat) AS BeratBB
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    INNER JOIN [dbo].[BahanBaku_d] D ON D.NoBahanBaku = B.NoBahanBaku AND D.NoPallet = B.NoPallet
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
    GROUP BY A.DateCreate, C.Jenis, A.NoBahanBaku
  ) C ON C.DateCreate = A.DateCreate AND C.Jenis = A.Jenis AND C.NoBahanBaku = A.NoBahanBaku
  LEFT JOIN (
    SELECT A.DateCreate, C.Jenis, A.NoBahanBaku, D.NmSupplier
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    INNER JOIN [dbo].[MstSupplier] D ON D.IdSupplier = A.IdSupplier
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
    GROUP BY A.DateCreate, C.Jenis, A.NoBahanBaku, D.NmSupplier
  ) D ON D.DateCreate = A.DateCreate AND D.Jenis = A.Jenis AND D.NoBahanBaku = A.NoBahanBaku
  LEFT JOIN (
    SELECT A.DateCreate, C.Jenis, A.NoBahanBaku, B.Keterangan
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBakuPallet_h] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[MstJenisPlastik] C ON C.IdJenisPlastik = B.IdJenisPlastik
    WHERE A.DateCreate >= @TglAwal AND A.DateCreate <= @TglAkhir
    GROUP BY A.DateCreate, C.Jenis, A.NoBahanBaku, B.Keterangan
  ) E ON E.DateCreate = A.DateCreate AND E.Jenis = A.Jenis AND E.NoBahanBaku = A.NoBahanBaku
  WHERE E.Keterangan IS NOT NULL
  GROUP BY A.DateCreate, A.Jenis, A.NoBahanBaku, A.JlmhPallet, B.JmlhSak,
    C.BeratBB, D.NmSupplier, E.Keterangan
  ORDER BY A.DateCreate ASC;
`;

async function kartuStokBahanBaku({ tglAwal, tglAkhir }) {
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runQuery(KARTU_STOK_QUERY, [
    { name: 'TglAwal', type: sql.Date, value: start },
    { name: 'TglAkhir', type: sql.Date, value: end },
  ]);
}

function umurQuery(periodeCount) {
  const joins = [];
  for (let i = 1; i <= periodeCount; i += 1) {
    const prev = i === 1 ? null : `@Umur${i - 1}`;
    const condition =
      i === 1
        ? `DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 <= @Umur1`
        : `DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 > ${prev} AND DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 <= @Umur${i}`;
    joins.push(`
  LEFT JOIN (
    SELECT Jenis, SUM(Berat) AS Periode${i}
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBaku_d] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[BahanBakuPallet_h] C ON C.NoBahanBaku = A.NoBahanBaku AND C.NoPallet = B.NoPallet
    INNER JOIN [dbo].[MstJenisPlastik] D ON D.IdJenisPlastik = C.IdJenisPlastik
    WHERE DateUsage IS NULL AND ${condition}
    GROUP BY Jenis
  ) P${i} ON P${i}.Jenis = A.Jenis`);
  }

  const selects = [];
  for (let i = 1; i <= periodeCount; i += 1) {
    selects.push(`P${i}.Periode${i}`);
  }

  return `
  SELECT A.Jenis, ${selects.join(', ')}
  FROM (
    SELECT Jenis
    FROM [dbo].[BahanBaku_h] A
    INNER JOIN [dbo].[BahanBaku_d] B ON B.NoBahanBaku = A.NoBahanBaku
    INNER JOIN [dbo].[BahanBakuPallet_h] C ON C.NoBahanBaku = A.NoBahanBaku AND C.NoPallet = B.NoPallet
    INNER JOIN [dbo].[MstJenisPlastik] D ON D.IdJenisPlastik = C.IdJenisPlastik
    WHERE DateUsage IS NULL
    GROUP BY Jenis
  ) A
  ${joins.join('\n')};
`;
}

async function umurBahanBaku(query) {
  const umur1 = parseIntParam(query.umur1, 'Umur 1', 30);
  const umur2 = parseIntParam(query.umur2, 'Umur 2', 60);
  const umur3 = parseIntParam(query.umur3, 'Umur 3', 90);
  const umur4 = parseIntParam(query.umur4, 'Umur 4', 120);
  const umur5 = parseIntParam(query.umur5, 'Umur 5', 150);
  return runQuery(umurQuery(5), [
    { name: 'Umur1', type: sql.Int, value: umur1 },
    { name: 'Umur2', type: sql.Int, value: umur2 },
    { name: 'Umur3', type: sql.Int, value: umur3 },
    { name: 'Umur4', type: sql.Int, value: umur4 },
    { name: 'Umur5', type: sql.Int, value: umur5 },
  ]);
}

const UMUR_KATEGORI = {
  washing: {
    header: 'Washing_h',
    detail: 'INNER JOIN Washing_d B ON B.NoWashing = A.NoWashing',
    master: 'INNER JOIN MstJenisPlastik D ON D.IdJenisPlastik = A.IdJenisPlastik',
    select: 'Jenis',
    groupBy: 'Jenis',
    key: 'Jenis',
  },
  broker: {
    header: 'Broker_h',
    detail: 'INNER JOIN Broker_d B ON B.NoBroker = A.NoBroker',
    master: 'INNER JOIN MstJenisPlastik D ON D.IdJenisPlastik = A.IdJenisPlastik',
    select: 'Jenis',
    groupBy: 'Jenis',
    key: 'Jenis',
  },
  mixer: {
    header: 'Mixer_h',
    detail: 'INNER JOIN Mixer_d B ON B.NoMixer = A.NoMixer',
    master: 'INNER JOIN MstMixer D ON D.IdMixer = A.IdMixer',
    select: 'Jenis',
    groupBy: 'Jenis',
    key: 'Jenis',
  },
  bonggolan: {
    header: 'Bonggolan',
    detail: '',
    master: 'INNER JOIN MstBonggolan B ON B.IdBonggolan = A.IdBonggolan',
    select: 'NamaBonggolan as Jenis',
    groupBy: 'NamaBonggolan',
    key: 'NamaBonggolan',
  },
  crusher: {
    header: 'Crusher',
    detail: '',
    master: 'INNER JOIN MstCrusher B ON B.IdCrusher = A.IdCrusher',
    select: 'NamaCrusher as Jenis',
    groupBy: 'NamaCrusher',
    key: 'NamaCrusher',
  },
  gilingan: {
    header: 'Gilingan',
    detail: '',
    master: 'INNER JOIN MstGilingan B ON B.IdGilingan = A.IdGilingan',
    select: 'NamaGilingan as Jenis',
    groupBy: 'NamaGilingan',
    key: 'NamaGilingan',
  },
};

function umurKategoriQuery(cfg) {
  const from = `${cfg.header} A ${cfg.detail} ${cfg.master}`;
  const base = `SELECT ${cfg.select} FROM ${from} WHERE DateUsage IS NULL GROUP BY ${cfg.groupBy}`;
  const joins = [];
  const selects = [];
  for (let i = 1; i <= 6; i += 1) {
    let cond;
    if (i === 1) {
      cond = 'DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 <= @Umur1';
    } else if (i === 6) {
      cond = 'DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 > @Umur5';
    } else {
      cond = `DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 > @Umur${i - 1} AND DATEDIFF(DAY, A.DateCreate, GETDATE()) + 1 <= @Umur${i}`;
    }
    joins.push(`LEFT JOIN (
    SELECT ${cfg.groupBy}, SUM(Berat) AS Periode${i} FROM ${from}
    WHERE DateUsage IS NULL AND ${cond}
    GROUP BY ${cfg.groupBy}
  ) T${i} ON T${i}.${cfg.key} = A.Jenis`);
    selects.push(`T${i}.Periode${i}`);
  }
  return `SELECT A.Jenis, ${selects.join(', ')} FROM (
  ${base}
) A
  ${joins.join('\n')};`;
}

async function umurKategori(jenis, query) {
  const cfg = UMUR_KATEGORI[jenis];
  if (!cfg) throw notFound(`Laporan umur '${jenis}' tidak dikenal`);
  const inputs = [];
  for (let i = 1; i <= 5; i += 1) {
    inputs.push({ name: `Umur${i}`, type: sql.Int, value: parseIntParam(query[`umur${i}`], `Umur ${i}`, i * 30) });
  }
  return runQuery(umurKategoriQuery(cfg), inputs);
}

const PRODUKSI_QUERIES = {
  washing: `
    Select A.NoProduksi, (B.Jenis) As NmBahanMasuk, (C.Jenis) As NmBahanHasil, A.TglProduksi,
      (B.NmSupplier) As Supplier, D.NamaMesin, B.[Input], C.[Output]
    From
    (Select NoProduksi, IdOperator, IdMesin, TglProduksi From WashingProduksi_h) A
    Left Join (Select A.NoProduksi, E.Jenis, F.NmSupplier, Sum(D.Berat) As Input
      From WashingProduksiInput A
      Inner Join BahanBaku_h B On B.NoBahanBaku = A.NoBahanBaku
      Inner Join BahanBakuPallet_h C On C.NoBahanBaku = B.NoBahanBaku
      Inner Join BahanBaku_d D On D.NoBahanBaku = C.NoBahanBaku And D.NoPallet = C.NoPallet
      Inner Join MstJenisPlastik E On E.IdJenisPlastik = C.IdJenisPlastik
      Inner Join MstSupplier F On F.IdSupplier = B.IdSupplier
      Group By A.NoProduksi, E.Jenis, F.NmSupplier
    ) B On B.NoProduksi = A.NoProduksi
    Left Join (Select A.NoProduksi, C.Jenis, Sum(D.Berat) As Output
      From WashingProduksiOutput A
      Inner Join Washing_h B On B.NoWashing = A.NoWashing
      Inner Join MstJenisPlastik C On C.IdJenisPlastik = B.IdJenisPlastik
      Inner Join Washing_d D On D.NoWashing = B.NoWashing
      Group By A.NoProduksi, C.Jenis
    ) C On C.NoProduksi = A.NoProduksi
    Inner Join MstMesin D On D.IdMesin = A.IdMesin
    Where A.TglProduksi >= @TglAwal And A.TglProduksi <= @TglAkhir
    Group By A.NoProduksi, B.Jenis, C.Jenis, A.TglProduksi, B.NmSupplier, D.NamaMesin,
      B.[Input], C.[Output]
    Order By A.NoProduksi Asc;
  `,
  broker: `
    Select C.NoProduksi, B.DateCreate, G.NamaMesin, F.NamaOperator, D.Jam, D.Shift,
      E.Jenis, Sum(A.Berat) As Berat
    From Broker_d A
    Inner Join Broker_h B On B.NoBroker = A.NoBroker
    Inner Join BrokerProduksiOutput C On C.NoBroker = A.NoBroker And C.NoSak = A.NoSak
    Inner Join BrokerProduksi_h D On D.NoProduksi = C.NoProduksi
    Inner Join MstJenisPlastik E On E.IdJenisPlastik = B.IdJenisPlastik
    Inner Join MstOperator F On F.IdOperator = D.IdOperator
    Inner Join MstMesin G On G.IdMesin = D.IdMesin
    Where B.DateCreate >= @TglAwal And B.DateCreate <= @TglAkhir
    Group By C.NoProduksi, B.DateCreate, G.NamaMesin, F.NamaOperator, D.Jam, D.Shift, E.Jenis;
  `,
  crusher: `
    Select A.NoCrusherProduksi, A.Tanggal, E.NamaMesin, F.NamaOperator, A.Jam, A.Shift,
      Sum(C.Berat) As Berat, D.NamaCrusher
    From CrusherProduksi_h A
    Inner Join CrusherProduksiOutput B On B.NoCrusherProduksi = A.NoCrusherProduksi
    Inner Join Crusher C On C.NoCrusher = B.NoCrusher
    Inner Join MstCrusher D On D.IdCrusher = C.IdCrusher
    Inner Join MstMesin E On E.IdMesin = A.IdMesin
    Inner Join MstOperator F On F.IdOperator = A.IdOperator
    Where A.Tanggal >= @TglAwal And A.Tanggal <= @TglAkhir
    Group By A.NoCrusherProduksi, A.Tanggal, E.NamaMesin, F.NamaOperator, A.Jam, A.Shift, D.NamaCrusher;
  `,
  gilingan: `
    Select A.NoProduksi, A.Tanggal, D.NamaMesin, E.NamaOperator, A.Jam,
      A.Shift, F.NamaGilingan, C.Berat
    From GilinganProduksi_h A
    Inner Join GilinganProduksiOutput B On B.NoProduksi = A.NoProduksi
    Inner Join Gilingan C On C.NoGilingan = B.NoGilingan
    Inner Join MstMesin D On D.IdMesin = A.IdMesin
    Inner Join MstOperator E On E.IdOperator = A.IdOperator
    Inner Join MstGilingan F On F.IdGilingan = C.IdGilingan
    Where A.Tanggal >= @TglAwal And A.Tanggal <= @TglAkhir;
  `,
  mixer: `
    Select A.NoProduksi, A.TglProduksi, E.NamaMesin, D.NamaOperator, G.Jenis, A.Shift,
      Sum(C.Berat) As Berat
    From MixerProduksi_h A
    Inner Join MixerProduksiOutput B On B.NoProduksi = A.NoProduksi
    Inner Join Mixer_d C On C.NoMixer = B.NoMixer And C.NoSak = B.NoSak
    Inner Join Mixer_h F On F.NoMixer = B.NoMixer
    Inner Join MstOperator D On D.IdOperator = A.IdOperator
    Inner Join MstMesin E On E.IdMesin = A.IdMesin
    Inner Join MstMixer G On G.IdMixer = F.IdMixer
    Where A.TglProduksi >= @TglAwal And A.TglProduksi <= @TglAkhir
    Group By A.NoProduksi, A.TglProduksi, E.NamaMesin, D.NamaOperator, G.Jenis, A.Shift
    Order By A.NoProduksi Asc;
  `,
};

async function produksiKategori(jenis, { tglAwal, tglAkhir }) {
  const text = PRODUKSI_QUERIES[jenis];
  if (!text) throw notFound(`Laporan produksi '${jenis}' tidak dikenal`);
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runQuery(text, [
    { name: 'TglAwal', type: sql.Date, value: start },
    { name: 'TglAkhir', type: sql.Date, value: end },
  ]);
}

const REKAP_SP = {
  washing: 'SP_LapRekapProduksiWashing',
  broker: 'SP_LapRekapProduksiBroker',
  crusher: 'SP_LapRekapProduksiCrusher',
  gilingan: 'SP_LapRekapProduksiGilingan',
  mixer: 'SP_LapRekapProduksiMixer',
  'inject-bj': 'SP_LapRekapProduksiInject_BJ',
  'inject-fwip': 'SP_LapRekapProduksiInject_FWIP',
  packing: 'SP_LapRekapProduksiPacking_BJ',
  'hot-stamping': 'SP_LapRekapProduksiHotStamping_FWIP',
  'pasang-kunci': 'SP_LapRekapProduksiPKunci_FWIP',
  spanner: 'SP_LapRekapProduksiSpanner_FWIP',
};

async function rekapProduksi(jenis, { tglAkhir }) {
  const sp = REKAP_SP[jenis];
  if (!sp) throw notFound(`Laporan rekap '${jenis}' tidak dikenal`);
  const tanggal = parseDate(tglAkhir, 'Tanggal');
  return runSp(sp, [{ name: 'PerTgl', type: sql.Date, value: tanggal }]);
}

async function semuaLabel() {
  return runSp('SP_LaporanSemuaLabel', []);
}

async function dashboardProduktifitas({ tglAkhir }) {
  const tanggal = parseDate(tglAkhir, 'Tanggal');
  return runSp('sp_LapDashboardProduktifitas', [{ name: 'Tanggal', type: sql.Date, value: tanggal }]);
}

async function hasilProduksi({ tglAwal, tglAkhir }) {
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runSp('SP_LaporanHasilProduksi', [
    { name: 'TglAwal', type: sql.Date, value: start },
    { name: 'TglAkhir', type: sql.Date, value: end },
  ]);
}

const PRODUKTIVITAS_SP = {
  washing: { sp: 'SP_LapProduktivitasWashing', start: 'StartDate', end: 'EndDate' },
  broker: { sp: 'SP_LapProduktivitasBroker', start: 'StartDate', end: 'EndDate' },
};

async function produktivitas(jenis, { tglAwal, tglAkhir }) {
  const cfg = PRODUKTIVITAS_SP[jenis];
  if (!cfg) throw notFound(`Laporan produktivitas '${jenis}' tidak dikenal`);
  const start = parseDate(tglAwal, 'Tanggal awal');
  const end = parseDate(tglAkhir, 'Tanggal akhir');
  return runSp(cfg.sp, [
    { name: cfg.start, type: sql.Date, value: start },
    { name: cfg.end, type: sql.Date, value: end },
  ]);
}

async function rekapHarian({ jenis, tglAkhir }) {
  const key = String(jenis ?? '').trim();
  if (!REKAP_SP[key]) throw notFound(`Laporan rekap '${key}' tidak dikenal`);
  return rekapProduksi(key, { tglAkhir });
}

module.exports = {
  getWarehouseOptions,
  stokBahanBaku,
  mutasiBahanBaku,
  penerimaanBahanBaku,
  kartuStokBahanBaku,
  umurBahanBaku,
  stokUmum,
  stokReject,
  mutasiUmum,
  umurKategori,
  produksiKategori,
  rekapProduksi,
  semuaLabel,
  dashboardProduktifitas,
  hasilProduksi,
  produktivitas,
  rekapHarian,
};
