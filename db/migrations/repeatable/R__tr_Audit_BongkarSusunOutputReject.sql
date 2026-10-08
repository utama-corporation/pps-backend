/* ===== [dbo].[tr_Audit_BongkarSusunOutputReject]
         ON [dbo].[BongkarSusunOutputReject] ===== */
-- =============================================
-- TRIGGER: tr_Audit_BongkarSusunOutputReject
-- PK     : NoReject + NoBongkarSusun
-- MODE   : AGGREGATED
-- EXTRA  : Join RejectV2 untuk ambil Berat
-- =============================================
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BongkarSusunOutputReject]
ON [dbo].[BongkarSusunOutputReject]
AFTER INSERT, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor NVARCHAR(128) =
        COALESCE(
            CONVERT(NVARCHAR(128), TRY_CONVERT(INT, SESSION_CONTEXT(N'actor_id'))),
            CAST(SESSION_CONTEXT(N'actor') AS NVARCHAR(128)),
            SUSER_SNAME()
        );

    DECLARE @rid NVARCHAR(64) =
        CAST(SESSION_CONTEXT(N'request_id') AS NVARCHAR(64));

    /* =========================================================
       PRODUCE (INSERT ONLY, AGGREGATED)
       ========================================================= */
    IF EXISTS (SELECT 1 FROM inserted)
       AND NOT EXISTS (SELECT 1 FROM deleted)
    BEGIN
        INSERT dbo.AuditTrail
            (Action, TableName, Actor, RequestId, PK, OldData, NewData)
        SELECT
            'PRODUCE',
            'BongkarSusunOutputReject',
            @actor,
            @rid,
            (
                SELECT
                    i.NoReject,
                    i.NoBongkarSusun
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            ),
            NULL,
            (
                SELECT
                    i.NoReject,
                    i.NoBongkarSusun,
                    CAST(r.Berat AS decimal(18,3)) AS Berat
                FROM inserted i
                LEFT JOIN dbo.RejectV2 r
                       ON r.NoReject = i.NoReject
                FOR JSON PATH
            )
        FROM inserted i
        GROUP BY i.NoReject, i.NoBongkarSusun;
    END;

    /* =========================================================
       UNPRODUCE (DELETE ONLY, AGGREGATED)
       ========================================================= */
    IF EXISTS (SELECT 1 FROM deleted)
       AND NOT EXISTS (SELECT 1 FROM inserted)
    BEGIN
        INSERT dbo.AuditTrail
            (Action, TableName, Actor, RequestId, PK, OldData, NewData)
        SELECT
            'UNPRODUCE',
            'BongkarSusunOutputReject',
            @actor,
            @rid,
            (
                SELECT
                    d.NoReject,
                    d.NoBongkarSusun
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            ),
            (
                SELECT
                    d.NoReject,
                    d.NoBongkarSusun,
                    CAST(r.Berat AS decimal(18,3)) AS Berat
                FROM deleted d
                LEFT JOIN dbo.RejectV2 r
                       ON r.NoReject = d.NoReject
                FOR JSON PATH
            ),
            NULL
        FROM deleted d
        GROUP BY d.NoReject, d.NoBongkarSusun;
    END;
END;
GO