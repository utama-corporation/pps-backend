const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      IdBonggolan,
      NamaBonggolan,
      Enable,
      ItemCode
    FROM [dbo].[MstBonggolan]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY NamaBonggolan ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT
      m.IdBonggolan,
      m.NamaBonggolan,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstBonggolan m
    LEFT JOIN (
      SELECT
        b.IdBonggolan,
        SUM(ISNULL(b.Berat, 0)) AS BeratSisa,
        MIN(b.DateCreate) AS DateCreateTertua
      FROM dbo.Bonggolan b
      WHERE b.DateUsage IS NULL
      GROUP BY b.IdBonggolan
    ) agg
      ON agg.IdBonggolan = m.IdBonggolan
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.NamaBonggolan ASC;
  `);

  return result.recordset.map((r) => ({
    IdBonggolan: r.IdBonggolan,
    NamaBonggolan: r.NamaBonggolan,
    BeratSisa: Number(
<<<<<<< HEAD
      (typeof r.BeratSisa === "number"
        ? r.BeratSisa
        : parseFloat(r.BeratSisa) || 0
      ).toFixed(2),
=======
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
>>>>>>> develop
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
  }));
}

async function getLabelByIdBonggolan(idBonggolan) {
  const pool = await poolPromise;

<<<<<<< HEAD
  const result = await pool.request().input("IdBonggolan", sql.Int, idBonggolan)
    .query(`
=======
  const result = await pool
    .request()
    .input("IdBonggolan", sql.Int, idBonggolan).query(`
>>>>>>> develop
      SELECT
        b.NoBonggolan,
        b.NoBonggolan AS Label,
        b.DateCreate,
        ISNULL(b.Berat, 0) AS BeratSisa
      FROM dbo.Bonggolan b
      WHERE b.IdBonggolan = @IdBonggolan
        AND b.DateUsage IS NULL
      ORDER BY b.DateCreate ASC, b.NoBonggolan ASC;
    `);

  return result.recordset.map((r) => ({
    NoBonggolan: r.NoBonggolan,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    BeratSisa: Number(
<<<<<<< HEAD
      (typeof r.BeratSisa === "number"
        ? r.BeratSisa
        : parseFloat(r.BeratSisa) || 0
      ).toFixed(2),
=======
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
>>>>>>> develop
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdBonggolan };
