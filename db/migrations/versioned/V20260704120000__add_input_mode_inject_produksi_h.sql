-- Tambah kolom InputMode ke header InjectProduksi_h.
-- Menandai apakah header dibuat secara real-time atau backdate (input mundur).
-- Baris lama otomatis terisi 'backdate' via default (selaras dengan default aplikasi).
-- Nilai valid dibatasi lewat CHECK constraint: 'realtime' | 'backdate'.
ALTER TABLE [dbo].[InjectProduksi_h]
    ADD [InputMode] VARCHAR(20) NOT NULL
        CONSTRAINT [DF_InjectProduksi_h_InputMode] DEFAULT ('backdate');
GO

ALTER TABLE [dbo].[InjectProduksi_h] WITH CHECK
    ADD CONSTRAINT [CK_InjectProduksi_h_InputMode]
        CHECK ([InputMode] IN ('realtime', 'backdate'));
GO
