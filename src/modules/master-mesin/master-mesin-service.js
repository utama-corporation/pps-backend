const { poolPromise } = require("../../core/config/db");

/**
 * Get MstMesin rows filtered by IdBagianMesin (integer).
 * - Exact match on IdBagianMesin.
 * - By default returns only active (Enable=1); pass includeDisabled=1 to include all.
 */
async function getByIdBagian({ idBagianMesin, includeDisabled = false }) {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(Enable, 1) = 1";

  const query = `
    SELECT
      IdMesin,
      NamaMesin,
      Bagian,
      DefaultOperator,
      Enable,
      Kapasitas,
      IdUOM,
      ShotWeightPS,
      KlemLebar,
      KlemPanjang,
      IdBagianMesin,
      Target
    FROM [dbo].[MstMesin]
    WHERE ${whereEnable}
      AND IdBagianMesin = @IdBagianMesin
    ORDER BY NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getBrokerByNoProduksi({
  idBagianMesin = 2,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      h.NoProduksi,
      CONVERT(date, h.TglProduksi) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      br.Nama AS OutputJenisNama,
      br.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.BrokerProduksiOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.BrokerProduksiOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd, 108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd, 108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        bh.NoProduksi,
        bh.TglProduksi,
        bh.IdRegu,
        bh.OutputJenisId,
        bh.Shift,
        bh.HourStart,
        bh.HourEnd
      FROM dbo.BrokerProduksi_h bh WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE bh.IdMesin = m.IdMesin
        AND CONVERT(date, bh.TglProduksi) = c.CurrentDate
        AND bh.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            bh.HourStart <= bh.HourEnd
            AND c.CurrentTime >= CAST(bh.HourStart AS time(0))
            AND c.CurrentTime < CAST(bh.HourEnd AS time(0))
          )
          OR
          (
            bh.HourStart > bh.HourEnd
            AND (
              c.CurrentTime >= CAST(bh.HourStart AS time(0))
              OR c.CurrentTime < CAST(bh.HourEnd AS time(0))
            )
          )
        )
      ORDER BY bh.HourStart DESC, bh.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstBroker br WITH (NOLOCK)
      ON br.IdBroker = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getWashingByNoProduksi({
  idBagianMesin = 7,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      h.NoProduksi,
      CONVERT(date, h.TglProduksi) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      mw.Nama AS OutputJenisNama,
      mw.ItemCode AS OutputJenisItemCode,
      h.IdOperator,
      op.NamaOperator,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd, 108) AS HourEnd,
      h.IsBlower,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd, 108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        wh.NoProduksi,
        wh.TglProduksi,
        wh.IdRegu,
        wh.OutputJenisId,
        wh.IdOperator,
        wh.Shift,
        wh.HourStart,
        wh.HourEnd,
        wh.IsBlower
      FROM dbo.WashingProduksi_h wh WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE wh.IdMesin = m.IdMesin
        AND CONVERT(date, wh.TglProduksi) = c.CurrentDate
        AND wh.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            wh.HourStart <= wh.HourEnd
            AND c.CurrentTime >= CAST(wh.HourStart AS time(0))
            AND c.CurrentTime < CAST(wh.HourEnd AS time(0))
          )
          OR
          (
            wh.HourStart > wh.HourEnd
            AND (
              c.CurrentTime >= CAST(wh.HourStart AS time(0))
              OR c.CurrentTime < CAST(wh.HourEnd AS time(0))
            )
          )
        )
      ORDER BY wh.HourStart DESC, wh.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstOperator op WITH (NOLOCK)
      ON op.IdOperator = h.IdOperator
    LEFT JOIN dbo.MstWashing mw WITH (NOLOCK)
      ON mw.IdWashing = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getCrusherByNoProduksi({
  idBagianMesin = 3,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      h.NoCrusherProduksi AS NoProduksi,
      CONVERT(date, h.Tanggal) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      mc.NamaCrusher AS OutputJenisNama,
      mc.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.CrusherProduksiOperator_d od WITH (NOLOCK)
            WHERE od.NoCrusherProduksi = h.NoCrusherProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.CrusherProduksiOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoCrusherProduksi = h.NoCrusherProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd, 108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd, 108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        ch.NoCrusherProduksi,
        ch.Tanggal,
        ch.IdRegu,
        ch.OutputJenisId,
        ch.Shift,
        ch.HourStart,
        ch.HourEnd
      FROM dbo.CrusherProduksi_h ch WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE ch.IdMesin = m.IdMesin
        AND CONVERT(date, ch.Tanggal) = c.CurrentDate
        AND ch.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            ch.HourStart <= ch.HourEnd
            AND c.CurrentTime >= CAST(ch.HourStart AS time(0))
            AND c.CurrentTime < CAST(ch.HourEnd AS time(0))
          )
          OR
          (
            ch.HourStart > ch.HourEnd
            AND (
              c.CurrentTime >= CAST(ch.HourStart AS time(0))
              OR c.CurrentTime < CAST(ch.HourEnd AS time(0))
            )
          )
        )
      ORDER BY ch.HourStart DESC, ch.NoCrusherProduksi DESC
    ) h
    LEFT JOIN dbo.MstCrusher mc WITH (NOLOCK)
      ON mc.IdCrusher = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getGilinganByNoProduksi({
  idBagianMesin = 3,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      h.NoProduksi,
      CONVERT(date, h.Tanggal) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      mg.NamaGilingan AS OutputJenisNama,
      mg.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.GilinganProduksiOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.GilinganProduksiOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd, 108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd, 108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        gh.NoProduksi,
        gh.Tanggal,
        gh.IdRegu,
        gh.OutputJenisId,
        gh.Shift,
        gh.HourStart,
        gh.HourEnd
      FROM dbo.GilinganProduksi_h gh WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE gh.IdMesin = m.IdMesin
        AND CONVERT(date, gh.Tanggal) = c.CurrentDate
        AND gh.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            gh.HourStart <= gh.HourEnd
            AND c.CurrentTime >= CAST(gh.HourStart AS time(0))
            AND c.CurrentTime < CAST(gh.HourEnd AS time(0))
          )
          OR
          (
            gh.HourStart > gh.HourEnd
            AND (
              c.CurrentTime >= CAST(gh.HourStart AS time(0))
              OR c.CurrentTime < CAST(gh.HourEnd AS time(0))
            )
          )
        )
      ORDER BY gh.HourStart DESC, gh.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstGilingan mg WITH (NOLOCK)
      ON mg.IdGilingan = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getMixerByNoProduksi({
  idBagianMesin = 5,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      h.NoProduksi,
      CONVERT(date, h.TglProduksi) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      mm.Jenis  AS OutputJenisNama,
      mm.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.MixerProduksiOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.MixerProduksiOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd, 108)   AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd, 108)   AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        mh.NoProduksi,
        mh.TglProduksi,
        mh.IdRegu,
        mh.OutputJenisId,
        mh.Shift,
        mh.HourStart,
        mh.HourEnd
      FROM dbo.MixerProduksi_h mh WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE mh.IdMesin = m.IdMesin
        AND CONVERT(date, mh.TglProduksi) = c.CurrentDate
        AND mh.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            mh.HourStart <= mh.HourEnd
            AND c.CurrentTime >= CAST(mh.HourStart AS time(0))
            AND c.CurrentTime < CAST(mh.HourEnd AS time(0))
          )
          OR
          (
            mh.HourStart > mh.HourEnd
            AND (
              c.CurrentTime >= CAST(mh.HourStart AS time(0))
              OR c.CurrentTime < CAST(mh.HourEnd AS time(0))
            )
          )
        )
      ORDER BY mh.HourStart DESC, mh.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstMixer mm WITH (NOLOCK)
      ON mm.IdMixer = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getInjectByNoProduksi({
  idBagianMesin = 4,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      COALESCE(h.NoProduksi, pendingProd.NoProduksi) AS NoProduksi,
      CONVERT(date, COALESCE(h.TglProduksi, pendingProd.TglProduksi)) AS TglProduksi,
      COALESCE(h.IdRegu, pendingProd.IdRegu) AS IdRegu,
      rg.NamaRegu,
      COALESCE(h.IdCetakan, pendingProd.IdCetakan) AS IdCetakan,
      ct.NamaCetakan,
      COALESCE(h.IdWarna, pendingProd.IdWarna) AS IdWarna,
      wr.Warna,
      COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) AS IdFurnitureMaterial,
      fm.Nama AS NamaFurnitureMaterial,
      CASE
        WHEN fwCount.TotalCount > 0 THEN 'furnitureWip'
        WHEN bjCount.TotalCount > 0 THEN 'barangjadi'
        ELSE NULL
      END AS OutputCategory,
      CASE
        WHEN fwCount.TotalCount > 0 THEN fwItems.OutputItems
        WHEN bjCount.TotalCount > 0 THEN bjItems.OutputItems
        ELSE NULL
      END AS Outputs,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = COALESCE(h.NoProduksi, pendingProd.NoProduksi)
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.InjectProduksiOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = COALESCE(h.NoProduksi, pendingProd.NoProduksi)
        ),
        ''
      ) AS Operators,
      COALESCE(h.Shift, pendingProd.Shift) AS Shift,
      CONVERT(varchar(8), COALESCE(h.HourStart, pendingProd.HourStart), 108) AS HourStart,
      CONVERT(varchar(8), COALESCE(h.HourEnd, pendingProd.HourEnd), 108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd, 108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate,
      mi.StandarBerat,
      mi.StandarCycleTime,
      mi.CounterCurrent,
      mi.CounterAtReset,
      mi.LastResetAt,
      mi.LastResetBy,
      mi.CounterUpdatedAt,
      CASE
        WHEN pendingProd.NoProduksi IS NOT NULL THEN 'pending'
        WHEN h.NoProduksi IS NULL THEN 'idle'
        ELSE 'aktif'
      END AS MachineStatus,
      h.IsRealtime
    FROM dbo.MstMesin m WITH (NOLOCK)
    LEFT JOIN dbo.MstMesinInject mi WITH (NOLOCK)
      ON mi.IdMesin = m.IdMesin
    OUTER APPLY (
      SELECT TOP 1
        ih.NoProduksi,
        ih.TglProduksi,
        ih.IdRegu,
        ih.IdCetakan,
        ih.IdWarna,
        ih.IdFurnitureMaterial,
        ih.Shift,
        ih.HourStart,
        ih.HourEnd,
        ih.IsRealtime
      FROM dbo.InjectProduksi_h ih WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE ih.IdMesin = m.IdMesin
        AND CONVERT(date, ih.TglProduksi) = c.CurrentDate
        AND ih.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            ih.HourStart <= ih.HourEnd
            AND c.CurrentTime >= CAST(ih.HourStart AS time(0))
            AND c.CurrentTime < CAST(ih.HourEnd AS time(0))
          )
          OR
          (
            ih.HourStart > ih.HourEnd
            AND (
              c.CurrentTime >= CAST(ih.HourStart AS time(0))
              OR c.CurrentTime < CAST(ih.HourEnd AS time(0))
            )
          )
        )
      ORDER BY ih.HourStart DESC, ih.NoProduksi DESC
    ) h
    OUTER APPLY (
      -- Produksi terakhir mesin: jika IsComplete=0 dan HourEnd sudah lewat → pending
      SELECT TOP 1
        ph.NoProduksi,
        ph.TglProduksi,
        ph.IdRegu,
        ph.IdCetakan,
        ph.IdWarna,
        ph.IdFurnitureMaterial,
        ph.Shift,
        ph.HourStart,
        ph.HourEnd,
        ph.IsComplete
      FROM dbo.InjectProduksi_h ph WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE ph.IdMesin = m.IdMesin
      ORDER BY ph.TglProduksi DESC, ph.HourEnd DESC
    ) latestProd
    OUTER APPLY (
      -- Hanya expose sebagai pendingProd jika produksi terakhir belum complete dan HourEnd sudah lewat
      SELECT
        latestProd.NoProduksi,
        latestProd.TglProduksi,
        latestProd.IdRegu,
        latestProd.IdCetakan,
        latestProd.IdWarna,
        latestProd.IdFurnitureMaterial,
        latestProd.Shift,
        latestProd.HourStart,
        latestProd.HourEnd
      FROM (SELECT 1 AS dummy) _
      CROSS JOIN CurrentCtx c
      WHERE latestProd.NoProduksi IS NOT NULL
        AND latestProd.IsComplete = 0
        AND (
          CONVERT(date, latestProd.TglProduksi) < c.CurrentDate
          OR (
            CONVERT(date, latestProd.TglProduksi) = c.CurrentDate
            AND c.CurrentTime > CAST(latestProd.HourEnd AS time(0))
          )
        )
    ) pendingProd
    LEFT JOIN dbo.MstCetakan ct WITH (NOLOCK)
      ON ct.IdCetakan = COALESCE(h.IdCetakan, pendingProd.IdCetakan)
    LEFT JOIN dbo.MstWarna wr WITH (NOLOCK)
      ON wr.IdWarna = COALESCE(h.IdWarna, pendingProd.IdWarna)
    LEFT JOIN dbo.MstCabinetWIP fm WITH (NOLOCK)
      ON fm.IdCabinetWIP = COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial)
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = COALESCE(h.IdRegu, pendingProd.IdRegu)
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT
          dFw.IdFurnitureWIP AS IdJenis,
          cab.Nama AS NamaJenis
        FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
        INNER JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
          ON cab.IdCabinetWIP = dFw.IdFurnitureWIP
        WHERE dFw.IdCetakan = COALESCE(h.IdCetakan, pendingProd.IdCetakan)
          AND dFw.IdWarna = COALESCE(h.IdWarna, pendingProd.IdWarna)
          AND (
            (dFw.IdFurnitureMaterial IS NULL
              AND (COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) = 0
                OR COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) IS NULL))
            OR dFw.IdFurnitureMaterial = COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial)
          )
      ) x
    ) fwCount
    OUTER APPLY (
      SELECT
        JSON_QUERY(
          COALESCE(
            (
              SELECT
                x.IdJenis AS idJenis,
                x.NamaJenis AS namaJenis
              FROM (
                SELECT DISTINCT
                  dFw.IdFurnitureWIP AS IdJenis,
                  cab.Nama AS NamaJenis
                FROM dbo.CetakanWarnaToFurnitureWIP_d dFw WITH (NOLOCK)
                INNER JOIN dbo.MstCabinetWIP cab WITH (NOLOCK)
                  ON cab.IdCabinetWIP = dFw.IdFurnitureWIP
                WHERE dFw.IdCetakan = COALESCE(h.IdCetakan, pendingProd.IdCetakan)
                  AND dFw.IdWarna = COALESCE(h.IdWarna, pendingProd.IdWarna)
                  AND (
                    (dFw.IdFurnitureMaterial IS NULL
                      AND (COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) = 0
                        OR COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) IS NULL))
                    OR dFw.IdFurnitureMaterial = COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial)
                  )
              ) x
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS OutputItems
    ) fwItems
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalCount
      FROM (
        SELECT DISTINCT
          dBj.IdBarangJadi AS IdJenis,
          mbj.NamaBJ AS NamaJenis
        FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
        INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
          ON mbj.IdBJ = dBj.IdBarangJadi
        WHERE dBj.IdCetakan = COALESCE(h.IdCetakan, pendingProd.IdCetakan)
          AND dBj.IdWarna = COALESCE(h.IdWarna, pendingProd.IdWarna)
          AND (
            (dBj.IdFurnitureMaterial IS NULL
              AND (COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) = 0
                OR COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) IS NULL))
            OR dBj.IdFurnitureMaterial = COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial)
          )
      ) x
    ) bjCount
    OUTER APPLY (
      SELECT
        JSON_QUERY(
          COALESCE(
            (
              SELECT
                x.IdJenis AS idJenis,
                x.NamaJenis AS namaJenis
              FROM (
                SELECT DISTINCT
                  dBj.IdBarangJadi AS IdJenis,
                  mbj.NamaBJ AS NamaJenis
                FROM dbo.CetakanWarnaToProduk_d dBj WITH (NOLOCK)
                INNER JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
                  ON mbj.IdBJ = dBj.IdBarangJadi
                WHERE dBj.IdCetakan = COALESCE(h.IdCetakan, pendingProd.IdCetakan)
                  AND dBj.IdWarna = COALESCE(h.IdWarna, pendingProd.IdWarna)
                  AND (
                    (dBj.IdFurnitureMaterial IS NULL
                      AND (COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) = 0
                        OR COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial) IS NULL))
                    OR dBj.IdFurnitureMaterial = COALESCE(h.IdFurnitureMaterial, pendingProd.IdFurnitureMaterial)
                  )
              ) x
              FOR JSON PATH
            ),
            '[]'
          )
        ) AS OutputItems
    ) bjItems
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return (result.recordset || []).map((row) => {
    let outputs = [];
    if (Array.isArray(row.Outputs)) {
      outputs = row.Outputs;
    } else if (typeof row.Outputs === "string" && row.Outputs.trim()) {
      try {
        outputs = JSON.parse(row.Outputs);
      } catch (_) {
        outputs = [];
      }
    }

    return {
      ...row,
      Outputs: outputs,
      standarBerat: row.StandarBerat == null ? null : Number(row.StandarBerat),
      standarCycleTime: row.StandarCycleTime == null ? null : Number(row.StandarCycleTime),
      counterCurrent: row.CounterCurrent == null ? null : Number(row.CounterCurrent),
      counterAtReset: row.CounterAtReset == null ? null : Number(row.CounterAtReset),
      lastResetAt: row.LastResetAt ?? null,
      lastResetBy: row.LastResetBy ?? null,
      counterUpdatedAt: row.CounterUpdatedAt ?? null,
    };
  });
}

async function getStampingByNoProduksi({
  idBagianMesin = 8,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      h.NoProduksi,
      CONVERT(date, h.Tanggal) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      cw.Nama     AS OutputJenisNama,
      cw.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.HotStampingOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.HotStampingOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd,   108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd,   108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        hs.NoProduksi,
        hs.Tanggal,
        hs.IdRegu,
        hs.OutputJenisId,
        hs.Shift,
        hs.HourStart,
        hs.HourEnd
      FROM dbo.HotStamping_h hs WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE hs.IdMesin = m.IdMesin
        AND CONVERT(date, hs.Tanggal) = c.CurrentDate
        AND hs.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            hs.HourStart <= hs.HourEnd
            AND c.CurrentTime >= CAST(hs.HourStart AS time(0))
            AND c.CurrentTime < CAST(hs.HourEnd AS time(0))
          )
          OR
          (
            hs.HourStart > hs.HourEnd
            AND (
              c.CurrentTime >= CAST(hs.HourStart AS time(0))
              OR c.CurrentTime < CAST(hs.HourEnd AS time(0))
            )
          )
        )
      ORDER BY hs.HourStart DESC, hs.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
      ON cw.IdCabinetWIP = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getPasangKunciByNoProduksi({
  idBagianMesin = 10,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      h.NoProduksi,
      CONVERT(date, h.Tanggal) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      cw.Nama     AS OutputJenisNama,
      cw.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.PasangKunciOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.PasangKunciOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd,   108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd,   108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        pk.NoProduksi,
        pk.Tanggal,
        pk.IdRegu,
        pk.OutputJenisId,
        pk.Shift,
        pk.HourStart,
        pk.HourEnd
      FROM dbo.PasangKunci_h pk WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE pk.IdMesin = m.IdMesin
        AND CONVERT(date, pk.Tanggal) = c.CurrentDate
        AND pk.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            pk.HourStart <= pk.HourEnd
            AND c.CurrentTime >= CAST(pk.HourStart AS time(0))
            AND c.CurrentTime < CAST(pk.HourEnd AS time(0))
          )
          OR
          (
            pk.HourStart > pk.HourEnd
            AND (
              c.CurrentTime >= CAST(pk.HourStart AS time(0))
              OR c.CurrentTime < CAST(pk.HourEnd AS time(0))
            )
          )
        )
      ORDER BY pk.HourStart DESC, pk.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstCabinetWIP cw WITH (NOLOCK)
      ON cw.IdCabinetWIP = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getSpannerByNoProduksi({
  idBagianMesin = 9,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      h.NoProduksi,
      CONVERT(date, h.Tanggal) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      mbj.NamaBJ  AS OutputJenisNama,
      mbj.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.SpannerOperator_d od WITH (NOLOCK)
            WHERE od.NoProduksi = h.NoProduksi
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.SpannerOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoProduksi = h.NoProduksi
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd,   108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd,   108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        sp.NoProduksi,
        sp.Tanggal,
        sp.IdRegu,
        sp.OutputJenisId,
        sp.Shift,
        sp.HourStart,
        sp.HourEnd
      FROM dbo.Spanner_h sp WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE sp.IdMesin = m.IdMesin
        AND CONVERT(date, sp.Tanggal) = c.CurrentDate
        AND sp.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            sp.HourStart <= sp.HourEnd
            AND c.CurrentTime >= CAST(sp.HourStart AS time(0))
            AND c.CurrentTime < CAST(sp.HourEnd AS time(0))
          )
          OR
          (
            sp.HourStart > sp.HourEnd
            AND (
              c.CurrentTime >= CAST(sp.HourStart AS time(0))
              OR c.CurrentTime < CAST(sp.HourEnd AS time(0))
            )
          )
        )
      ORDER BY sp.HourStart DESC, sp.NoProduksi DESC
    ) h
    LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
      ON mbj.IdBJ = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getPackingByNoProduksi({
  idBagianMesin = 6,
  includeDisabled = true,
}) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("IdBagianMesin", idBagianMesin);

  const whereEnable = includeDisabled ? "1=1" : "ISNULL(m.Enable, 1) = 1";

  const query = `
    ;WITH CurrentCtx AS (
      SELECT
        CONVERT(date, GETDATE()) AS CurrentDate,
        CAST(GETDATE() AS time(0)) AS CurrentTime
    ),
    LatestShiftSet AS (
      SELECT TOP 1
        h.IdShiftHourSet,
        h.ValidFrmDate
      FROM dbo.MstShiftHourSet h WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE CONVERT(date, h.ValidFrmDate) <= c.CurrentDate
      ORDER BY CONVERT(date, h.ValidFrmDate) DESC, h.IdShiftHourSet DESC
    ),
    ActiveShift AS (
      SELECT TOP 1
        d.NoShift,
        d.HourStart,
        d.HourEnd,
        ls.ValidFrmDate
      FROM LatestShiftSet ls
      INNER JOIN dbo.MstShiftHourSet_d d WITH (NOLOCK)
        ON d.IdShiftHourSet = ls.IdShiftHourSet
      CROSS JOIN CurrentCtx c
      WHERE
        (
          d.HourStart <= d.HourEnd
          AND c.CurrentTime >= CAST(d.HourStart AS time(0))
          AND c.CurrentTime < CAST(d.HourEnd AS time(0))
        )
        OR
        (
          d.HourStart > d.HourEnd
          AND (
            c.CurrentTime >= CAST(d.HourStart AS time(0))
            OR c.CurrentTime < CAST(d.HourEnd AS time(0))
          )
        )
      ORDER BY d.NoShift ASC
    )
    SELECT
      m.IdMesin,
      m.NamaMesin,
      m.Bagian,
      m.IdBagianMesin,
      h.NoPacking AS NoProduksi,
      CONVERT(date, h.Tanggal) AS TglProduksi,
      h.IdRegu,
      rg.NamaRegu,
      h.OutputJenisId,
      mbj.NamaBJ  AS OutputJenisNama,
      mbj.ItemCode AS OutputJenisItemCode,
      JSON_QUERY(
        COALESCE(
          (
            SELECT od.IdOperator AS [value]
            FROM dbo.PackingProduksiOperator_d od WITH (NOLOCK)
            WHERE od.NoPacking = h.NoPacking
            ORDER BY od.IdOperator
            FOR JSON PATH
          ),
          '[]'
        )
      ) AS IdOperators,
      COALESCE(
        (
          SELECT STRING_AGG(op.NamaOperator, ', ')
          FROM dbo.PackingProduksiOperator_d od WITH (NOLOCK)
          INNER JOIN dbo.MstOperator op WITH (NOLOCK)
            ON op.IdOperator = od.IdOperator
          WHERE od.NoPacking = h.NoPacking
        ),
        ''
      ) AS Operators,
      h.Shift,
      CONVERT(varchar(8), h.HourStart, 108) AS HourStart,
      CONVERT(varchar(8), h.HourEnd,   108) AS HourEnd,
      m.Target,
      CONVERT(varchar(10), c.CurrentDate, 23) AS CurrentDate,
      CONVERT(varchar(8), c.CurrentTime, 108) AS CurrentTime,
      s.NoShift AS ActiveShift,
      CONVERT(varchar(8), s.HourStart, 108) AS ActiveShiftHourStart,
      CONVERT(varchar(8), s.HourEnd,   108) AS ActiveShiftHourEnd,
      s.ValidFrmDate AS ActiveShiftValidFrmDate
    FROM dbo.MstMesin m WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        pk.NoPacking,
        pk.Tanggal,
        pk.IdRegu,
        pk.OutputJenisId,
        pk.Shift,
        pk.HourStart,
        pk.HourEnd
      FROM dbo.PackingProduksi_h pk WITH (NOLOCK)
      CROSS JOIN CurrentCtx c
      WHERE pk.IdMesin = m.IdMesin
        AND CONVERT(date, pk.Tanggal) = c.CurrentDate
        AND pk.Shift = (SELECT TOP 1 NoShift FROM ActiveShift)
        AND (
          (
            pk.HourStart <= pk.HourEnd
            AND c.CurrentTime >= CAST(pk.HourStart AS time(0))
            AND c.CurrentTime < CAST(pk.HourEnd AS time(0))
          )
          OR
          (
            pk.HourStart > pk.HourEnd
            AND (
              c.CurrentTime >= CAST(pk.HourStart AS time(0))
              OR c.CurrentTime < CAST(pk.HourEnd AS time(0))
            )
          )
        )
      ORDER BY pk.HourStart DESC, pk.NoPacking DESC
    ) h
    LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
      ON mbj.IdBJ = h.OutputJenisId
    LEFT JOIN dbo.MstRegu rg WITH (NOLOCK)
      ON rg.IdRegu = h.IdRegu
    OUTER APPLY (SELECT TOP 1 * FROM ActiveShift) s
    CROSS JOIN CurrentCtx c
    WHERE ${whereEnable}
      AND m.IdBagianMesin = @IdBagianMesin
    ORDER BY m.NamaMesin ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

module.exports = {
  getByIdBagian,
  getBrokerByNoProduksi,
  getWashingByNoProduksi,
  getCrusherByNoProduksi,
  getGilinganByNoProduksi,
  getMixerByNoProduksi,
  getInjectByNoProduksi,
  getStampingByNoProduksi,
  getSpannerByNoProduksi,
  getPasangKunciByNoProduksi,
  getPackingByNoProduksi,
};
