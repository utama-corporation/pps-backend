const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      IdWashing,
      Nama,
      IdUOM,
      IdForm,
      PicPacking,
      PicContent,
      ItemCode,
      IsEnable,
      IsReject,
      IsDisableMinMax
    FROM [dbo].[MstWashing]
    WHERE ISNULL(IsEnable, 1) = 1
    ORDER BY Nama ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT
      m.IdWashing,
      m.Nama,
      ISNULL(agg.SakSisa, 0)   AS SakSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstWashing m
    LEFT JOIN (
      SELECT
        h.IdJenisPlastik,
        COUNT(d.NoSak) AS SakSisa,
        SUM(ISNULL(d.Berat, 0)) AS BeratSisa,
        MIN(h.DateCreate) AS DateCreateTertua
      FROM dbo.Washing_h h
      INNER JOIN dbo.Washing_d d
        ON d.NoWashing = h.NoWashing
      WHERE d.DateUsage IS NULL
      GROUP BY h.IdJenisPlastik
    ) agg
      ON agg.IdJenisPlastik = m.IdWashing
    WHERE ISNULL(m.IsEnable, 1) = 1
    ORDER BY m.Nama ASC;
  `);

  return result.recordset.map((r) => ({
    IdWashing: r.IdWashing,
    Nama: r.Nama,
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
  }));
}

async function getLabelByIdWashing(idWashing) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdJenisPlastik", sql.Int, idWashing).query(`
      SELECT
        h.NoWashing,
        h.NoWashing AS Label,
        h.DateCreate,
        COUNT(d.NoSak) AS SakSisa,
        SUM(ISNULL(d.Berat, 0)) AS BeratSisa
      FROM dbo.Washing_h h
      INNER JOIN dbo.Washing_d d
        ON d.NoWashing = h.NoWashing
      WHERE h.IdJenisPlastik = @IdJenisPlastik
        AND d.DateUsage IS NULL
      GROUP BY h.NoWashing, h.DateCreate
      ORDER BY h.DateCreate ASC, h.NoWashing ASC;
    `);

  return result.recordset.map((r) => ({
    NoWashing: r.NoWashing,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdWashing };
