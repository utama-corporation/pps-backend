const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive({ search = "" } = {}) {
  const pool = await poolPromise;
  const searchTerm = String(search || "").trim();

  const dataResult = await pool
    .request()
    .input("search", sql.NVarChar(200), searchTerm).query(`
    SELECT
      IdBJ AS idJenis,
      NamaBJ AS namaJenis
    FROM [dbo].[MstBarangJadi]
    WHERE ISNULL(Enable, 1) = 1
      AND (@search = '' OR NamaBJ LIKE '%' + @search + '%')
    ORDER BY NamaBJ ASC;
  `);

  return dataResult.recordset || [];
}

// Stok sisa per jenis barang jadi (MstBarangJadi), net dari BarangJadiPartial.
// BarangJadi flat (satu baris = satu label) — Blok/IdLokasi lokasi label.
async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    WITH PartialSum AS (
      SELECT NoBJ, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
      FROM dbo.BarangJadiPartial
      GROUP BY NoBJ
    ),
    EffectiveDetail AS (
      SELECT
        bj.NoBJ,
        bj.IdBJ,
        bj.DateCreate,
        bj.Blok,
        bj.IdLokasi,
        CASE
          WHEN bj.IsPartial = 1 THEN
            CASE
              WHEN ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0) < 0 THEN 0
              ELSE ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0)
            END
          ELSE ISNULL(bj.Pcs, 0)
        END AS PcsEfektif,
        ISNULL(bj.Berat, 0) AS Berat
      FROM dbo.BarangJadi bj
      LEFT JOIN PartialSum ps
        ON ps.NoBJ = bj.NoBJ
      WHERE bj.DateUsage IS NULL
    )
    SELECT
      m.IdBJ,
      m.NamaBJ,
      ISNULL(agg.LabelSisa, 0) AS LabelSisa,
      ISNULL(agg.PcsSisa, 0)   AS PcsSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua,
      STUFF((
        SELECT DISTINCT ', ' + CONCAT(ed.Blok, CONVERT(VARCHAR(10), ed.IdLokasi))
        FROM EffectiveDetail ed
        WHERE ed.IdBJ = m.IdBJ
          AND ed.PcsEfektif > 0
          AND ISNULL(NULLIF(ed.Blok, ''), '') <> ''
        FOR XML PATH('')
      ), 1, 2, '') AS Lokasi
    FROM dbo.MstBarangJadi m
    LEFT JOIN (
      SELECT
        IdBJ,
        SUM(CASE WHEN PcsEfektif > 0 THEN 1 ELSE 0 END) AS LabelSisa,
        SUM(PcsEfektif) AS PcsSisa,
        SUM(Berat) AS BeratSisa,
        MIN(CASE WHEN PcsEfektif > 0 THEN DateCreate END) AS DateCreateTertua
      FROM EffectiveDetail
      GROUP BY IdBJ
    ) agg
      ON agg.IdBJ = m.IdBJ
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.NamaBJ ASC;
  `);

  return result.recordset.map((r) => ({
    IdBJ: r.IdBJ,
    NamaBJ: r.NamaBJ,
    LabelSisa: typeof r.LabelSisa === "number" ? r.LabelSisa : parseInt(r.LabelSisa, 10) || 0,
    PcsSisa: typeof r.PcsSisa === "number" ? r.PcsSisa : parseInt(r.PcsSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
    ...(r.Lokasi && r.Lokasi.trim() ? { Lokasi: r.Lokasi } : {}),
  }));
}

async function getLabelByIdBarangJadi(idBJ) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdBJ", sql.Int, idBJ).query(`
      WITH PartialSum AS (
        SELECT NoBJ, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
        FROM dbo.BarangJadiPartial
        GROUP BY NoBJ
      ),
      EffectiveLabel AS (
        SELECT
          bj.NoBJ,
          bj.DateCreate,
          CASE
            WHEN bj.IsPartial = 1 THEN
              CASE
                WHEN ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0) < 0 THEN 0
                ELSE ISNULL(bj.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0)
              END
            ELSE ISNULL(bj.Pcs, 0)
          END AS Pcs,
          ISNULL(bj.Berat, 0) AS Berat
        FROM dbo.BarangJadi bj
        LEFT JOIN PartialSum ps
          ON ps.NoBJ = bj.NoBJ
        WHERE bj.IdBJ = @IdBJ
          AND bj.DateUsage IS NULL
      )
      SELECT
        NoBJ,
        NoBJ AS Label,
        DateCreate,
        Pcs,
        Berat
      FROM EffectiveLabel
      WHERE Pcs > 0
      ORDER BY DateCreate ASC, NoBJ ASC;
    `);

  return result.recordset.map((r) => ({
    NoBJ: r.NoBJ,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    Pcs: typeof r.Pcs === "number" ? r.Pcs : parseInt(r.Pcs, 10) || 0,
    Berat: Number(
      (typeof r.Berat === "number" ? r.Berat : parseFloat(r.Berat) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdBarangJadi };
