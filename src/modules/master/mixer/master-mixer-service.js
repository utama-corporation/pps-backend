const { sql, poolPromise } = require("../../../core/config/db");
const { attachLokasiToStok } = require("../../../core/shared/stok-lokasi.helper");

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      IdMixer,
      Jenis,
      Enable,
      ItemCode
    FROM [dbo].[MstMixer]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY Jenis ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

// Stok sisa per jenis mixer (MstMixer), net dari MixerPartial (sak IsPartial=1
// beratnya dikurangi total yang sudah dipakai sebagian) — sama seperti perhitungan
// di modules/label/mixer (getMixerHeaderByNoMixer), tapi partial di-precompute
// per (NoMixer, NoSak) dulu supaya tidak fan-out kalau ada >1 baris partial per sak.
async function getStokProses() {
  const pool = await poolPromise;

  const result = await pool.request().query(`
    WITH PartialSum AS (
      SELECT NoMixer, NoSak, SUM(Berat) AS PartialBerat
      FROM dbo.MixerPartial
      GROUP BY NoMixer, NoSak
    ),
    EffectiveDetail AS (
      SELECT
        h.IdMixer,
        h.DateCreate,
        h.Blok,
        h.IdLokasi,
        d.NoSak,
        CASE
          WHEN d.IsPartial = 1 THEN d.Berat - ISNULL(ps.PartialBerat, 0)
          ELSE d.Berat
        END AS BeratEfektif
      FROM dbo.Mixer_h h
      INNER JOIN dbo.Mixer_d d
        ON d.NoMixer = h.NoMixer
      LEFT JOIN PartialSum ps
        ON ps.NoMixer = d.NoMixer
       AND ps.NoSak = d.NoSak
      WHERE d.DateUsage IS NULL
    )
    SELECT
      m.IdMixer,
      m.Jenis,
      ISNULL(agg.SakSisa, 0)   AS SakSisa,
      ISNULL(agg.BeratSisa, 0) AS BeratSisa,
      agg.DateCreateTertua
    FROM dbo.MstMixer m
    LEFT JOIN (
      SELECT
        IdMixer,
        COUNT(NoSak) AS SakSisa,
        SUM(ISNULL(BeratEfektif, 0)) AS BeratSisa,
        MIN(DateCreate) AS DateCreateTertua
      FROM EffectiveDetail
      GROUP BY IdMixer
    ) agg
      ON agg.IdMixer = m.IdMixer
    WHERE ISNULL(m.Enable, 1) = 1
    ORDER BY m.Jenis ASC;
  `);

  const items = result.recordset.map((r) => ({
    IdMixer: r.IdMixer,
    Jenis: r.Jenis,
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
    DateCreateTertua: r.DateCreateTertua,
  }));

  return attachLokasiToStok(items, {
    sql: `
      SELECT
        h.IdMixer AS IdKey,
        h.Blok,
        h.IdLokasi
      FROM dbo.Mixer_h h
      INNER JOIN dbo.Mixer_d d ON d.NoMixer = h.NoMixer
      WHERE d.DateUsage IS NULL
        AND ISNULL(NULLIF(h.Blok, ''), '') <> ''
      GROUP BY h.IdMixer, h.Blok, h.IdLokasi;
    `,
    idOf: (r) => r.IdMixer,
  });
}

async function getLabelByIdMixer(idMixer) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("IdMixer", sql.Int, idMixer).query(`
      WITH PartialSum AS (
        SELECT NoMixer, NoSak, SUM(Berat) AS PartialBerat
        FROM dbo.MixerPartial
        GROUP BY NoMixer, NoSak
      ),
      EffectiveDetail AS (
        SELECT
          h.NoMixer,
          h.DateCreate,
          h.Blok,
          h.IdLokasi,
          d.NoSak,
          CASE
            WHEN d.IsPartial = 1 THEN d.Berat - ISNULL(ps.PartialBerat, 0)
            ELSE d.Berat
          END AS BeratEfektif
        FROM dbo.Mixer_h h
        INNER JOIN dbo.Mixer_d d
          ON d.NoMixer = h.NoMixer
        LEFT JOIN PartialSum ps
          ON ps.NoMixer = d.NoMixer
         AND ps.NoSak = d.NoSak
        WHERE h.IdMixer = @IdMixer
          AND d.DateUsage IS NULL
      )
      SELECT
        NoMixer,
        NoMixer AS Label,
        DateCreate,
        Blok,
        IdLokasi,
        COUNT(NoSak) AS SakSisa,
        SUM(ISNULL(BeratEfektif, 0)) AS BeratSisa
      FROM EffectiveDetail
      GROUP BY NoMixer, DateCreate, Blok, IdLokasi
      ORDER BY DateCreate ASC, NoMixer ASC;
    `);

  return result.recordset.map((r) => ({
    NoMixer: r.NoMixer,
    Label: r.Label,
    ...(r.DateCreate && { DateCreate: r.DateCreate }),
    ...(r.Blok && r.Blok.trim()
      ? { Lokasi: `${r.Blok}${r.IdLokasi ?? ""}` }
      : {}),
    SakSisa: typeof r.SakSisa === "number" ? r.SakSisa : parseInt(r.SakSisa, 10) || 0,
    BeratSisa: Number(
      (typeof r.BeratSisa === "number" ? r.BeratSisa : parseFloat(r.BeratSisa) || 0).toFixed(2),
    ),
  }));
}

module.exports = { getAllActive, getStokProses, getLabelByIdMixer };
