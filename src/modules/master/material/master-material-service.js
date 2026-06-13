const sql = require("mssql");
const { poolPromise } = require("../../../core/config/db");

async function getFurnitureWipByParams({
  idCetakan,
  idWarna,
  idFurnitureMaterial,
}) {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("IdCetakan", sql.Int, idCetakan);
  request.input("IdWarna", sql.Int, idWarna);
  request.input(
    "IdFurnitureMaterial",
    sql.Int,
    idFurnitureMaterial ?? null,
  );

  const query = `
    SELECT
      d.IdFurnitureWIP AS IdOutput,
      cab.Nama AS NamaOutput
    FROM dbo.CetakanWarnaToFurnitureWIP_d AS d WITH (NOLOCK)
    INNER JOIN dbo.MstCabinetWIP AS cab WITH (NOLOCK)
      ON cab.IdCabinetWIP = d.IdFurnitureWIP
    WHERE d.IdCetakan = @IdCetakan
      AND d.IdWarna = @IdWarna
      AND (
        (d.IdFurnitureMaterial IS NULL
          AND (@IdFurnitureMaterial = 0 OR @IdFurnitureMaterial IS NULL))
        OR d.IdFurnitureMaterial = @IdFurnitureMaterial
      )
    ORDER BY cab.Nama ASC;
  `;

  const result = await request.query(query);
  return (result.recordset || []).map((row) => ({
    kategori: "furniturewip",
    idOutput: row.IdOutput,
    namaOutput: row.NamaOutput,
  }));
}

async function getPackingByParams({
  idCetakan,
  idWarna,
  idFurnitureMaterial,
}) {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("IdCetakan", sql.Int, idCetakan);
  request.input("IdWarna", sql.Int, idWarna);
  request.input(
    "IdFurnitureMaterial",
    sql.Int,
    idFurnitureMaterial ?? null,
  );

  const query = `
    SELECT
      d.IdBarangJadi AS IdOutput,
      mbj.NamaBJ AS NamaOutput
    FROM dbo.CetakanWarnaToProduk_d AS d WITH (NOLOCK)
    INNER JOIN dbo.MstBarangJadi AS mbj WITH (NOLOCK)
      ON mbj.IdBJ = d.IdBarangJadi
    WHERE d.IdCetakan = @IdCetakan
      AND d.IdWarna = @IdWarna
      AND (
        (d.IdFurnitureMaterial IS NULL
          AND (@IdFurnitureMaterial = 0 OR @IdFurnitureMaterial IS NULL))
        OR d.IdFurnitureMaterial = @IdFurnitureMaterial
      )
    ORDER BY mbj.NamaBJ ASC;
  `;

  const result = await request.query(query);
  return (result.recordset || []).map((row) => ({
    kategori: "barangjadi",
    idOutput: row.IdOutput,
    namaOutput: row.NamaOutput,
  }));
}

async function getOutputByParams(params) {
  const [furnitureWipItems, packingItems] = await Promise.all([
    getFurnitureWipByParams(params),
    getPackingByParams(params),
  ]);

  const items = [...furnitureWipItems, ...packingItems];

  let outputType = null;
  if (furnitureWipItems.length > 0 && packingItems.length > 0) {
    outputType = "mixed";
  } else if (furnitureWipItems.length > 0) {
    outputType = "furniturewip";
  } else if (packingItems.length > 0) {
    outputType = "barangjadi";
  }

  return {
    outputType,
    items,
  };
}

async function getFurnitureWipCompositions() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      fw.IdCabinetWIP AS IdFurnitureWIP,
      fw.Nama AS NamaFurnitureWIP,
      map.IdCetakan,
      ct.NamaCetakan,
      map.IdWarna,
      wr.Warna AS NamaWarna,
      map.IdFurnitureMaterial,
      mat.Nama AS NamaFurnitureMaterial
    FROM dbo.MstCabinetWIP fw WITH (NOLOCK)
    LEFT JOIN dbo.CetakanWarnaToFurnitureWIP_d map WITH (NOLOCK)
      ON map.IdFurnitureWIP = fw.IdCabinetWIP
    LEFT JOIN dbo.MstCetakan ct WITH (NOLOCK)
      ON ct.IdCetakan = map.IdCetakan
    LEFT JOIN dbo.MstWarna wr WITH (NOLOCK)
      ON wr.IdWarna = map.IdWarna
    LEFT JOIN dbo.MstCabinetMaterial mat WITH (NOLOCK)
      ON mat.IdCabinetMaterial = map.IdFurnitureMaterial
    WHERE ISNULL(fw.Enable, 1) = 1
    ORDER BY fw.Nama ASC, map.IdCetakan ASC, map.IdWarna ASC, map.IdFurnitureMaterial ASC;
  `;

  const result = await request.query(query);
  const rows = result.recordset || [];

  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.IdFurnitureWIP ?? "");

    if (!grouped.has(key)) {
      grouped.set(key, {
        IdFurnitureWIP: row.IdFurnitureWIP,
        NamaFurnitureWIP: row.NamaFurnitureWIP,
        Komposisi: [],
      });
    }

    if (
      row.IdCetakan !== null ||
      row.IdWarna !== null ||
      row.IdFurnitureMaterial !== null
    ) {
      grouped.get(key).Komposisi.push({
        IdCetakan: row.IdCetakan,
        NamaCetakan: row.NamaCetakan,
        IdWarna: row.IdWarna,
        NamaWarna: row.NamaWarna,
        IdFurnitureMaterial: row.IdFurnitureMaterial,
        NamaFurnitureMaterial: row.NamaFurnitureMaterial,
      });
    }
  }

  return Array.from(grouped.values());
}

async function getBarangJadiCompositions() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT
      bj.IdBJ AS IdBarangJadi,
      bj.NamaBJ AS NamaBarangJadi,
      map.IdCetakan,
      ct.NamaCetakan,
      map.IdWarna,
      wr.Warna AS NamaWarna,
      map.IdFurnitureMaterial,
      mat.Nama AS NamaFurnitureMaterial
    FROM dbo.MstBarangJadi bj WITH (NOLOCK)
    LEFT JOIN dbo.CetakanWarnaToProduk_d map WITH (NOLOCK)
      ON map.IdBarangJadi = bj.IdBJ
    LEFT JOIN dbo.MstCetakan ct WITH (NOLOCK)
      ON ct.IdCetakan = map.IdCetakan
    LEFT JOIN dbo.MstWarna wr WITH (NOLOCK)
      ON wr.IdWarna = map.IdWarna
    LEFT JOIN dbo.MstCabinetMaterial mat WITH (NOLOCK)
      ON mat.IdCabinetMaterial = map.IdFurnitureMaterial
    WHERE ISNULL(bj.Enable, 1) = 1
    ORDER BY bj.NamaBJ ASC, map.IdCetakan ASC, map.IdWarna ASC, map.IdFurnitureMaterial ASC;
  `;

  const result = await request.query(query);
  const rows = result.recordset || [];

  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.IdBarangJadi ?? "");

    if (!grouped.has(key)) {
      grouped.set(key, {
        IdBarangJadi: row.IdBarangJadi,
        NamaBarangJadi: row.NamaBarangJadi,
        Komposisi: [],
      });
    }

    if (
      row.IdCetakan !== null ||
      row.IdWarna !== null ||
      row.IdFurnitureMaterial !== null
    ) {
      grouped.get(key).Komposisi.push({
        IdCetakan: row.IdCetakan,
        NamaCetakan: row.NamaCetakan,
        IdWarna: row.IdWarna,
        NamaWarna: row.NamaWarna,
        IdFurnitureMaterial: row.IdFurnitureMaterial,
        NamaFurnitureMaterial: row.NamaFurnitureMaterial,
      });
    }
  }

  return Array.from(grouped.values());
}

module.exports = {
  getOutputByParams,
  getFurnitureWipCompositions,
  getBarangJadiCompositions,
};
