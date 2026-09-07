-- Modul inject disederhanakan: complete / uncomplete cukup memakai kolom
-- IsComplete saja (seragam dengan modul produksi lain). Alur approval
-- (CompleteRequestStatus / CompleteRequestedBy / CompleteRequestedAt /
-- CompleteDecisionBy / CompleteDecisionAt) tidak pernah dipakai, jadi dibuang.
--
-- Guard IF EXISTS / IF COL_LENGTH agar idempotent & aman meski sudah didrop manual.

IF EXISTS (
    SELECT 1
    FROM sys.default_constraints
    WHERE name = 'DF_InjectProduksi_h_CompleteRequestStatus'
)
    ALTER TABLE dbo.InjectProduksi_h
        DROP CONSTRAINT DF_InjectProduksi_h_CompleteRequestStatus;
GO

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteRequestStatus') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteRequestStatus;

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteRequestedBy') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteRequestedBy;

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteRequestedAt') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteRequestedAt;

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteDecisionBy') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteDecisionBy;

IF COL_LENGTH('dbo.InjectProduksi_h', 'CompleteDecisionAt') IS NOT NULL
    ALTER TABLE dbo.InjectProduksi_h DROP COLUMN CompleteDecisionAt;
GO
