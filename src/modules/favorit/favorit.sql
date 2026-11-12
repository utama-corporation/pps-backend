/* Tabel favorit per user (menu Favorit di PPS Tablet).
 * tipe  : 'laporan' (kode = path/route item laporan) atau 'menu' (kode = route layar)
 * kode  : entri identifikasi favorit
 * urutan: urutan tampil (1..n) per user
 * Aman dijalankan ulang. Cerminan dari WPS_TEST3.dbo.MstUserFavorit. */
IF OBJECT_ID('dbo.MstUserFavorit', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.MstUserFavorit (
    IdUsername INT          NOT NULL,
    Tipe       VARCHAR(20)  NOT NULL,
    Kode       VARCHAR(200) NOT NULL,
    Urutan     INT          NOT NULL,
    Komentar   NVARCHAR(500) NULL,
    CONSTRAINT PK_MstUserFavorit PRIMARY KEY (IdUsername, Tipe, Kode)
  );
END
