/* ===== [dbo].[tr_Audit_BongkarSusunOutputBroker]
         ON [dbo].[BongkarSusunOutputBroker] ===== */
-- =============================================
-- TRIGGER: tr_Audit_BongkarSusunOutputBroker
-- PK     : NoBroker + NoBongkarSusun
-- MODE   : AGGREGATED
-- EXTRA  : Join Broker_d untuk ambil Berat
-- =============================================
CREATE OR ALTER TRIGGER [dbo].[tr_Audit_BongkarSusunOutputBroker]
ON [dbo].[BongkarSusunOutputBroker]
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
            'BongkarSusunOutputBroker',
            @actor,
            @rid,
            (
                SELECT
                    i.NoBroker,
                    i.NoBongkarSusun
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            ),
            NULL,
            (
                SELECT
                    i.NoBroker,
                    i.NoBongkarSusun,
                    i.NoSak,
                    bd.Berat
                FROM inserted i
                LEFT JOIN dbo.Broker_d bd
                       ON bd.NoBroker = i.NoBroker
                      AND bd.NoSak    = i.NoSak
                FOR JSON PATH
            )
        FROM inserted i
        GROUP BY i.NoBroker, i.NoBongkarSusun;
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
            'BongkarSusunOutputBroker',
            @actor,
            @rid,
            (
                SELECT
                    d.NoBroker,
                    d.NoBongkarSusun
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            ),
            (
                SELECT
                    d.NoBroker,
                    d.NoBongkarSusun,
                    d.NoSak,
                    bd.Berat
                FROM deleted d
                LEFT JOIN dbo.Broker_d bd
                       ON bd.NoBroker = d.NoBroker
                      AND bd.NoSak    = d.NoSak
                FOR JSON PATH
            ),
            NULL
        FROM deleted d
        GROUP BY d.NoBroker, d.NoBongkarSusun;
    END;
END;
GO
