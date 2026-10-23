SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

/* ===== [dbo].[tr_Audit_BJReturV3Item_d] ON [dbo].[BJReturV3Item_d] ===== */
-- =============================================
-- TRIGGER: tr_Audit_BJReturV3Item_d
-- AFTER INSERT, UPDATE, DELETE
-- Actor: SESSION_CONTEXT('actor_id') fallback SESSION_CONTEXT('actor') fallback SUSER_SNAME()
-- RequestId: SESSION_CONTEXT('request_id')
-- PK: {"IdItem":...}
-- =============================================
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BJReturV3Item_d]
ON [dbo].[BJReturV3Item_d]
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
        'BJReturV3Item_d',
        @actor,
        @rid,
        CONCAT('{"IdItem":', i.IdItem, '}'),
        NULL,
        (
            SELECT
                i.IdItem,
                i.NoRetur,
                i.KodeKategori,
                i.IdJenis,
                i.Pcs,
                i.KategoriInput,
                i.Berat,
                i.IdReject,
                i.GeneratedLabelCode,
                i.Decision
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )
    FROM inserted i
    LEFT JOIN deleted d ON d.IdItem = i.IdItem
    WHERE d.IdItem IS NULL;

    /* =====================
       UPDATE
    ===================== */
    INSERT dbo.AuditTrail (Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
        'UPDATE',
        'BJReturV3Item_d',
        @actor,
        @rid,
        CONCAT('{"IdItem":', i.IdItem, '}'),
        (
            SELECT
                d.IdItem,
                d.NoRetur,
                d.KodeKategori,
                d.IdJenis,
                d.Pcs,
                d.KategoriInput,
                d.Berat,
                d.IdReject,
                d.GeneratedLabelCode,
                d.Decision
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        ),
        (
            SELECT
                i.IdItem,
                i.NoRetur,
                i.KodeKategori,
                i.IdJenis,
                i.Pcs,
                i.KategoriInput,
                i.Berat,
                i.IdReject,
                i.GeneratedLabelCode,
                i.Decision
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )
    FROM inserted i
    JOIN deleted d ON d.IdItem = i.IdItem;

    /* =====================
       DELETE
    ===================== */
    INSERT dbo.AuditTrail (Action, TableName, Actor, RequestId, PK, OldData, NewData)
    SELECT
        'DELETE',
        'BJReturV3Item_d',
        @actor,
        @rid,
        CONCAT('{"IdItem":', d.IdItem, '}'),
        (
            SELECT
                d.IdItem,
                d.NoRetur,
                d.KodeKategori,
                d.IdJenis,
                d.Pcs,
                d.KategoriInput,
                d.Berat,
                d.IdReject,
                d.GeneratedLabelCode,
                d.Decision
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        ),
        NULL
    FROM deleted d
    LEFT JOIN inserted i ON i.IdItem = d.IdItem
    WHERE i.IdItem IS NULL;
END;
GO
