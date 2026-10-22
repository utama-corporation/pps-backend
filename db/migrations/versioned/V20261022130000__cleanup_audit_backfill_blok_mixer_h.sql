-- Bersihkan artefak audit yang dibuat oleh migrasi backfill Blok label Mixer
-- (V20261022120000__backfill_blok_mixer_h_from_audit.sql).
--
-- Saat backfill berjalan, trigger audit tetap menulis 1 baris UPDATE untuk
-- setiap label yang disentuh (752 baris). Baris tersebut hanya berisi
-- perubahan kolom Blok (dari NULL ke blok aslinya) — bukan perpindahan
-- label sungguhan, sehingga kalau dibiarkan akan muncul sebagai entri
-- "perpindahan lokasi" palsu di screen Mapping–Layout.
--
-- Kriteria (sempit, hanya artefak backfill):
--   - TableName = 'Mixer_h', Action = 'UPDATE'
--   - OldData tidak punya Blok (NULL), NewData punya Blok
--   - SELURUH key lain identik antara OldData dan NewData
--   - Actor = 'sa' dan RequestId IS NULL (script migrasi, bukan user aplikasi)
--   - EventTime = tanggal menjalankan migrasi backfill (22 Okt 2026)
--
-- Idempotent: baris yang tidak cocok tidak tersentuh.
SET NOCOUNT ON;

DELETE a
FROM dbo.AuditTrail a
WHERE a.TableName = 'Mixer_h'
  AND a.Action = 'UPDATE'
  AND a.EventTime >= '2026-10-22'
  AND a.EventTime < '2026-10-23'
  AND JSON_VALUE(a.OldData, '$.Blok') IS NULL
  AND JSON_VALUE(a.NewData, '$.Blok') IS NOT NULL
  AND JSON_MODIFY(a.OldData, '$.Blok', '') = JSON_MODIFY(a.NewData, '$.Blok', '')
  AND a.Actor = 'sa'
  AND a.RequestId IS NULL;

SELECT @@ROWCOUNT AS RowsDeleted;
GO
