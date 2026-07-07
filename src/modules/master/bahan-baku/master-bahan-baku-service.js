const { sql, poolPromise } = require("../../../core/config/db");

// GET jenis bahan baku proses (IsProses = 1) beserta sisa stok (sak & berat)
exports.getStokProses = async () => {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT
      m.IdBB,
      m.Nama,
      ISNULL(agg.SakSisa, 0)   AS SakSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa
    FROM dbo.MstBahanBaku m
    LEFT JOIN (
      SELECT
        p.IdJenisPlastik,
        SUM(CASE WHEN d.DateUsage IS NULL THEN 1 ELSE 0 END) AS SakSisa,
        SUM(
          CASE
            WHEN d.DateUsage IS NOT NULL THEN 0
            ELSE
              CASE
                WHEN d.IsPartial = 1 THEN
                  CASE
                    WHEN (ISNULL(d.Berat, 0) - ISNULL(ps.PartialBerat, 0)) < 0 THEN 0
                    ELSE (ISNULL(d.Berat, 0) - ISNULL(ps.PartialBerat, 0))
                  END
                ELSE ISNULL(d.Berat, 0)
              END
          END
        ) AS BeratSisa
      FROM dbo.BahanBaku_d d
      JOIN dbo.BahanBakuPallet_h p
        ON p.NoBahanBaku = d.NoBahanBaku
       AND p.NoPallet    = d.NoPallet
      LEFT JOIN (
        SELECT NoBahanBaku, NoPallet, NoSak, SUM(Berat) AS PartialBerat
        FROM dbo.BahanBakuPartial
        GROUP BY NoBahanBaku, NoPallet, NoSak
      ) ps
        ON ps.NoBahanBaku = d.NoBahanBaku
       AND ps.NoPallet    = d.NoPallet
       AND ps.NoSak       = d.NoSak
      GROUP BY p.IdJenisPlastik
    ) agg
      ON agg.IdJenisPlastik = m.IdBB
    WHERE m.IsProses = 1
    ORDER BY m.Nama;
  `);

  return result.recordset.map((r) => ({
    IdBB: r.IdBB,
    Nama: r.Nama,
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
};

// GET label (NoBahanBaku-NoPallet) yang masih ada sisa untuk suatu jenis bahan baku (IdBB)
exports.getLabelByIdBahanBaku = async (idBahanBaku) => {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdJenisPlastik", sql.Int, idBahanBaku).query(`
      SELECT
        p.NoBahanBaku,
        p.NoPallet,
        p.NoBahanBaku + '-' + CAST(p.NoPallet AS varchar(20)) AS Label,
        ISNULL(agg.SakSisa, 0)   AS SakSisa,
        ISNULL(agg.BeratSisa, 0) AS BeratSisa
      FROM dbo.BahanBakuPallet_h p
      OUTER APPLY (
        SELECT
          SUM(CASE WHEN d.DateUsage IS NULL THEN 1 ELSE 0 END) AS SakSisa,
          SUM(
            CASE
              WHEN d.DateUsage IS NOT NULL THEN 0
              ELSE
                CASE
                  WHEN d.IsPartial = 1 THEN
                    CASE
                      WHEN (ISNULL(d.Berat, 0) - ISNULL(ps.PartialBerat, 0)) < 0 THEN 0
                      ELSE (ISNULL(d.Berat, 0) - ISNULL(ps.PartialBerat, 0))
                    END
                  ELSE ISNULL(d.Berat, 0)
                END
            END
          ) AS BeratSisa
        FROM dbo.BahanBaku_d d
        LEFT JOIN (
          SELECT NoBahanBaku, NoPallet, NoSak, SUM(Berat) AS PartialBerat
          FROM dbo.BahanBakuPartial
          GROUP BY NoBahanBaku, NoPallet, NoSak
        ) ps
          ON ps.NoBahanBaku = d.NoBahanBaku
         AND ps.NoPallet    = d.NoPallet
         AND ps.NoSak       = d.NoSak
        WHERE d.NoBahanBaku = p.NoBahanBaku
          AND d.NoPallet    = p.NoPallet
      ) agg
      WHERE p.IdJenisPlastik = @IdJenisPlastik
        AND ISNULL(agg.SakSisa, 0) > 0
      ORDER BY p.NoBahanBaku, p.NoPallet;
    `);

  return result.recordset.map((r) => ({
    NoBahanBaku: r.NoBahanBaku,
    NoPallet: r.NoPallet,
    Label: r.Label,
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
};
