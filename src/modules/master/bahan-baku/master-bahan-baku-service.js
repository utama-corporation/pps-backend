const { sql, poolPromise } = require("../../../core/config/db");

// Builder query stok sisa (sak & berat) per jenis MstBahanBaku, di-filter lewat whereClause.
async function getStokByFilter(whereClause) {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    SELECT
      m.IdBB,
      m.Nama,
      ISNULL(agg.SakSisa, 0)   AS SakSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstBahanBaku m
    LEFT JOIN (
      SELECT
        p.IdJenisPlastik,
        SUM(pallet.SakSisa)   AS SakSisa,
        SUM(pallet.BeratSisa) AS BeratSisa,
        MIN(CASE WHEN pallet.SakSisa > 0 THEN h.DateCreate END) AS DateCreateTertua
      FROM dbo.BahanBakuPallet_h p
      JOIN dbo.BahanBaku_h h
        ON h.NoBahanBaku = p.NoBahanBaku
      CROSS APPLY (
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
      ) pallet
      GROUP BY p.IdJenisPlastik
    ) agg
      ON agg.IdJenisPlastik = m.IdBB
    WHERE ${whereClause}
    ORDER BY m.Nama;
  `);

  return result.recordset.map((r) => ({
    IdBB: r.IdBB,
    Nama: r.Nama,
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
  }));
}

// GET jenis bahan baku proses (IsProses = 1) beserta sisa stok (sak & berat)
exports.getStokProses = async () => {
  return getStokByFilter("m.IsProses = 1");
};

// GET jenis bahan baku pakai (IsProses NULL atau 0) beserta sisa stok (sak & berat)
exports.getStokPakai = async () => {
  return getStokByFilter("ISNULL(m.IsProses, 0) = 0");
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
        h.DateCreate,
        ISNULL(agg.SakSisa, 0)   AS SakSisa,
        ISNULL(agg.BeratSisa, 0) AS BeratSisa
      FROM dbo.BahanBakuPallet_h p
      JOIN dbo.BahanBaku_h h
        ON h.NoBahanBaku = p.NoBahanBaku
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
      ORDER BY h.DateCreate ASC, p.NoBahanBaku ASC, p.NoPallet ASC;
    `);

  return result.recordset.map((r) => ({
    NoBahanBaku: r.NoBahanBaku,
    NoPallet: r.NoPallet,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
};
