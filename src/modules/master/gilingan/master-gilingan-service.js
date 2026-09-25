const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      IdGilingan,
      NamaGilingan,
      SaldoAwal,
      Enable
    FROM [dbo].[MstGilingan]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaGilingan ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

// Stok sisa per jenis gilingan (MstGilingan), net dari GilinganPartial (label
// IsPartial=1 beratnya dikurangi total yang sudah dipakai sebagian, clamp ke
// 0) — sama seperti perhitungan di modules/label/gilingan (getAll /
// getByNoGilingan). Gilingan adalah tabel flat (satu baris = satu label),
// bukan header-detail sak seperti broker/mixer.
async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    WITH PartialSum AS (
      SELECT NoGilingan, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
      FROM dbo.GilinganPartial
      GROUP BY NoGilingan
    ),
    EffectiveDetail AS (
      SELECT
        g.NoGilingan,
        g.IdGilingan,
        g.DateCreate,
        g.Blok,
        g.IdLokasi,
        CASE
          WHEN ISNULL(g.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0) < 0 THEN 0
          ELSE ISNULL(g.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0)
        END AS BeratEfektif
      FROM dbo.Gilingan g
      LEFT JOIN PartialSum ps
        ON ps.NoGilingan = g.NoGilingan
      WHERE g.DateUsage IS NULL
    )
    SELECT
      m.IdGilingan,
      m.NamaGilingan,
      ISNULL(agg.LabelSisa, 0) AS LabelSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua,
      STUFF((
        SELECT DISTINCT ', ' + CONCAT(ed.Blok, CONVERT(VARCHAR(10), ed.IdLokasi))
        FROM EffectiveDetail ed
        WHERE ed.IdGilingan = m.IdGilingan
          AND ed.BeratEfektif > 0
          AND ISNULL(NULLIF(ed.Blok, ''), '') <> ''
        FOR XML PATH('')
      ), 1, 2, '') AS Lokasi
    FROM dbo.MstGilingan m
    LEFT JOIN (
      SELECT
        IdGilingan,
        SUM(CASE WHEN BeratEfektif > 0 THEN 1 ELSE 0 END) AS LabelSisa,
        SUM(BeratEfektif) AS BeratSisa,
        MIN(CASE WHEN BeratEfektif > 0 THEN DateCreate END) AS DateCreateTertua
      FROM EffectiveDetail
      GROUP BY IdGilingan
    ) agg
      ON agg.IdGilingan = m.IdGilingan
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.NamaGilingan ASC;
  `);

  return result.recordset.map((r) => ({
    IdGilingan: r.IdGilingan,
    NamaGilingan: r.NamaGilingan,
    LabelSisa: typeof r.LabelSisa === "number" ? r.LabelSisa : parseInt(r.LabelSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
    ...(r.Lokasi && r.Lokasi.trim() ? { Lokasi: r.Lokasi } : {}),
  }));
}

async function getLabelByIdGilingan(idGilingan) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdGilingan", sql.Int, idGilingan).query(`
      WITH PartialSum AS (
        SELECT NoGilingan, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
        FROM dbo.GilinganPartial
        GROUP BY NoGilingan
      ),
      EffectiveLabel AS (
        SELECT
          g.NoGilingan,
          g.DateCreate,
          CASE
            WHEN ISNULL(g.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0) < 0 THEN 0
            ELSE ISNULL(g.Berat, 0) - ISNULL(ps.TotalPartialBerat, 0)
          END AS Berat
        FROM dbo.Gilingan g
        LEFT JOIN PartialSum ps
          ON ps.NoGilingan = g.NoGilingan
        WHERE g.IdGilingan = @IdGilingan
          AND g.DateUsage IS NULL
      )
      SELECT
        NoGilingan,
        NoGilingan AS Label,
        DateCreate,
        Berat
      FROM EffectiveLabel
      WHERE Berat > 0
      ORDER BY DateCreate ASC, NoGilingan ASC;
    `);

  return result.recordset.map((r) => ({
    NoGilingan: r.NoGilingan,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    Berat: Number(
      (typeof r.Berat === "number" ? r.Berat : parseFloat(r.Berat) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdGilingan };
