-- Fitur verifikasi baru ada mulai migrasi ini; data lama yang sudah IsComplete=1
-- tidak pernah melalui alur verifikasi manual. Supaya menu Verifikasi tidak
-- kebanjiran backlog produksi lama, tandai sebagai "legacy verified" di sini.
-- VerifiedBy dibiarkan NULL karena tidak ada aktor manusia yang memverifikasi.
UPDATE dbo.WashingProduksi_h
SET VerifiedAt = SYSUTCDATETIME(),
    VerifiedNote = 'Legacy data'
WHERE IsComplete = 1
  AND VerifiedAt IS NULL;
GO
