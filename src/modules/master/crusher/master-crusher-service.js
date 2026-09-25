const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      IdCrusher,
      NamaCrusher,
      Enable,
      ItemCode
    FROM [dbo].[MstCrusher]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaCrusher ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT
      m.IdCrusher,
      m.NamaCrusher,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua,
      STUFF((
        SELECT DISTINCT ', ' + CONCAT(lc.Blok, CONVERT(VARCHAR(10), lc.IdLokasi))
        FROM dbo.Crusher lc
        WHERE lc.IdCrusher = m.IdCrusher
          AND lc.DateUsage IS NULL
          AND ISNULL(NULLIF(lc.Blok, ''), '') <> ''
        FOR XML PATH('')
      ), 1, 2, '') AS Lokasi
    FROM dbo.MstCrusher m
    LEFT JOIN (
      SELECT
        c.IdCrusher,
        SUM(ISNULL(c.Berat, 0)) AS BeratSisa,
        MIN(c.DateCreate) AS DateCreateTertua
      FROM dbo.Crusher c
      WHERE c.DateUsage IS NULL
      GROUP BY c.IdCrusher
    ) agg
      ON agg.IdCrusher = m.IdCrusher
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.NamaCrusher ASC;
  `);

  return result.recordset.map((r) => ({
    IdCrusher: r.IdCrusher,
    NamaCrusher: r.NamaCrusher,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
    ...(r.Lokasi && r.Lokasi.trim() ? { Lokasi: r.Lokasi } : {}),
  }));
}

async function getLabelByIdCrusher(idCrusher) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdCrusher", sql.Int, idCrusher).query(`
      SELECT
        c.NoCrusher,
        c.NoCrusher AS Label,
        c.DateCreate,
        ISNULL(c.Berat, 0) AS BeratSisa
      FROM dbo.Crusher c
      WHERE c.IdCrusher = @IdCrusher
        AND c.DateUsage IS NULL
      ORDER BY c.DateCreate ASC, c.NoCrusher ASC;
    `);

  return result.recordset.map((r) => ({
    NoCrusher: r.NoCrusher,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdCrusher };
