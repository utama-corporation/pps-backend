SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

/* ===== [dbo].[tr_Audit_BJReturV3Turnover_d] ON [dbo].[BJReturV3Turnover_d] ===== */
-- =============================================
-- TRIGGER: tr_Audit_BJReturV3Turnover_d
-- AFTER INSERT, UPDATE, DELETE
-- Actor: SESSION_CONTEXT('actor_id') fallback SESSION_CONTEXT('actor') fallback SUSER_SNAME()
-- RequestId: SESSION_CONTEXT('request_id')
-- PK: {"IdTurnover":...}
-- =============================================
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BJReturV3Turnover_d]
ON [dbo].[BJReturV3Turnover_d]
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

    /* =====================
       INSERT
    ===================== */
    INSERT dbo.AuditTrail (Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
        'INSERT',
        'BJReturV3Turnover_d',
        @actor,
        @rid,
        CONCAT('{"IdTurnover":', i.IdTurnover, '}'),
        NULL,
        (
            SELECT
                i.IdTurnover,
                i.NoRetur,
                i.IdItem,
                i.LabelCode,
                i.NoPartial,
                i.Pcs,
                i.ScanBy
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )
    FROM inserted i
    LEFT JOIN deleted d ON d.IdTurnover = i.IdTurnover
    WHERE d.IdTurnover IS NULL;

    /* =====================
       UPDATE
    ===================== */
    INSERT dbo.AuditTrail (Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
        'UPDATE',
        'BJReturV3Turnover_d',
        @actor,
        @rid,
        CONCAT('{"IdTurnover":', i.IdTurnover, '}'),
        (
            SELECT
                d.IdTurnover,
                d.NoRetur,
                d.IdItem,
                d.LabelCode,
                d.NoPartial,
                d.Pcs,
                d.ScanBy
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        ),
        (
            SELECT
                i.IdTurnover,
                i.NoRetur,
                i.IdItem,
                i.LabelCode,
                i.NoPartial,
                i.Pcs,
                i.ScanBy
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )
    FROM inserted i
    JOIN deleted d ON d.IdTurnover = i.IdTurnover;

    /* =====================
       DELETE
    ===================== */
    INSERT dbo.AuditTrail (Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
        'DELETE',
        'BJReturV3Turnover_d',
        @actor,
        @rid,
        CONCAT('{"IdTurnover":', d.IdTurnover, '}'),
        (
            SELECT
                d.IdTurnover,
                d.NoRetur,
                d.IdItem,
                d.LabelCode,
                d.NoPartial,
                d.Pcs,
                d.ScanBy
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        ),
        NULL
    FROM deleted d
    LEFT JOIN inserted i ON i.IdTurnover = d.IdTurnover
    WHERE i.IdTurnover IS NULL;
END;
GO
