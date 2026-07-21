-- ================================================================
-- Migration: Create MstUserLokasiAccess
-- ================================================================
-- Assignment user -> lokasi (Blok, IdLokasi) yang boleh diakses.
-- Dipakai untuk gating endpoint stock-opname-v2 label per lokasi:
-- GET /stock-opname-v2/transaksi/:no/blok/:blok/lokasi/:locationId/label

CREATE TABLE [dbo].[MstUserLokasiAccess] (
    Blok       VARCHAR(100) NOT NULL,
    IdLokasi   INT          NOT NULL,
    IdUsername INT          NOT NULL,
    CreatedAt  DATETIME     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_MstUserLokasiAccess PRIMARY KEY CLUSTERED (Blok, IdLokasi, IdUsername)
);
GO
