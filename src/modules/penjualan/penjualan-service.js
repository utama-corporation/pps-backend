const { sql, poolPromise } = require("../../core/config/db");
const { badReq, notFound } = require("../../core/utils/http-error");
const { scanLabel } = require("./handlers/scan-label.handler");

async function getHeaders(
  page = 1,
  pageSize = 20,
  search = "",
  dateFrom = null,
  dateTo = null,
  status = "incomplete",
) {
  const pool = await poolPromise;

  const offset = (Math.max(page, 1) - 1) * Math.max(pageSize, 1);
  const s = String(search || "").trim();
  const st = ["incomplete", "complete", "all"].includes(status)
    ? status
    : "incomplete";

  const rqCount = pool.request();
  const rqData = pool.request();

  rqCount.input("search", sql.VarChar(50), s);
  rqData.input("search", sql.VarChar(50), s);

  rqCount.input("dateFrom", sql.Date, dateFrom);
  rqCount.input("dateTo", sql.Date, dateTo);
  rqData.input("dateFrom", sql.Date, dateFrom);
  rqData.input("dateTo", sql.Date, dateTo);

  rqData.input("offset", sql.Int, offset);
  rqData.input("pageSize", sql.Int, pageSize);

  const statusFilter =
    st === "incomplete"
      ? "AND h.IsComplete = 0"
      : st === "complete"
        ? "AND h.IsComplete = 1"
        : "";

  const qWhere = `
    WHERE 1 = 1
      ${statusFilter}
      AND (@search = '' OR h.NoBJJual LIKE '%' + @search + '%')
      AND (@dateFrom IS NULL OR CONVERT(date, h.Tanggal) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(date, h.Tanggal) <= @dateTo)
  `;

  const qCount = `
    SELECT COUNT(1) AS Total
    FROM dbo.BJJual_h h WITH (NOLOCK)
    ${qWhere};
  `;

  const qData = `
    SELECT
      h.NoBJJual,
      h.Tanggal,
      h.IdPembeli,
      p.NamaPembeli,
      h.Remark,
      h.IsComplete,
      h.DateComplete,
      (SELECT COUNT(1) FROM dbo.BJJualItem_d d WITH (NOLOCK) WHERE d.NoBJJual = h.NoBJJual) AS TotalLines,
      (
        SELECT COUNT(1) FROM dbo.BJJualItem_d d WITH (NOLOCK)
        WHERE d.NoBJJual = h.NoBJJual
          AND ISNULL((
            SELECT SUM(s.Pcs) FROM dbo.BJJualScanLabel_d s WITH (NOLOCK)
            WHERE s.NoBJJual = d.NoBJJual AND s.KodeKategori = d.KodeKategori AND s.IdJenis = d.IdJenis
          ), 0) >= d.Pcs
      ) AS CompletedLines
    FROM dbo.BJJual_h h WITH (NOLOCK)
    LEFT JOIN dbo.MstPembeli p WITH (NOLOCK)
      ON h.IdPembeli = p.IdPembeli
    ${qWhere}
    ORDER BY h.Tanggal DESC, h.NoBJJual DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `;

  const countRes = await rqCount.query(qCount);
  const total = countRes.recordset?.[0]?.Total ?? 0;

  const dataRes = await rqData.query(qData);
  const data = dataRes.recordset || [];

  return { data, total };
}

async function getHeaderDetail(noBJJual) {
  const no = String(noBJJual || "").trim();
  if (!no) throw badReq("noBJJual wajib");

  const pool = await poolPromise;

  const headerRes = await pool
    .request()
    .input("No", sql.VarChar(13), no).query(`
      SELECT h.NoBJJual, h.Tanggal, h.IdPembeli, p.NamaPembeli, h.Remark,
             h.IsComplete, h.DateComplete
      FROM dbo.BJJual_h h WITH (NOLOCK)
      LEFT JOIN dbo.MstPembeli p WITH (NOLOCK) ON h.IdPembeli = p.IdPembeli
      WHERE h.NoBJJual = @No
    `);

  const header = headerRes.recordset?.[0];
  if (!header) throw notFound(`BJJual ${no} tidak ditemukan`);

  const linesRes = await pool
    .request()
    .input("No", sql.VarChar(13), no).query(`
      SELECT
        d.KodeKategori,
        d.IdJenis,
        CASE
          WHEN d.KodeKategori = 'furniturewip' THEN mw.Nama
          WHEN d.KodeKategori = 'barangjadi' THEN mbj.NamaBJ
          ELSE NULL
        END AS NamaJenis,
        d.Pcs AS PcsRequired,
        ISNULL((
          SELECT SUM(s.Pcs) FROM dbo.BJJualScanLabel_d s WITH (NOLOCK)
          WHERE s.NoBJJual = d.NoBJJual AND s.KodeKategori = d.KodeKategori AND s.IdJenis = d.IdJenis
        ), 0) AS PcsScanned,
        d.DateTimeCreate
      FROM dbo.BJJualItem_d d WITH (NOLOCK)
      LEFT JOIN dbo.MstCabinetWIP mw WITH (NOLOCK)
        ON d.KodeKategori = 'furniturewip' AND mw.IdCabinetWIP = d.IdJenis
      LEFT JOIN dbo.MstBarangJadi mbj WITH (NOLOCK)
        ON d.KodeKategori = 'barangjadi' AND mbj.IdBJ = d.IdJenis
      WHERE d.NoBJJual = @No
      ORDER BY d.KodeKategori, d.IdJenis
    `);

  const scansRes = await pool
    .request()
    .input("No", sql.VarChar(13), no).query(`
      SELECT Id, KodeKategori, IdJenis, NoLabel, NoPartial, Pcs, DateTimeScan
      FROM dbo.BJJualScanLabel_d WITH (NOLOCK)
      WHERE NoBJJual = @No
      ORDER BY DateTimeScan ASC, Id ASC
    `);

  const lines = (linesRes.recordset || []).map((r) => ({
    kodeKategori: r.KodeKategori,
    idJenis: r.IdJenis,
    namaJenis: r.NamaJenis,
    pcsRequired: r.PcsRequired,
    pcsScanned: r.PcsScanned,
    isComplete: r.PcsScanned >= r.PcsRequired,
    dateTimeCreate: r.DateTimeCreate,
    scans: (scansRes.recordset || [])
      .filter(
        (s) => s.KodeKategori === r.KodeKategori && s.IdJenis === r.IdJenis,
      )
      .map((s) => ({
        id: s.Id,
        noLabel: s.NoLabel,
        noPartial: s.NoPartial ?? null,
        pcs: s.Pcs,
        dateTimeScan: s.DateTimeScan,
      })),
  }));

  return { header, lines };
}

module.exports = {
  getHeaders,
  getHeaderDetail,
  scanLabel,
};
