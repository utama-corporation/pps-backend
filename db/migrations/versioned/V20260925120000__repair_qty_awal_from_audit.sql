-- ================================================================
-- Migration: Repair QtyAwal dari audit trail (INSERT pembuat baris live)
-- ================================================================
-- Backfill awal (V20260925110000) sekadar menyalin Qty (sisa stok saat
-- ini) ke QtyAwal. Untuk label yang SUDAH terpotong konsumsi parsial di
-- proses produksi, itu SALAH — QtyAwal jadi ikut mengecil padahal harus
-- tetap kuantitas asli saat penerimaan.
--
-- Nilai asli penerimaan dapat direkonstruksi dari AuditTrail: baris
-- INSERT (Action='INSERT', OldData IS NULL) yang menciptakan baris yang
-- SAAT INI masih hidup merekam Qty awal (dalam JSON NewData). Karena
-- nomor label bisa dihapus lalu di-INSERT ulang (siklus delete/recreate),
-- INSERT PERTAMA belum tentu milik baris live — jadi dipakai INSERT
-- TERAKHIR per NoBahanPendukung (AuditId tertinggi, identik dengan baris
-- yang ada sekarang). Migration ini menimpa QtyAwal dengan nilai tersebut.
--
-- Label tanpa catatan INSERT di audit (mis. dibuat sebelum trigger audit
-- aktif / sudah terhapus) dibiarkan memakai nilai backfill lama.
-- ================================================================

UPDATE b
SET b.QtyAwal = t.OrigQty
FROM dbo.BahanPendukung b
INNER JOIN (
    SELECT
        JSON_VALUE(a.PK, '$.NoBahanPendukung') AS NoBahanPendukung,
        CAST(JSON_VALUE(a.NewData, '$.Qty') AS decimal(18,3)) AS OrigQty,
        ROW_NUMBER() OVER (
            PARTITION BY JSON_VALUE(a.PK, '$.NoBahanPendukung')
            ORDER BY a.AuditId DESC
        ) AS rn
    FROM dbo.AuditTrail a WITH (NOLOCK)
    WHERE a.TableName = 'BahanPendukung'
      AND a.Action = 'INSERT'
      AND a.OldData IS NULL
      AND a.NewData IS NOT NULL
      AND ISJSON(a.NewData) = 1
      AND ISJSON(a.PK) = 1
      AND JSON_VALUE(a.NewData, '$.Qty') IS NOT NULL
) t ON t.NoBahanPendukung = b.NoBahanPendukung
   AND t.rn = 1
WHERE b.QtyAwal IS NULL OR b.QtyAwal <> t.OrigQty;
GO