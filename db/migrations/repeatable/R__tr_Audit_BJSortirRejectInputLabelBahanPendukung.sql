SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

/* ===== [dbo].[tr_Audit_BJSortirRejectInputLabelBahanPendukung] ON [dbo].[BJSortirRejectInputLabelBahanPendukung] =====
   AFTER INSERT, UPDATE, DELETE
   Action: CONSUME_FULL / UNCONSUME_FULL / UPDATE
   GROUPING: 1 row audit per (NoBJSortir, NoBahanPendukung) per statement
   PK JSON: { NoBJSortir, NoBahanPendukung }
   NewData/OldData: array of {NoBJSortir, NoBahanPendukung, Qty, IsPartial}

   Enrichment:
   - Qty, IsPartial diambil dari dbo.BahanPendukung (bp.Qty, bp.IsPartial)
*/
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BJSortirRejectInputLabelBahanPendukung]
ON [dbo].[BJSortirRejectInputLabelBahanPendukung]
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

  /* =========================================================
     1) INSERT-only rows => CONSUME_FULL (GROUPED)
     ========================================================= */
  ;WITH insOnly AS (
    SELECT i.*
    FROM inserted i
    LEFT JOIN deleted d
      ON d.NoBahanPendukung = i.NoBahanPendukung
    WHERE d.NoBahanPendukung IS NULL
  ),
  g AS (
    SELECT DISTINCT NoBJSortir, NoBahanPendukung
    FROM insOnly
  )
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'CONSUME_FULL',
    'BJSortirRejectInputLabelBahanPendukung',
    @actor,
    @rid,
    (SELECT gg.NoBJSortir, gg.NoBahanPendukung FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
    NULL,
    (
      SELECT
        x.NoBJSortir,
        x.NoBahanPendukung,
        CAST(bp.Qty AS decimal(18,3)) AS Qty,
        CAST(bp.IsPartial AS bit)     AS IsPartial
      FROM insOnly x
      LEFT JOIN dbo.BahanPendukung bp
        ON bp.NoBahanPendukung = x.NoBahanPendukung
      WHERE x.NoBahanPendukung = gg.NoBahanPendukung
      FOR JSON PATH
    )
  FROM g gg;

  /* =========================================================
     2) DELETE-only rows => UNCONSUME_FULL (GROUPED)
     ========================================================= */
  ;WITH delOnly AS (
    SELECT d.*
    FROM deleted d
    LEFT JOIN inserted i
      ON i.NoBahanPendukung = d.NoBahanPendukung
    WHERE i.NoBahanPendukung IS NULL
  ),
  g AS (
    SELECT DISTINCT NoBJSortir, NoBahanPendukung
    FROM delOnly
  )
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'UNCONSUME_FULL',
    'BJSortirRejectInputLabelBahanPendukung',
    @actor,
    @rid,
    (SELECT gg.NoBJSortir, gg.NoBahanPendukung FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
    (
      SELECT
        x.NoBJSortir,
        x.NoBahanPendukung,
        CAST(bp.Qty AS decimal(18,3)) AS Qty,
        CAST(bp.IsPartial AS bit)     AS IsPartial
      FROM delOnly x
      LEFT JOIN dbo.BahanPendukung bp
        ON bp.NoBahanPendukung = x.NoBahanPendukung
      WHERE x.NoBahanPendukung = gg.NoBahanPendukung
      FOR JSON PATH
    ),
    NULL
  FROM g gg;

  /* =========================================================
     3) UPDATE rows => UPDATE (GROUPED)
     ========================================================= */
  IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
  BEGIN
    ;WITH upd AS (
      SELECT i.NoBJSortir, i.NoBahanPendukung
      FROM inserted i
      JOIN deleted d
        ON d.NoBahanPendukung = i.NoBahanPendukung
    ),
    g AS (
      SELECT DISTINCT NoBJSortir, NoBahanPendukung
      FROM upd
    )
    INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
      'UPDATE',
      'BJSortirRejectInputLabelBahanPendukung',
      @actor,
      @rid,
      (SELECT gg.NoBJSortir, gg.NoBahanPendukung FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),

      (
        SELECT
          d.NoBJSortir,
          d.NoBahanPendukung,
          CAST(bp.Qty AS decimal(18,3)) AS Qty,
          CAST(bp.IsPartial AS bit)     AS IsPartial
        FROM deleted d
        LEFT JOIN dbo.BahanPendukung bp
          ON bp.NoBahanPendukung = d.NoBahanPendukung
        WHERE d.NoBahanPendukung = gg.NoBahanPendukung
        FOR JSON PATH
      ),

      (
        SELECT
          i.NoBJSortir,
          i.NoBahanPendukung,
          CAST(bp.Qty AS decimal(18,3)) AS Qty,
          CAST(bp.IsPartial AS bit)     AS IsPartial
        FROM inserted i
        LEFT JOIN dbo.BahanPendukung bp
          ON bp.NoBahanPendukung = i.NoBahanPendukung
        WHERE i.NoBahanPendukung = gg.NoBahanPendukung
        FOR JSON PATH
      )
    FROM g gg;
  END
END;
GO
