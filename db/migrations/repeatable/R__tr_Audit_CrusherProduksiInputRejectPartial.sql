/* ===== [dbo].[tr_Audit_CrusherProduksiInputRejectPartial] ON [dbo].[CrusherProduksiInputRejectPartial] =====
   AFTER INSERT, UPDATE, DELETE
   Action: CONSUME_PARTIAL / UNCONSUME_PARTIAL / UPDATE

   NOTE:
   - AuditTrail 1 row per statement per (NoCrusherProduksi, NoRejectPartial)
   - PK: (NoCrusherProduksi, NoReject, NoRejectPartial)
*/
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_CrusherProduksiInputRejectPartial]
ON [dbo].[CrusherProduksiInputRejectPartial]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @actor nvarchar(128) =
    COALESCE(
      CONVERT(nvarchar(128), TRY_CONVERT(int, SESSION_CONTEXT(N'actor_id'))),
      CAST(SESSION_CONTEXT(N'actor') AS nvarchar(128)),
      SUSER_SNAME()
    );

  DECLARE @rid nvarchar(64) =
    CAST(SESSION_CONTEXT(N'request_id') AS nvarchar(64));

  /* ======================================================
     INSERT-only => CONSUME_PARTIAL (GROUPED)
     1 row per (NoCrusherProduksi, NoRejectPartial)
  ====================================================== */
  ;WITH insOnly AS (
    SELECT i.NoCrusherProduksi, i.NoRejectPartial
    FROM inserted i
    WHERE NOT EXISTS (
      SELECT 1
      FROM deleted d
      WHERE d.NoCrusherProduksi = i.NoCrusherProduksi
        AND d.NoRejectPartial = i.NoRejectPartial
    )
  ),
  grp AS (
    SELECT DISTINCT NoCrusherProduksi, NoRejectPartial
    FROM insOnly
  )
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'CONSUME_PARTIAL',
    'CrusherProduksiInputRejectPartial',
    @actor,
    @rid,
    CONCAT(
      '{"NoCrusherProduksi":"', g.NoCrusherProduksi,
      '","NoReject":', CASE WHEN rp.NoReject IS NULL THEN 'null' ELSE CONCAT('"', rp.NoReject, '"') END,
      ',"NoRejectPartial":"', g.NoRejectPartial,
      '"}'
    ),
    NULL,
    COALESCE((
      SELECT
        i2.NoCrusherProduksi,
        i2.NoRejectPartial,
        rp2.NoReject,
        CAST(rp2.Berat AS decimal(18,3)) AS Berat
      FROM inserted i2
      LEFT JOIN dbo.RejectV2Partial rp2
        ON rp2.NoRejectPartial = i2.NoRejectPartial
      WHERE i2.NoCrusherProduksi = g.NoCrusherProduksi
        AND i2.NoRejectPartial = g.NoRejectPartial
      FOR JSON PATH
    ), '[]')
  FROM grp g
  LEFT JOIN dbo.RejectV2Partial rp
    ON rp.NoRejectPartial = g.NoRejectPartial;

  /* ======================================================
     DELETE-only => UNCONSUME_PARTIAL (GROUPED)
     1 row per (NoCrusherProduksi, NoRejectPartial)
  ====================================================== */
  ;WITH delOnly AS (
    SELECT d.NoCrusherProduksi, d.NoRejectPartial
    FROM deleted d
    WHERE NOT EXISTS (
      SELECT 1
      FROM inserted i
      WHERE i.NoCrusherProduksi = d.NoCrusherProduksi
        AND i.NoRejectPartial = d.NoRejectPartial
    )
  ),
  grp AS (
    SELECT DISTINCT NoCrusherProduksi, NoRejectPartial
    FROM delOnly
  )
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'UNCONSUME_PARTIAL',
    'CrusherProduksiInputRejectPartial',
    @actor,
    @rid,
    CONCAT(
      '{"NoCrusherProduksi":"', g.NoCrusherProduksi,
      '","NoReject":', CASE WHEN rp.NoReject IS NULL THEN 'null' ELSE CONCAT('"', rp.NoReject, '"') END,
      ',"NoRejectPartial":"', g.NoRejectPartial,
      '"}'
    ),
    COALESCE((
      SELECT
        d2.NoCrusherProduksi,
        d2.NoRejectPartial,
        rp2.NoReject,
        CAST(rp2.Berat AS decimal(18,3)) AS Berat
      FROM deleted d2
      LEFT JOIN dbo.RejectV2Partial rp2
        ON rp2.NoRejectPartial = d2.NoRejectPartial
      WHERE d2.NoCrusherProduksi = g.NoCrusherProduksi
        AND d2.NoRejectPartial = g.NoRejectPartial
      FOR JSON PATH
    ), '[]'),
    NULL
  FROM grp g
  LEFT JOIN dbo.RejectV2Partial rp
    ON rp.NoRejectPartial = g.NoRejectPartial;

  /* ======================================================
     UPDATE => UPDATE (GROUPED)
     1 row per (NoCrusherProduksi, NoRejectPartial)
  ====================================================== */
  IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
  BEGIN
    ;WITH grp AS (
      SELECT DISTINCT i.NoCrusherProduksi, i.NoRejectPartial
      FROM inserted i
      JOIN deleted d
        ON d.NoCrusherProduksi = i.NoCrusherProduksi
       AND d.NoRejectPartial = i.NoRejectPartial
    )
    INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
      'UPDATE',
      'CrusherProduksiInputRejectPartial',
      @actor,
      @rid,
      CONCAT(
        '{"NoCrusherProduksi":"', g.NoCrusherProduksi,
        '","NoReject":', CASE WHEN rp.NoReject IS NULL THEN 'null' ELSE CONCAT('"', rp.NoReject, '"') END,
        ',"NoRejectPartial":"', g.NoRejectPartial,
        '"}'
      ),
      COALESCE((
        SELECT
          d2.NoCrusherProduksi,
          d2.NoRejectPartial,
          rp2.NoReject,
          CAST(rp2.Berat AS decimal(18,3)) AS Berat
        FROM deleted d2
        LEFT JOIN dbo.RejectV2Partial rp2
          ON rp2.NoRejectPartial = d2.NoRejectPartial
        WHERE d2.NoCrusherProduksi = g.NoCrusherProduksi
          AND d2.NoRejectPartial = g.NoRejectPartial
        FOR JSON PATH
      ), '[]'),
      COALESCE((
        SELECT
          i2.NoCrusherProduksi,
          i2.NoRejectPartial,
          rp2.NoReject,
          CAST(rp2.Berat AS decimal(18,3)) AS Berat
        FROM inserted i2
        LEFT JOIN dbo.RejectV2Partial rp2
          ON rp2.NoRejectPartial = i2.NoRejectPartial
        WHERE i2.NoCrusherProduksi = g.NoCrusherProduksi
          AND i2.NoRejectPartial = g.NoRejectPartial
        FOR JSON PATH
      ), '[]')
    FROM grp g
    LEFT JOIN dbo.RejectV2Partial rp
      ON rp.NoRejectPartial = g.NoRejectPartial;
  END
END;
GO
