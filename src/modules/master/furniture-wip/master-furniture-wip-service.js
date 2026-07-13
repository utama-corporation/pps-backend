const { sql, poolPromise } = require("../../../core/config/db");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      IdCabinetWIP,
      Nama,
      IdCabinetWIPType,
      SaldoAwal,
      TglSaldoAwal,
      IdUOM,
      Enable,
      IdTypeFurnitureWIP,
      IdFurnitureCategory,
      PcsPerLabel,
      IsInputInjectProduksi,
      IdWarna,
      ItemCode
    FROM [dbo].[MstCabinetWIP]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY Nama ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

// Stok sisa per jenis furniture-wip (MstCabinetWIP), net dari FurnitureWIPPartial
// (label IsPartial=1 Pcs-nya dikurangi total yang sudah dipakai sebagian, clamp ke 0)
// — sama seperti perhitungan di modules/label/furniture-wip (getAll / getByNoFurnitureWip).
// Catatan: berbeda dari broker/mixer, Berat pada FurnitureWIP TIDAK dikurangi oleh partial,
// hanya Pcs — mengikuti logika asli di repository label/furniture-wip.
async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    WITH PartialSum AS (
      SELECT NoFurnitureWIP, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
      FROM dbo.FurnitureWIPPartial
      GROUP BY NoFurnitureWIP
    ),
    EffectiveDetail AS (
      SELECT
        f.NoFurnitureWIP,
        f.IdFurnitureWIP,
        f.DateCreate,
        CASE
          WHEN f.IsPartial = 1 THEN
            CASE
              WHEN ISNULL(f.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0) < 0 THEN 0
              ELSE ISNULL(f.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0)
            END
          ELSE ISNULL(f.Pcs, 0)
        END AS PcsEfektif,
        ISNULL(f.Berat, 0) AS Berat
      FROM dbo.FurnitureWIP f
      LEFT JOIN PartialSum ps
        ON ps.NoFurnitureWIP = f.NoFurnitureWIP
      WHERE f.DateUsage IS NULL
    )
    SELECT
      m.IdCabinetWIP,
      m.Nama,
      ISNULL(agg.LabelSisa, 0) AS LabelSisa,
      ISNULL(agg.PcsSisa, 0)   AS PcsSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstCabinetWIP m
    LEFT JOIN (
      SELECT
        IdFurnitureWIP,
        SUM(CASE WHEN PcsEfektif > 0 THEN 1 ELSE 0 END) AS LabelSisa,
        SUM(PcsEfektif) AS PcsSisa,
        SUM(Berat) AS BeratSisa,
        MIN(CASE WHEN PcsEfektif > 0 THEN DateCreate END) AS DateCreateTertua
      FROM EffectiveDetail
      GROUP BY IdFurnitureWIP
    ) agg
      ON agg.IdFurnitureWIP = m.IdCabinetWIP
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.Nama ASC;
  `);

  return result.recordset.map((r) => ({
    IdCabinetWIP: r.IdCabinetWIP,
    Nama: r.Nama,
    LabelSisa: typeof r.LabelSisa === "number" ? r.LabelSisa : parseInt(r.LabelSisa, 10) || 0,
    PcsSisa: typeof r.PcsSisa === "number" ? r.PcsSisa : parseInt(r.PcsSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    ...(r.DateCreateTertua && { DateCreateTertua: r.DateCreateTertua }),
  }));
}

async function getLabelByIdFurnitureWip(idFurnitureWip) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdFurnitureWIP", sql.Int, idFurnitureWip).query(`
      WITH PartialSum AS (
        SELECT NoFurnitureWIP, SUM(ISNULL(Pcs, 0)) AS TotalPartialPcs
        FROM dbo.FurnitureWIPPartial
        GROUP BY NoFurnitureWIP
      ),
      EffectiveLabel AS (
        SELECT
          f.NoFurnitureWIP,
          f.DateCreate,
          CASE
            WHEN f.IsPartial = 1 THEN
              CASE
                WHEN ISNULL(f.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0) < 0 THEN 0
                ELSE ISNULL(f.Pcs, 0) - ISNULL(ps.TotalPartialPcs, 0)
              END
            ELSE ISNULL(f.Pcs, 0)
          END AS Pcs,
          ISNULL(f.Berat, 0) AS Berat
        FROM dbo.FurnitureWIP f
        LEFT JOIN PartialSum ps
          ON ps.NoFurnitureWIP = f.NoFurnitureWIP
        WHERE f.IdFurnitureWIP = @IdFurnitureWIP
          AND f.DateUsage IS NULL
      )
      SELECT
        NoFurnitureWIP,
        NoFurnitureWIP AS Label,
        DateCreate,
        Pcs,
        Berat
      FROM EffectiveLabel
      WHERE Pcs > 0
      ORDER BY DateCreate ASC, NoFurnitureWIP ASC;
    `);

  return result.recordset.map((r) => ({
    NoFurnitureWIP: r.NoFurnitureWIP,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    Pcs: typeof r.Pcs === "number" ? r.Pcs : parseInt(r.Pcs, 10) || 0,
    Berat: Number(
      (typeof r.Berat === "number" ? r.Berat : parseFloat(r.Berat) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdFurnitureWip };
