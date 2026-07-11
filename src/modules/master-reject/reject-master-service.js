// src/modules/master/reject-master-service.js
const { sql, poolPromise } = require('../../core/config/db');

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      IdReject,
      NamaReject,
      SaldoAwal,
      Enable,
      TglSaldoAwal,
      ItemCode
    FROM [dbo].[MstReject]
    WHERE Enable = 1
    ORDER BY NamaReject ASC;
  `;

  // NOTE:
  // - Kalau connection default
  //   dan ingin paksa ke DB itu, ganti FROM menjadi:
  //   FROM [dbo].[MstReject]

  const result = await request.query(query);
  return result.recordset;
}

// Stok sisa per jenis reject (MstReject), net dari RejectV2Partial (label IsPartial=1
// beratnya dikurangi total yang sudah dipakai sebagian, clamp ke 0) — sama seperti
// perhitungan di modules/label/reject (getAll / getByNoReject). RejectV2 adalah tabel
// flat (satu baris = satu label), bukan header-detail sak seperti broker/mixer.
async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    WITH PartialSum AS (
      SELECT NoReject, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
      FROM dbo.RejectV2Partial
      GROUP BY NoReject
    ),
    EffectiveDetail AS (
      SELECT
        r.NoReject,
        r.IdReject,
        r.DateCreate,
        CASE
          WHEN ISNULL(r.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0) < 0 THEN 0
          ELSE ISNULL(r.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0)
        END AS BeratEfektif
      FROM dbo.RejectV2 r
      LEFT JOIN PartialSum ps
        ON ps.NoReject = r.NoReject
      WHERE r.DateUsage IS NULL
    )
    SELECT
      m.IdReject,
      m.NamaReject,
      ISNULL(agg.LabelSisa, 0) AS LabelSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstReject m
    LEFT JOIN (
      SELECT
        IdReject,
        SUM(CASE WHEN BeratEfektif > 0 THEN 1 ELSE 0 END) AS LabelSisa,
        SUM(BeratEfektif) AS BeratSisa,
        MIN(CASE WHEN BeratEfektif > 0 THEN DateCreate END) AS DateCreateTertua
      FROM EffectiveDetail
      GROUP BY IdReject
    ) agg
      ON agg.IdReject = m.IdReject
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.NamaReject ASC;
  `);

  return result.recordset.map((r) => ({
    IdReject: r.IdReject,
    NamaReject: r.NamaReject,
    LabelSisa: typeof r.LabelSisa === 'number' ? r.LabelSisa : parseInt(r.LabelSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === 'number' ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
  }));
}

async function getLabelByIdReject(idReject) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input('IdReject', sql.Int, idReject).query(`
      WITH PartialSum AS (
        SELECT NoReject, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
        FROM dbo.RejectV2Partial
        GROUP BY NoReject
      ),
      EffectiveLabel AS (
        SELECT
          r.NoReject,
          r.DateCreate,
          CASE
            WHEN ISNULL(r.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0) < 0 THEN 0
            ELSE ISNULL(r.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0)
          END AS Berat
        FROM dbo.RejectV2 r
        LEFT JOIN PartialSum ps
          ON ps.NoReject = r.NoReject
        WHERE r.IdReject = @IdReject
          AND r.DateUsage IS NULL
      )
      SELECT
        NoReject,
        NoReject AS Label,
        DateCreate,
        Berat
      FROM EffectiveLabel
      WHERE Berat > 0
      ORDER BY DateCreate ASC, NoReject ASC;
    `);

  return result.recordset.map((r) => ({
    NoReject: r.NoReject,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    Berat: Number(
      (typeof r.Berat === 'number' ? r.Berat : parseFloat(r.Berat) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdReject };
