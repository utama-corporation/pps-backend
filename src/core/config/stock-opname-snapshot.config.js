// Single source of truth untuk generate snapshot acuan stock-opname (stock-opname-v2).
// Setiap entry memetakan kodeKategori -> tabel snapshot, kolom jenis, kolom flag di StockOpname_h,
// dan query sumber data stok aktif (label yang masih ada sisa qty) dari SEMUA gudang (tidak difilter).
//
// Pola "masih ada stok" diambil dari logic yang sama dipakai stock-opname-service.js (validateStockOpnameLabel).
// Kategori bahanbaku (prefix A.) & bahanbakupakai (prefix AB.) tetap dianggap kategori terpisah
// (flag & pilihan sendiri-sendiri saat generate), tapi berbagi tabel produksi & snapshot yang sama
// (BahanBakuPallet_h / StockOpnameBahanBaku) — dibedakan lewat filter prefix NoBahanBaku.
//
// PENTING soal bentuk query: T-SQL tidak mengizinkan `WITH ...` (CTE) dibungkus sebagai derived
// table (`FROM (WITH ... SELECT ...) AS src`) ATAUPUN disisipkan setelah daftar kolom INSERT
// (`INSERT INTO tbl (cols) WITH ... SELECT ...`). Satu-satunya bentuk valid adalah:
//   ;WITH cte AS (...)
//   INSERT INTO tbl (cols)
//   SELECT ... FROM cte ...
// Karena itu tiap entry memisahkan `cteSql` (klausa WITH, taruh SEBELUM INSERT) dari
// `finalSelectSql` (SELECT akhir, taruh SETELAH daftar kolom INSERT). `cteSql` boleh kosong
// kalau kategori tidak butuh CTE (mis. washing).

function bahanBakuCteSql() {
  return `
    ;WITH p AS (
      SELECT NoBahanBaku, NoPallet, NoSak, SUM(ISNULL(Berat,0)) AS TotalPartial
      FROM dbo.BahanBakuPartial
      GROUP BY NoBahanBaku, NoPallet, NoSak
    )
  `;
}

function bahanBakuFinalSelectSql(prefixFilterSql) {
  return `
    SELECT
      @noso AS NoSO,
      bbh.NoBahanBaku,
      bbh.NoPallet,
      SUM(CASE WHEN rem.SisaBerat > 0 THEN 1 ELSE 0 END) AS JmlhSak,
      SUM(rem.SisaBerat) AS Berat,
      bbh.Blok,
      bbh.IdLokasi,
      bbh.IdJenisPlastik
    FROM dbo.BahanBaku_d AS d
    LEFT JOIN p
      ON d.NoBahanBaku = p.NoBahanBaku AND d.NoPallet = p.NoPallet AND d.NoSak = p.NoSak
    INNER JOIN dbo.BahanBakuPallet_h AS bbh
      ON bbh.NoBahanBaku = d.NoBahanBaku AND bbh.NoPallet = d.NoPallet
    CROSS APPLY (
      SELECT CASE
        WHEN d.IsPartial = 1 THEN
          CASE WHEN ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) < 0 THEN 0
               ELSE ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) END
        ELSE ISNULL(d.Berat,0)
      END AS SisaBerat
    ) AS rem
    WHERE d.DateUsage IS NULL
      AND ${prefixFilterSql}
    GROUP BY bbh.NoBahanBaku, bbh.NoPallet, bbh.Blok, bbh.IdLokasi, bbh.IdJenisPlastik
    HAVING SUM(rem.SisaBerat) > 0
  `;
}

const STOCK_OPNAME_SNAPSHOT_CONFIG = {
  // Catatan: BahanBakuPallet_h/BahanBaku_d tidak punya kolom tanggal pembuatan
  // (cuma TimeCreate = jam saja, tanpa tanggal), jadi filter DateCreate < @tanggal
  // TIDAK bisa diterapkan untuk kategori ini. hasDateCreateFilter=false menandai itu.
  bahanbaku: {
    flagColumn: "IsBahanBaku",
    snapshotTable: "StockOpnameBahanBaku",
    hasilTable: "StockOpnameHasilBahanBaku",
    jenisColumn: "IdJenisPlastik",
    insertColumns: ["NoBahanBaku", "NoPallet", "JmlhSak", "Berat", "Blok", "IdLokasi", "IdJenisPlastik"],
    labelColumns: ["NoBahanBaku", "NoPallet"],
    hasilColumns: ["NoBahanBaku", "NoPallet", "JmlhSak", "Berat"],
    hasDateCreateFilter: false,
    cteSql: bahanBakuCteSql(),
    finalSelectSql: bahanBakuFinalSelectSql(
      "bbh.NoBahanBaku LIKE 'A.%' AND bbh.NoBahanBaku NOT LIKE 'AB.%'",
    ),
  },

  bahanbakupakai: {
    flagColumn: "IsBahanBakuPakai",
    snapshotTable: "StockOpnameBahanBaku",
    hasilTable: "StockOpnameHasilBahanBaku",
    jenisColumn: "IdJenisPlastik",
    insertColumns: ["NoBahanBaku", "NoPallet", "JmlhSak", "Berat", "Blok", "IdLokasi", "IdJenisPlastik"],
    labelColumns: ["NoBahanBaku", "NoPallet"],
    hasilColumns: ["NoBahanBaku", "NoPallet", "JmlhSak", "Berat"],
    hasDateCreateFilter: false,
    cteSql: bahanBakuCteSql(),
    finalSelectSql: bahanBakuFinalSelectSql("bbh.NoBahanBaku LIKE 'AB.%'"),
  },

  washing: {
    flagColumn: "IsWashing",
    snapshotTable: "StockOpnameWashing",
    hasilTable: "StockOpnameHasilWashing",
    jenisColumn: "IdJenisPlastik",
    insertColumns: ["NoWashing", "JmlhSak", "Berat", "Blok", "IdLokasi", "IdJenisPlastik"],
    labelColumns: ["NoWashing"],
    hasilColumns: ["NoWashing", "JmlhSak", "Berat"],
    hasDateCreateFilter: true,
    cteSql: "",
    finalSelectSql: `
      SELECT
        @noso AS NoSO,
        h.NoWashing,
        ISNULL(dstats.JmlhSak, 0) AS JmlhSak,
        ISNULL(dstats.Berat, 0.0) AS Berat,
        h.Blok,
        h.IdLokasi,
        h.IdJenisPlastik
      FROM dbo.Washing_h AS h
      INNER JOIN (
        SELECT NoWashing, COUNT(1) AS JmlhSak, SUM(ISNULL(Berat, 0.0)) AS Berat
        FROM dbo.Washing_d
        WHERE DateUsage IS NULL
        GROUP BY NoWashing
      ) AS dstats ON dstats.NoWashing = h.NoWashing
      WHERE h.DateCreate < @tanggal
    `,
  },

  broker: {
    flagColumn: "IsBroker",
    snapshotTable: "StockOpnameBroker",
    hasilTable: "StockOpnameHasilBroker",
    jenisColumn: "IdJenisPlastik",
    insertColumns: ["NoBroker", "JmlhSak", "Berat", "Blok", "IdLokasi", "IdJenisPlastik"],
    labelColumns: ["NoBroker"],
    hasilColumns: ["NoBroker", "JmlhSak", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH p AS (
        SELECT NoBroker, NoSak, SUM(ISNULL(Berat,0)) AS TotalPartial
        FROM dbo.BrokerPartial
        GROUP BY NoBroker, NoSak
      ),
      drem AS (
        SELECT
          d.NoBroker,
          CASE
            WHEN d.IsPartial = 1 THEN
              CASE WHEN ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) < 0 THEN 0
                   ELSE ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) END
            ELSE ISNULL(d.Berat,0)
          END AS SisaBerat
        FROM dbo.Broker_d d
        LEFT JOIN p ON p.NoBroker = d.NoBroker AND p.NoSak = d.NoSak
        WHERE d.DateUsage IS NULL
      ),
      agg AS (
        SELECT NoBroker,
          SUM(CASE WHEN SisaBerat > 0 THEN 1 ELSE 0 END) AS JmlhSak,
          SUM(SisaBerat) AS Berat
        FROM drem
        GROUP BY NoBroker
      )
    `,
    finalSelectSql: `
      SELECT
        @noso AS NoSO,
        h.NoBroker,
        ISNULL(agg.JmlhSak, 0) AS JmlhSak,
        ISNULL(agg.Berat, 0) AS Berat,
        h.Blok,
        h.IdLokasi,
        h.IdJenisPlastik
      FROM dbo.Broker_h h
      INNER JOIN agg ON agg.NoBroker = h.NoBroker
      WHERE ISNULL(agg.Berat, 0) > 0
        AND h.DateCreate < @tanggal
    `,
  },

  crusher: {
    flagColumn: "IsCrusher",
    snapshotTable: "StockOpnameCrusher",
    hasilTable: "StockOpnameHasilCrusher",
    jenisColumn: "IdCrusher",
    insertColumns: ["NoCrusher", "Berat", "Blok", "IdLokasi", "IdCrusher"],
    labelColumns: ["NoCrusher"],
    hasilColumns: ["NoCrusher", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH ranked AS (
        SELECT
          c.NoCrusher, c.Berat, c.Blok, c.IdLokasi, c.IdCrusher,
          ROW_NUMBER() OVER (PARTITION BY c.NoCrusher ORDER BY c.DateCreate DESC, c.DateTimeCreate DESC) AS rn
        FROM dbo.Crusher AS c
        WHERE c.DateUsage IS NULL
          AND c.DateCreate < @tanggal
      )
    `,
    finalSelectSql: `
      SELECT @noso AS NoSO, NoCrusher, ISNULL(Berat, 0) AS Berat, Blok, IdLokasi, IdCrusher
      FROM ranked WHERE rn = 1
    `,
  },

  bonggolan: {
    flagColumn: "IsBonggolan",
    snapshotTable: "StockOpnameBonggolan",
    hasilTable: "StockOpnameHasilBonggolan",
    jenisColumn: "IdBonggolan",
    insertColumns: ["NoBonggolan", "Berat", "Blok", "IdLokasi", "IdBonggolan"],
    labelColumns: ["NoBonggolan"],
    hasilColumns: ["NoBonggolan", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH ranked AS (
        SELECT
          b.NoBonggolan, b.Berat, b.Blok, b.IdLokasi, b.IdBonggolan,
          ROW_NUMBER() OVER (PARTITION BY b.NoBonggolan ORDER BY b.DateCreate DESC, b.DateTimeCreate DESC) AS rn
        FROM dbo.Bonggolan AS b
        WHERE b.DateUsage IS NULL
          AND b.DateCreate < @tanggal
      )
    `,
    finalSelectSql: `
      SELECT @noso AS NoSO, NoBonggolan, ISNULL(Berat, 0) AS Berat, Blok, IdLokasi, IdBonggolan
      FROM ranked WHERE rn = 1
    `,
  },

  gilingan: {
    flagColumn: "IsGilingan",
    snapshotTable: "StockOpnameGilingan",
    hasilTable: "StockOpnameHasilGilingan",
    jenisColumn: "IdGilingan",
    insertColumns: ["NoGilingan", "Berat", "Blok", "IdLokasi", "IdGilingan"],
    labelColumns: ["NoGilingan"],
    hasilColumns: ["NoGilingan", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH filtered AS (
        SELECT d.*
        FROM dbo.Gilingan AS d
        WHERE d.DateUsage IS NULL
          AND d.DateCreate < @tanggal
      ),
      agg AS (
        SELECT
          d.NoGilingan,
          SUM(CASE WHEN d.IsPartial = 1 THEN ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) ELSE ISNULL(d.Berat,0) END) AS Berat
        FROM filtered AS d
        LEFT JOIN (
          SELECT NoGilingan, SUM(ISNULL(Berat,0)) AS TotalPartial
          FROM dbo.GilinganPartial
          GROUP BY NoGilingan
        ) AS p ON p.NoGilingan = d.NoGilingan
        GROUP BY d.NoGilingan
        HAVING SUM(CASE WHEN d.IsPartial = 1 THEN ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) ELSE ISNULL(d.Berat,0) END) > 0
      ),
      ranked AS (
        SELECT NoGilingan, Blok, IdLokasi, IdGilingan,
          ROW_NUMBER() OVER (PARTITION BY NoGilingan ORDER BY DateCreate DESC, DateTimeCreate DESC) AS rn
        FROM filtered
      )
    `,
    finalSelectSql: `
      SELECT @noso AS NoSO, agg.NoGilingan, agg.Berat, ranked.Blok, ranked.IdLokasi, ranked.IdGilingan
      FROM agg
      INNER JOIN ranked ON ranked.NoGilingan = agg.NoGilingan AND ranked.rn = 1
    `,
  },

  mixer: {
    flagColumn: "IsMixer",
    snapshotTable: "StockOpnameMixer",
    hasilTable: "StockOpnameHasilMixer",
    jenisColumn: "IdMixer",
    insertColumns: ["NoMixer", "JmlhSak", "Berat", "Blok", "IdLokasi", "IdMixer"],
    labelColumns: ["NoMixer"],
    hasilColumns: ["NoMixer", "JmlhSak", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH p AS (
        SELECT mp.NoMixer, mp.NoSak, SUM(ISNULL(mp.Berat,0)) AS TotalPartial
        FROM dbo.MixerPartial AS mp
        GROUP BY mp.NoMixer, mp.NoSak
      ),
      drem AS (
        SELECT
          d.NoMixer,
          CASE
            WHEN d.IsPartial = 1 THEN
              CASE WHEN ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) < 0 THEN 0
                   ELSE ISNULL(d.Berat,0) - ISNULL(p.TotalPartial,0) END
            ELSE ISNULL(d.Berat,0)
          END AS SisaBerat
        FROM dbo.Mixer_d d
        LEFT JOIN p ON p.NoMixer = d.NoMixer AND p.NoSak = d.NoSak
        WHERE d.DateUsage IS NULL
      ),
      agg AS (
        SELECT NoMixer,
          SUM(CASE WHEN SisaBerat > 0 THEN 1 ELSE 0 END) AS JmlhSak,
          SUM(SisaBerat) AS Berat
        FROM drem
        GROUP BY NoMixer
      )
    `,
    finalSelectSql: `
      SELECT
        @noso AS NoSO,
        h.NoMixer,
        ISNULL(agg.JmlhSak, 0) AS JmlhSak,
        ISNULL(agg.Berat, 0) AS Berat,
        h.Blok,
        h.IdLokasi,
        h.IdMixer
      FROM dbo.Mixer_h h
      INNER JOIN agg ON agg.NoMixer = h.NoMixer
      WHERE ISNULL(agg.Berat, 0) > 0
        AND h.DateCreate < @tanggal
    `,
  },

  furniturewip: {
    flagColumn: "IsFurnitureWIP",
    snapshotTable: "StockOpnameFurnitureWIP",
    hasilTable: "StockOpnameHasilFurnitureWIP",
    jenisColumn: "IDFurnitureWIP",
    insertColumns: ["NoFurnitureWIP", "Pcs", "Berat", "Blok", "IdLokasi", "IDFurnitureWIP"],
    labelColumns: ["NoFurnitureWIP"],
    hasilColumns: ["NoFurnitureWIP", "Pcs", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH filtered AS (
        SELECT d.*
        FROM dbo.FurnitureWIP AS d
        WHERE d.DateUsage IS NULL
          AND d.DateCreate < @tanggal
      ),
      base AS (
        SELECT
          d.NoFurnitureWIP,
          SUM(CASE WHEN d.IsPartial = 1 THEN 0 ELSE ISNULL(d.Pcs,0) END) AS SumNonPartialPcs,
          SUM(CASE WHEN d.IsPartial = 1 THEN ISNULL(d.Pcs,0) ELSE 0 END) AS SumPartialPcs,
          SUM(ISNULL(d.Berat,0)) AS TotalBerat
        FROM filtered AS d
        GROUP BY d.NoFurnitureWIP
      ),
      p AS (
        SELECT fp.NoFurnitureWIP, SUM(ISNULL(fp.Pcs,0)) AS TotalPartialPcs
        FROM dbo.FurnitureWIPPartial AS fp
        GROUP BY fp.NoFurnitureWIP
      ),
      ranked AS (
        SELECT NoFurnitureWIP, Blok, IdLokasi, IDFurnitureWIP,
          ROW_NUMBER() OVER (PARTITION BY NoFurnitureWIP ORDER BY DateCreate DESC, DateTimeCreate DESC) AS rn
        FROM filtered
      )
    `,
    finalSelectSql: `
      SELECT
        @noso AS NoSO,
        b.NoFurnitureWIP,
        b.SumNonPartialPcs +
          CASE WHEN ISNULL(b.SumPartialPcs,0) - ISNULL(p.TotalPartialPcs,0) < 0 THEN 0
               ELSE ISNULL(b.SumPartialPcs,0) - ISNULL(p.TotalPartialPcs,0) END AS Pcs,
        b.TotalBerat AS Berat,
        ranked.Blok,
        ranked.IdLokasi,
        ranked.IDFurnitureWIP
      FROM base AS b
      LEFT JOIN p ON p.NoFurnitureWIP = b.NoFurnitureWIP
      INNER JOIN ranked ON ranked.NoFurnitureWIP = b.NoFurnitureWIP AND ranked.rn = 1
    `,
  },

  barangjadi: {
    flagColumn: "IsBarangJadi",
    snapshotTable: "StockOpnameBarangJadi",
    hasilTable: "StockOpnameHasilBarangJadi",
    jenisColumn: "IdBJ",
    insertColumns: ["NoBJ", "Pcs", "Berat", "Blok", "IdLokasi", "IdBJ"],
    labelColumns: ["NoBJ"],
    hasilColumns: ["NoBJ", "Pcs", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH filtered AS (
        SELECT d.*
        FROM dbo.BarangJadi AS d
        WHERE d.DateUsage IS NULL
          AND d.DateCreate < @tanggal
      ),
      base AS (
        SELECT
          d.NoBJ,
          SUM(CASE WHEN d.IsPartial = 1 THEN 0 ELSE ISNULL(d.Pcs,0) END) AS SumNonPartialPcs,
          SUM(CASE WHEN d.IsPartial = 1 THEN ISNULL(d.Pcs,0) ELSE 0 END) AS SumPartialPcs,
          SUM(ISNULL(d.Berat,0)) AS TotalBerat
        FROM filtered AS d
        GROUP BY d.NoBJ
      ),
      p AS (
        SELECT bp.NoBJ, SUM(ISNULL(bp.Pcs,0)) AS TotalPartialPcs
        FROM dbo.BarangJadiPartial AS bp
        GROUP BY bp.NoBJ
      ),
      ranked AS (
        SELECT NoBJ, Blok, IdLokasi, IdBJ,
          ROW_NUMBER() OVER (PARTITION BY NoBJ ORDER BY DateCreate DESC, DateTimeCreate DESC) AS rn
        FROM filtered
      )
    `,
    finalSelectSql: `
      SELECT
        @noso AS NoSO,
        b.NoBJ,
        b.SumNonPartialPcs +
          CASE WHEN ISNULL(b.SumPartialPcs,0) - ISNULL(p.TotalPartialPcs,0) < 0 THEN 0
               ELSE ISNULL(b.SumPartialPcs,0) - ISNULL(p.TotalPartialPcs,0) END AS Pcs,
        b.TotalBerat AS Berat,
        ranked.Blok,
        ranked.IdLokasi,
        ranked.IdBJ
      FROM base AS b
      LEFT JOIN p ON p.NoBJ = b.NoBJ
      INNER JOIN ranked ON ranked.NoBJ = b.NoBJ AND ranked.rn = 1
    `,
  },

  reject: {
    flagColumn: "IsReject",
    snapshotTable: "StockOpnameReject",
    hasilTable: "StockOpnameHasilReject",
    jenisColumn: "IdReject",
    insertColumns: ["NoReject", "Berat", "Blok", "IdLokasi", "IdReject"],
    labelColumns: ["NoReject"],
    hasilColumns: ["NoReject", "Berat"],
    hasDateCreateFilter: true,
    cteSql: `
      ;WITH filtered AS (
        SELECT r.*
        FROM dbo.RejectV2 r
        WHERE r.DateUsage IS NULL
          AND r.DateCreate < @tanggal
      ),
      base AS (
        SELECT
          r.NoReject,
          SUM(CASE WHEN r.IsPartial = 1 THEN 0 ELSE ISNULL(r.Berat,0) END) AS SumNonPartialBerat,
          SUM(CASE WHEN r.IsPartial = 1 THEN ISNULL(r.Berat,0) ELSE 0 END) AS SumPartialBerat
        FROM filtered AS r
        GROUP BY r.NoReject
      ),
      p AS (
        SELECT NoReject, SUM(ISNULL(Berat,0)) AS TotalPartialBerat
        FROM dbo.RejectV2Partial
        GROUP BY NoReject
      ),
      ranked AS (
        SELECT NoReject, Blok, IdLokasi, IdReject,
          ROW_NUMBER() OVER (PARTITION BY NoReject ORDER BY DateCreate DESC, DateTimeCreate DESC) AS rn
        FROM filtered
      )
    `,
    finalSelectSql: `
      SELECT
        @noso AS NoSO,
        b.NoReject,
        b.SumNonPartialBerat +
          CASE WHEN ISNULL(b.SumPartialBerat,0) - ISNULL(p.TotalPartialBerat,0) < 0 THEN 0
               ELSE ISNULL(b.SumPartialBerat,0) - ISNULL(p.TotalPartialBerat,0) END AS Berat,
        ranked.Blok,
        ranked.IdLokasi,
        ranked.IdReject
      FROM base AS b
      LEFT JOIN p ON p.NoReject = b.NoReject
      INNER JOIN ranked ON ranked.NoReject = b.NoReject AND ranked.rn = 1
    `,
  },
};

module.exports = { STOCK_OPNAME_SNAPSHOT_CONFIG };
