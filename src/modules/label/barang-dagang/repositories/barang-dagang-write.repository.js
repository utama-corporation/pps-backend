// barang-dagang-write.repository.js
// Mirror struktur bahan-pendukung-write.repository.js. Tabel dbo.BarangDagang
// menggabungkan struktur label (nomor sequence, print counter, status
// pemakaian) dengan atribut isi barang (Supplier, Qty, Keterangan) —
// PenerimaanBarangDagang_d hanya pengikat tipis, NoBarangDagang langsung
// FK ke sini.
const { sql } = require("../../../../core/config/db");

exports.insertBarangDagangHeader = async (
  tx,
  { noBarangDagang, header, nowDateTime },
) => {
  await new sql.Request(tx)
    .input("NoBarangDagang", sql.VarChar(50), noBarangDagang)
    .input("IdSupplier", sql.Int, header.IdSupplier)
    .input("IdBarangDagang", sql.Int, header.IdBarangDagang)
    .input("Qty", sql.Decimal(18, 3), header.Qty)
    .input("QtyAwal", sql.Decimal(18, 3), header.QtyAwal ?? header.Qty)
    .input("Keterangan", sql.NVarChar(200), header.Keterangan ?? null)
    .input("IsPartial", sql.Bit, header.IsPartial ?? 0)
    .input("CreateBy", sql.VarChar(100), header.CreateBy)
    .input("CreatedAt", sql.DateTime, nowDateTime)
    .input("Blok", sql.VarChar(50), header.Blok ?? null)
    .input("IdLokasi", sql.Int, header.IdLokasi ?? null).query(`
      INSERT INTO dbo.BarangDagang (
        NoBarangDagang, IdSupplier, IdBarangDagang,
        Qty, QtyAwal, Keterangan, IsPartial, DateUsage,
        CreateBy, CreatedAt, Blok, IdLokasi
      )
      VALUES (
        @NoBarangDagang, @IdSupplier, @IdBarangDagang,
        @Qty, @QtyAwal, @Keterangan, @IsPartial, NULL,
        @CreateBy, @CreatedAt, @Blok, @IdLokasi
      );
    `);
};

exports.updateBarangDagangHeader = async (tx, noBarangDagang, merged) => {
  await new sql.Request(tx)
    .input("NoBarangDagang", sql.VarChar(50), noBarangDagang)
    .input("IdSupplier", sql.Int, merged.IdSupplier)
    .input("IdBarangDagang", sql.Int, merged.IdBarangDagang)
    .input("Qty", sql.Decimal(18, 3), merged.Qty)
    .input("Keterangan", sql.NVarChar(200), merged.Keterangan ?? null)
    .input("IsPartial", sql.Bit, merged.IsPartial ?? 0)
    .input("Blok", sql.VarChar(50), merged.Blok ?? null)
    .input("IdLokasi", sql.Int, merged.IdLokasi ?? null)
    .query(`
      UPDATE dbo.BarangDagang
      SET
        IdSupplier = @IdSupplier,
        IdBarangDagang = @IdBarangDagang,
        Qty = @Qty,
        Keterangan = @Keterangan,
        IsPartial = @IsPartial,
        Blok = @Blok,
        IdLokasi = @IdLokasi
      WHERE NoBarangDagang = @NoBarangDagang;
    `);
};

exports.deletePenerimaanBarangDagangDLink = async (tx, noBarangDagang) => {
  await new sql.Request(tx)
    .input("NoBarangDagang", sql.VarChar(50), noBarangDagang)
    .query(`DELETE FROM dbo.PenerimaanBarangDagang_d WHERE NoBarangDagang = @NoBarangDagang;`);
};

exports.deleteBarangDagangHeader = async (tx, noBarangDagang) => {
  const res = await new sql.Request(tx)
    .input("NoBarangDagang", sql.VarChar(50), noBarangDagang)
    .query(`DELETE FROM dbo.BarangDagang WHERE NoBarangDagang = @NoBarangDagang;`);
  return res.rowsAffected?.[0] ?? 0;
};

exports.incrementHasBeenPrinted = async (tx, noBarangDagang) => {
  const rs = await new sql.Request(tx).input(
    "NoBarangDagang",
    sql.VarChar(50),
    noBarangDagang,
  ).query(`
    DECLARE @out TABLE (NoBarangDagang varchar(50), HasBeenPrinted int);
    UPDATE dbo.BarangDagang
    SET HasBeenPrinted = ISNULL(HasBeenPrinted, 0) + 1
    OUTPUT INSERTED.NoBarangDagang, INSERTED.HasBeenPrinted INTO @out
    WHERE NoBarangDagang = @NoBarangDagang;
    SELECT NoBarangDagang, HasBeenPrinted FROM @out;
  `);
  return rs.recordset?.[0] || null;
};
