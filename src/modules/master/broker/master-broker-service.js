const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      IdBroker,
      Nama,
      IdUOM,
      IdForm,
      PicPacking,
      PicContent,
      ItemCode,
      IsEnable,
      IsReject,
      IsDisableMinMax
    FROM [dbo].[MstBroker]
    WHERE ISNULL(IsEnable, 1) = 1
    ORDER BY Nama ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

// Stok sisa per jenis broker (MstBroker), net dari BrokerPartial (sak IsPartial=1
// beratnya dikurangi total yang sudah dipakai sebagian) — sama seperti perhitungan
// di modules/label/broker (getBrokerDetailByNoBroker).
async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    WITH EffectiveDetail AS (
      SELECT
        h.IdJenisPlastik,
        h.DateCreate,
        d.NoSak,
        CASE
          WHEN d.IsPartial = 1 THEN
            d.Berat - ISNULL((
              SELECT SUM(p.Berat)
              FROM dbo.BrokerPartial p
              WHERE p.NoBroker = d.NoBroker
                AND p.NoSak = d.NoSak
            ), 0)
          ELSE d.Berat
        END AS BeratEfektif
      FROM dbo.Broker_h h
      INNER JOIN dbo.Broker_d d
        ON d.NoBroker = h.NoBroker
      WHERE d.DateUsage IS NULL
    )
    SELECT
      m.IdBroker,
      m.Nama,
      ISNULL(agg.SakSisa, 0)   AS SakSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstBroker m
    LEFT JOIN (
      SELECT
        IdJenisPlastik,
        COUNT(NoSak) AS SakSisa,
        SUM(ISNULL(BeratEfektif, 0)) AS BeratSisa,
        MIN(DateCreate) AS DateCreateTertua
      FROM EffectiveDetail
      GROUP BY IdJenisPlastik
    ) agg
      ON agg.IdJenisPlastik = m.IdBroker
    WHERE ISNULL(m.IsEnable, 1) = 1
    ORDER BY m.Nama ASC;
  `);

  return result.recordset.map((r) => ({
    IdBroker: r.IdBroker,
    Nama: r.Nama,
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
  }));
}

async function getLabelByIdBroker(idBroker) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdJenisPlastik", sql.Int, idBroker).query(`
      WITH EffectiveDetail AS (
        SELECT
          h.NoBroker,
          h.DateCreate,
          d.NoSak,
          CASE
            WHEN d.IsPartial = 1 THEN
              d.Berat - ISNULL((
                SELECT SUM(p.Berat)
                FROM dbo.BrokerPartial p
                WHERE p.NoBroker = d.NoBroker
                  AND p.NoSak = d.NoSak
              ), 0)
            ELSE d.Berat
          END AS BeratEfektif
        FROM dbo.Broker_h h
        INNER JOIN dbo.Broker_d d
          ON d.NoBroker = h.NoBroker
        WHERE h.IdJenisPlastik = @IdJenisPlastik
          AND d.DateUsage IS NULL
      )
      SELECT
        NoBroker,
        NoBroker AS Label,
        DateCreate,
        COUNT(NoSak) AS SakSisa,
        SUM(ISNULL(BeratEfektif, 0)) AS BeratSisa
      FROM EffectiveDetail
      GROUP BY NoBroker, DateCreate
      ORDER BY DateCreate ASC, NoBroker ASC;
    `);

  return result.recordset.map((r) => ({
    NoBroker: r.NoBroker,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdBroker };
