const { sql, poolPromise } = require("../../../core/config/db");

// Label reject (BF.) tidak ber-sak: satu label = satu nomor dengan satu
// berat. Sisa berat = Berat - SUM(RejectV2Partial.Berat), sama seperti yang
// dipakai broker/gilingan produksi, sortir-reject-v2, dan label/reject.
//
// Berbeda dengan broker/gilingan, label reject yang SUDAH pernah di-partial
// tetap boleh dipakai di bongkar susun: operator hanya memakai sisa
// bertnya, sisanya tetap hidup untuk proses berikutnya. Sisa berat itu yang
// dikembalikan sebagai `beratSisa`.
exports.getLabelInfoReject = async (labelCode) => {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input("NoReject", sql.VarChar(50), labelCode).query(`
      SELECT
        r.NoReject AS labelCode,
        r.DateCreate,
        r.IdReject  AS idJenis,
        mr.NamaReject AS namaJenis,
        r.IdWarehouse,
        r.Jam,
        r.CreateBy,
        r.DateTimeCreate,
        r.Blok,
        r.IdLokasi,
        r.IsPartial,
        ISNULL(CAST(r.HasBeenPrinted AS int), 0) AS hasBeenPrinted,
        ISNULL(r.Berat, 0) AS totalBerat,
        ISNULL(rp.TotalPartialBerat, 0) AS totalPartialBerat,
        CASE
          WHEN ISNULL(r.Berat, 0) - ISNULL(rp.TotalPartialBerat, 0) < 0
            THEN 0
          ELSE ISNULL(r.Berat, 0) - ISNULL(rp.TotalPartialBerat, 0)
        END AS beratSisa
      FROM dbo.RejectV2 r
      LEFT JOIN dbo.MstReject mr ON mr.IdReject = r.IdReject
      LEFT JOIN (
        SELECT NoReject, SUM(ISNULL(Berat, 0)) AS TotalPartialBerat
        FROM dbo.RejectV2Partial
        GROUP BY NoReject
      ) rp ON rp.NoReject = r.NoReject
      WHERE r.NoReject = @NoReject
    `);

  const first = result.recordset?.[0];
  if (!first) {
    const e = new Error(`NoReject ${labelCode} tidak ditemukan`);
    e.statusCode = 404;
    throw e;
  }

  if (first.DateUsage) {
    const e = new Error(
      `NoReject ${labelCode} tidak ditemukan atau sudah terpakai`,
    );
    e.statusCode = 404;
    throw e;
  }

  const beratSisa = Number(first.beratSisa || 0);
  if (beratSisa <= 0) {
    const e = new Error(
      `Label ${labelCode} sudah habis, tidak ada berat tersisa`,
    );
    e.statusCode = 409;
    throw e;
  }

  const isPartial = Number(first.totalPartialBerat || 0) > 0 || first.IsPartial === true;

  return {
    labelCode: first.labelCode,
    category: "reject",
    dateCreate: first.DateCreate,
    idJenis: first.idJenis,
    namaJenis: first.namaJenis,
    idWarehouse: first.IdWarehouse,
    totalBerat: Number(first.totalBerat || 0),
    totalPartialBerat: Number(first.totalPartialBerat || 0),
    beratSisa,
    berat: beratSisa,
    isPartial,
    jam: first.Jam,
    hasBeenPrinted: first.hasBeenPrinted,
    createBy: first.CreateBy,
    dateTimeCreate: first.DateTimeCreate,
    blok: first.Blok,
    idLokasi: first.IdLokasi,
  };
};