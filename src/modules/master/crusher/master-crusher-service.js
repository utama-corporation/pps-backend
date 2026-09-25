const { sql, poolPromise } = require("../../../core/config/db");
const { attachLokasiToStok } = require("../../../core/shared/stok-lokasi.helper");

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
      agg.DateCreateTertua
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

  const items = result.recordset.map((r) => ({
    IdCrusher: r.IdCrusher,
    NamaCrusher: r.NamaCrusher,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    DateCreateTertua: r.DateCreateTertua,
  }));

  return attachLokasiToStok(items, {
    sql: `
      SELECT
        c.IdCrusher AS IdKey,
        c.Blok,
        c.IdLokasi
      FROM dbo.Crusher c
      WHERE c.DateUsage IS NULL
        AND ISNULL(NULLIF(c.Blok, ''), '') <> ''
      GROUP BY c.IdCrusher, c.Blok, c.IdLokasi;
    `,
    idOf: (r) => r.IdCrusher,
  });
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
        c.Blok,
        c.IdLokasi,
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
    ...(r.Blok && r.Blok.trim()
      ? { Lokasi: `${r.Blok}${r.IdLokasi ?? ""}` }
      : {}),
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdCrusher };
