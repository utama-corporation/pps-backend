// bahan-pendukung-write.repository.js
// Mirror struktur furniture-wip-write.repository.js. Tabel dbo.BahanPendukung
// menggabungkan struktur label (nomor sequence, print counter, status
// pemakaian) dengan atribut isi barang (Supplier, Qty, Keterangan) —
// sejak PenerimaanBahanPendukung_d disederhanakan jadi pengikat tipis
// (lihat V20260821160847), tidak ada lagi tabel junction terpisah:
// PenerimaanBahanPendukung_d.NoBahanPendukung langsung FK ke sini.
const { sql } = require("../../../../core/config/db");

exports.insertBahanPendukungHeader = async (
  tx,
  { noBahanPendukung, header, nowDateTime },
) => {
  await new sql.Request(tx)
    .input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung)
    .input("IdSupplier", sql.Int, header.IdSupplier)
    .input("IdCabinetMaterial", sql.Int, header.IdCabinetMaterial)
    .input("Qty", sql.Decimal(18, 3), header.Qty)
    .input("QtyAwal", sql.Decimal(18, 3), header.QtyAwal ?? header.Qty)
    .input("Keterangan", sql.NVarChar(200), header.Keterangan ?? null)
    .input("IsPartial", sql.Bit, header.IsPartial ?? 0)
    .input("CreateBy", sql.VarChar(100), header.CreateBy)
    .input("CreatedAt", sql.DateTime, nowDateTime)
    .input("Blok", sql.VarChar(50), header.Blok ?? null)
    .input("IdLokasi", sql.Int, header.IdLokasi ?? null).query(`
      INSERT INTO dbo.BahanPendukung (
        NoBahanPendukung, IdSupplier, IdCabinetMaterial,
        Qty, QtyAwal, Keterangan, IsPartial, DateUsage,
        CreateBy, CreatedAt, Blok, IdLokasi
      )
      VALUES (
        @NoBahanPendukung, @IdSupplier, @IdCabinetMaterial,
        @Qty, @QtyAwal, @Keterangan, @IsPartial, NULL,
        @CreateBy, @CreatedAt, @Blok, @IdLokasi
      );
    `);
};

exports.updateBahanPendukungHeader = async (tx, noBahanPendukung, merged) => {
  await new sql.Request(tx)
    .input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung)
    .input("IdSupplier", sql.Int, merged.IdSupplier)
    .input("IdCabinetMaterial", sql.Int, merged.IdCabinetMaterial)
    .input("Qty", sql.Decimal(18, 3), merged.Qty)
    .input("Keterangan", sql.NVarChar(200), merged.Keterangan ?? null)
    .input("IsPartial", sql.Bit, merged.IsPartial ?? 0)
    .input("Blok", sql.VarChar(50), merged.Blok ?? null)
    .input("IdLokasi", sql.Int, merged.IdLokasi ?? null)
    .query(`
      UPDATE dbo.BahanPendukung
      SET
        IdSupplier = @IdSupplier,
        IdCabinetMaterial = @IdCabinetMaterial,
        Qty = @Qty,
        Keterangan = @Keterangan,
        IsPartial = @IsPartial,
        Blok = @Blok,
        IdLokasi = @IdLokasi
      WHERE NoBahanPendukung = @NoBahanPendukung;
    `);
};

exports.deletePenerimaanBahanPendukungDLink = async (tx, noBahanPendukung) => {
  await new sql.Request(tx)
    .input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung)
    .query(`DELETE FROM dbo.PenerimaanBahanPendukung_d WHERE NoBahanPendukung = @NoBahanPendukung;`);
};

exports.deleteBahanPendukungHeader = async (tx, noBahanPendukung) => {
  const res = await new sql.Request(tx)
    .input("NoBahanPendukung", sql.VarChar(50), noBahanPendukung)
    .query(`DELETE FROM dbo.BahanPendukung WHERE NoBahanPendukung = @NoBahanPendukung;`);
  return res.rowsAffected?.[0] ?? 0;
};

exports.incrementHasBeenPrinted = async (tx, noBahanPendukung) => {
  const rs = await new sql.Request(tx).input(
    "NoBahanPendukung",
    sql.VarChar(50),
    noBahanPendukung,
  ).query(`
    DECLARE @out TABLE (NoBahanPendukung varchar(50), HasBeenPrinted int);
    UPDATE dbo.BahanPendukung
    SET HasBeenPrinted = ISNULL(HasBeenPrinted, 0) + 1
    OUTPUT INSERTED.NoBahanPendukung, INSERTED.HasBeenPrinted INTO @out
    WHERE NoBahanPendukung = @NoBahanPendukung;
    SELECT NoBahanPendukung, HasBeenPrinted FROM @out;
  `);
  return rs.recordset?.[0] || null;
};
