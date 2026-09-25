/* ===== [dbo].[tr_Audit_BahanPendukung] ON [dbo].[BahanPendukung] ===== */
-- =============================================
-- TRIGGER: tr_Audit_BahanPendukung
-- AFTER INSERT, UPDATE, DELETE
-- Actor: SESSION_CONTEXT('actor_id') fallback SESSION_CONTEXT('actor') fallback SUSER_SNAME()
-- RequestId: SESSION_CONTEXT('request_id')
-- Mirror struktur tr_Audit_FurnitureWIP.
-- =============================================
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BahanPendukung]
ON [dbo].[BahanPendukung]
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
    'INSERT', 'BahanPendukung', @actor, @rid,
    CONCAT('{"NoBahanPendukung":"', i.NoBahanPendukung, '"}'),
    NULL,
    (SELECT i.NoBahanPendukung, i.IdSupplier, i.IdCabinetMaterial,
            CAST(i.Qty AS decimal(18,3)) AS Qty,
            CAST(i.QtyAwal AS decimal(18,3)) AS QtyAwal, i.Keterangan,
            i.IsPartial, i.DateUsage, i.CreateBy, i.CreatedAt,
            i.Blok, i.IdLokasi, i.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
  FROM inserted i
  LEFT JOIN deleted d ON d.NoBahanPendukung = i.NoBahanPendukung
  WHERE d.NoBahanPendukung IS NULL;

  /* UPDATE */
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'UPDATE', 'BahanPendukung', @actor, @rid,
    CONCAT('{"NoBahanPendukung":"', i.NoBahanPendukung, '"}'),
    (SELECT d.NoBahanPendukung, d.IdSupplier, d.IdCabinetMaterial,
            CAST(d.Qty AS decimal(18,3)) AS Qty,
            CAST(d.QtyAwal AS decimal(18,3)) AS QtyAwal, d.Keterangan,
            d.IsPartial, d.DateUsage, d.CreateBy, d.CreatedAt,
            d.Blok, d.IdLokasi, d.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
    (SELECT i.NoBahanPendukung, i.IdSupplier, i.IdCabinetMaterial,
            CAST(i.Qty AS decimal(18,3)) AS Qty,
            CAST(i.QtyAwal AS decimal(18,3)) AS QtyAwal, i.Keterangan,
            i.IsPartial, i.DateUsage, i.CreateBy, i.CreatedAt,
            i.Blok, i.IdLokasi, i.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
  FROM inserted i
  JOIN deleted d ON d.NoBahanPendukung = i.NoBahanPendukung;

  /* DELETE */
  INSERT dbo.AuditTrail(Action, TableName, Actor, RequestId, PK, OldData, NewData)
  SELECT
    'DELETE', 'BahanPendukung', @actor, @rid,
    CONCAT('{"NoBahanPendukung":"', d.NoBahanPendukung, '"}'),
    (SELECT d.NoBahanPendukung, d.IdSupplier, d.IdCabinetMaterial,
            CAST(d.Qty AS decimal(18,3)) AS Qty,
            CAST(d.QtyAwal AS decimal(18,3)) AS QtyAwal, d.Keterangan,
            d.IsPartial, d.DateUsage, d.CreateBy, d.CreatedAt,
            d.Blok, d.IdLokasi, d.HasBeenPrinted
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
    NULL
  FROM deleted d
  LEFT JOIN inserted i ON i.NoBahanPendukung = d.NoBahanPendukung
  WHERE i.NoBahanPendukung IS NULL;

END;
GO
