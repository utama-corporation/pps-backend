const { poolPromise } = require('../../core/config/db');

async function getAllActive() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      IdWarna,
      Warna,
      ISNULL(Enable, 1) AS Enable
    FROM [dbo].[MstWarna]
    WHERE ISNULL(Enable, 1) = 1
    ORDER BY Warna ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getByIdCetakan(idCetakan) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input('IdCetakan', idCetakan);

  const query = `
    SELECT DISTINCT
      w.IdWarna,
      w.Warna,
      ISNULL(w.Enable, 1) AS Enable
    FROM [dbo].[CetakanWarna_h] cw WITH (NOLOCK)
    INNER JOIN [dbo].[MstWarna] w WITH (NOLOCK)
      ON w.IdWarna = cw.IdWarna
    WHERE cw.IdCetakan = @IdCetakan
    ORDER BY w.Warna ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

module.exports = { getAllActive, getByIdCetakan };
