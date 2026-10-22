/* ===== [dbo].[tr_Audit_BarangDagang] ON [dbo].[BarangDagang] ===== */
-- =============================================
-- TRIGGER: tr_Audit_BarangDagang
-- AFTER INSERT, UPDATE, DELETE
-- Actor: SESSION_CONTEXT('actor_id') fallback SESSION_CONTEXT('actor') fallback SUSER_SNAME()
-- RequestId: SESSION_CONTEXT('request_id')
-- Mirror struktur tr_Audit_BahanPendukung.
-- =============================================
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BarangDagang]
ON [dbo].[BarangDagang]
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

  /* INSERT */
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'INSERT', 'BarangDagang', @actor, @rid,
    CONCAT('{"NoBarangDagang":"', i.NoBarangDagang, '"}'),
    NULL,
    (SELECT i.NoBarangDagang, i.IdSupplier, i.IdBarangDagang,
            CAST(i.Qty AS decimal(18,3)) AS Qty, i.Keterangan,
            i.IsPartial, i.DateUsage, i.CreateBy, i.CreatedAt,
            i.Blok, i.IdLokasi, i.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)
  FROM inserted i
  LEFT JOIN deleted d ON d.NoBarangDagang = i.NoBarangDagang
  WHERE d.NoBarangDagang IS NULL;

  /* UPDATE */
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'UPDATE', 'BarangDagang', @actor, @rid,
    CONCAT('{"NoBarangDagang":"', i.NoBarangDagang, '"}'),
    (SELECT d.NoBarangDagang, d.IdSupplier, d.IdBarangDagang,
            CAST(d.Qty AS decimal(18,3)) AS Qty, d.Keterangan,
            d.IsPartial, d.DateUsage, d.CreateBy, d.CreatedAt,
            d.Blok, d.IdLokasi, d.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES),
    (SELECT i.NoBarangDagang, i.IdSupplier, i.IdBarangDagang,
            CAST(i.Qty AS decimal(18,3)) AS Qty, i.Keterangan,
            i.IsPartial, i.DateUsage, i.CreateBy, i.CreatedAt,
            i.Blok, i.IdLokasi, i.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)
  FROM inserted i
  JOIN deleted d ON d.NoBarangDagang = i.NoBarangDagang;

  /* DELETE */
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'DELETE', 'BarangDagang', @actor, @rid,
    CONCAT('{"NoBarangDagang":"', d.NoBarangDagang, '"}'),
    (SELECT d.NoBarangDagang, d.IdSupplier, d.IdBarangDagang,
            CAST(d.Qty AS decimal(18,3)) AS Qty, d.Keterangan,
            d.IsPartial, d.DateUsage, d.CreateBy, d.CreatedAt,
            d.Blok, d.IdLokasi, d.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES),
    NULL
  FROM deleted d
  LEFT JOIN inserted i ON i.NoBarangDagang = d.NoBarangDagang
  WHERE i.NoBarangDagang IS NULL;

END;
GO
