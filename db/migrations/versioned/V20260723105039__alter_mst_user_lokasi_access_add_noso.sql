-- MstUserLokasiAccess berubah sifat: dari assignment permanen menjadi
-- penugasan sementara PER SESI stock opname (NoSO). Kepala gudang menugaskan
-- user ke lokasi untuk NoSO tertentu; begitu NoSO tsb ditandai selesai,
-- aplikasi menghapus baris terkait (lihat completeStockOpname di
-- stock-opname-v2-service.js) sehingga baris yang tersisa di tabel ini
-- selalu berarti "masih berjalan".

ALTER TABLE [dbo].[MstUserLokasiAccess] DROP CONSTRAINT PK_MstUserLokasiAccess;
GO

ALTER TABLE [dbo].[MstUserLokasiAccess]
    ADD NoSO VARCHAR(20) NOT NULL CONSTRAINT DF_MstUserLokasiAccess_NoSO DEFAULT '';
GO

ALTER TABLE [dbo].[MstUserLokasiAccess]
    ADD CONSTRAINT PK_MstUserLokasiAccess PRIMARY KEY CLUSTERED (NoSO, Blok, IdLokasi, IdUsername);
GO
