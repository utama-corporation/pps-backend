-- stock-opname-v2: catat lokasi fisik (Blok/IdLokasi) tempat label ditemukan saat scan,
-- terpisah dari Blok/IdLokasi acuan di tabel snapshot (StockOpname{Kategori}). Ini murni
-- audit trail (append-only, tidak menimpa lokasi snapshot maupun tabel master label) --
-- selisih terhadap lokasi acuan dihitung saat baca, bukan disimpan sebagai flag di sini.

ALTER TABLE dbo.StockOpnameHasilBahanBaku ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilWashing ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilBroker ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilCrusher ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilBonggolan ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilGilingan ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilMixer ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilFurnitureWIP ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilBarangJadi ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
ALTER TABLE dbo.StockOpnameHasilReject ADD ScannedBlok VARCHAR(3) NULL, ScannedIdLokasi INT NULL;
