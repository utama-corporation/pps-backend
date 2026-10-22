-- Backfill kolom Blok pada header label Mixer yang hilang (NULL) akibat bug
-- di endpoint update label mixer (PUT /api/labels/mixer/:nomixer):
-- kolom Blok ikut di-update NULL setiap kali QC diinput karena payload QC
-- tidak mengirim Blok. Akibatnya:
--   1) label hilang dari screen Mapping–Layout (filter `Blok = @blok`),
--   2) riwayat perpindahan lokasi di dbo.AuditTrail mencatat "blok dihapus".
--
-- Sumber kebenaran = nilai Blok terakhir yang tercatat di dbo.AuditTrail
-- (NewData pada event INSERT/UPDATE). Pasangan (Blok, IdLokasi) hasil
-- backfill diverifikasi terhadap dbo.MstLokasi supaya tidak menghasilkan
-- lokasi yang tidak ada.
--
-- Script ini IDEMPOTENT: baris yang sudah punya Blok tidak tersentuh,
-- jadi aman dijalankan berulang.
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#LastBlokAudit') IS NOT NULL DROP TABLE #LastBlokAudit;

;WITH aud AS (
    SELECT
        j.[value] AS NoMixer,
        JSON_VALUE(a.NewData, '$.Blok') AS Blok,
        ROW_NUMBER() OVER (
            PARTITION BY j.[value]
            ORDER BY a.AuditId DESC
        ) AS rn
    FROM dbo.AuditTrail a
    CROSS APPLY OPENJSON(a.PK) j
    WHERE a.TableName = 'Mixer_h'
      AND a.PK IS NOT NULL
      AND a.NewData IS NOT NULL
      AND JSON_VALUE(a.NewData, '$.Blok') IS NOT NULL
)
SELECT NoMixer, Blok
INTO #LastBlokAudit
FROM aud
WHERE rn = 1;

UPDATE m
SET m.Blok = lb.Blok
FROM dbo.Mixer_h m
INNER JOIN #LastBlokAudit lb ON lb.NoMixer = m.NoMixer
WHERE m.Blok IS NULL
  AND m.IdLokasi IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM dbo.MstLokasi l
      WHERE l.Blok = lb.Blok
        AND l.IdLokasi = m.IdLokasi
  );

SELECT @@ROWCOUNT AS RowsBackfilled;

DROP TABLE #LastBlokAudit;
GO
