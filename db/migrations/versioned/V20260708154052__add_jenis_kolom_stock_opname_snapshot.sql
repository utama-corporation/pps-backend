-- Tambah kolom jenis ke tabel snapshot acuan stock-opname, agar snapshot bisa difilter per jenis
-- (stock-opname-v2: navigasi kategori -> jenis -> label). Nama kolom & tipe mengikuti
-- NamaKolomIdJenisDiLabel di MstKategori untuk kategori terkait.

IF COL_LENGTH('dbo.StockOpnameBahanBaku', 'IdJenisPlastik') IS NULL
    ALTER TABLE dbo.StockOpnameBahanBaku ADD IdJenisPlastik INT NULL;

IF COL_LENGTH('dbo.StockOpnameWashing', 'IdJenisPlastik') IS NULL
    ALTER TABLE dbo.StockOpnameWashing ADD IdJenisPlastik INT NULL;

IF COL_LENGTH('dbo.StockOpnameBroker', 'IdJenisPlastik') IS NULL
    ALTER TABLE dbo.StockOpnameBroker ADD IdJenisPlastik INT NULL;

IF COL_LENGTH('dbo.StockOpnameCrusher', 'IdCrusher') IS NULL
    ALTER TABLE dbo.StockOpnameCrusher ADD IdCrusher INT NULL;

IF COL_LENGTH('dbo.StockOpnameBonggolan', 'IdBonggolan') IS NULL
    ALTER TABLE dbo.StockOpnameBonggolan ADD IdBonggolan INT NULL;

IF COL_LENGTH('dbo.StockOpnameGilingan', 'IdGilingan') IS NULL
    ALTER TABLE dbo.StockOpnameGilingan ADD IdGilingan INT NULL;

IF COL_LENGTH('dbo.StockOpnameMixer', 'IdMixer') IS NULL
    ALTER TABLE dbo.StockOpnameMixer ADD IdMixer INT NULL;

IF COL_LENGTH('dbo.StockOpnameFurnitureWIP', 'IDFurnitureWIP') IS NULL
    ALTER TABLE dbo.StockOpnameFurnitureWIP ADD IDFurnitureWIP INT NULL;

IF COL_LENGTH('dbo.StockOpnameBarangJadi', 'IdBJ') IS NULL
    ALTER TABLE dbo.StockOpnameBarangJadi ADD IdBJ INT NULL;

IF COL_LENGTH('dbo.StockOpnameReject', 'IdReject') IS NULL
    ALTER TABLE dbo.StockOpnameReject ADD IdReject INT NULL;
