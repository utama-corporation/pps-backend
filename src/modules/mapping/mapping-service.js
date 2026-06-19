const { poolPromise, sql } = require("../../core/config/db");
const ALLOWED_LAYOUT_CELL_TYPES = new Set(["lokasi", "aisle", "lift", "label"]);

async function getBlokWarehouseMapping() {
  const pool = await poolPromise;
  const request = pool.request();

  const query = `
    SELECT TOP (1000)
      b.Blok,
      b.IdWarehouse,
      w.NamaWarehouse,
      ISNULL(l.TotalLokasi, 0) AS TotalLokasi,
      ISNULL(j.TotalJenis, 0) AS TotalJenis
    FROM [dbo].[MstBlok] b
    LEFT JOIN [dbo].[MstWarehouse] w
      ON w.IdWarehouse = b.IdWarehouse
    LEFT JOIN (
      SELECT Blok, COUNT(*) AS TotalLokasi
      FROM [dbo].[MstLokasi]
      WHERE ISNULL(Enable, 1) = 1
      GROUP BY Blok
    ) l ON l.Blok = b.Blok
    LEFT JOIN (
      SELECT Blok, COUNT(*) AS TotalJenis
      FROM (
        SELECT Blok, IdKategori, IdJenis
        FROM [dbo].[MstLokasi]
        WHERE ISNULL(Enable, 1) = 1 AND IdKategori IS NOT NULL AND IdJenis IS NOT NULL
        GROUP BY Blok, IdKategori, IdJenis
      ) j
      GROUP BY Blok
    ) j ON j.Blok = b.Blok
    ORDER BY b.Blok ASC;
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

async function getLokasiByBlok(blok) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("blok", sql.VarChar(100), blok);

  const query = `
    SELECT
      l.IdLokasi,
      l.Blok,
      l.[Description],
      l.Enable,
      l.IdKategori,
      l.IdJenis,
      k.IdKategori AS KategoriId,
      k.KodeKategori,
      k.NamaKategori,
      k.NamaTableJenis,
      k.NamaKolomIdJenis,
      k.NamaKolomNamaJenis,
      k.IdUOM,
      u.NamaUOM
    FROM [dbo].[MstLokasi] l
    LEFT JOIN [dbo].[MstKategori] k ON k.IdKategori = l.IdKategori
    LEFT JOIN [dbo].[MstUOM] u ON u.IdUOM = k.IdUOM
    WHERE l.Blok = @blok
      AND ISNULL(l.Enable, 1) = 1
    ORDER BY l.IdLokasi ASC;
  `;

  const result = await request.query(query);
  const rows = result.recordset || [];

  const isSafe = (v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(v || "").trim());

  const groups = new Map();
  for (const row of rows) {
    if (!row.IdKategori || !row.IdJenis) continue;
    const tbl = String(row.NamaTableJenis || "").trim();
    const idCol = String(row.NamaKolomIdJenis || "").trim();
    const nameCol = String(row.NamaKolomNamaJenis || "").trim();
    if (!isSafe(tbl) || !isSafe(idCol) || !isSafe(nameCol)) continue;
    const key = `${tbl}|${idCol}|${nameCol}`;
    if (!groups.has(key)) {
      groups.set(key, { tableName: tbl, idColumn: idCol, nameColumn: nameCol, ids: new Set() });
    }
    groups.get(key).ids.add(Number(row.IdJenis));
  }

  const jenisNameMap = new Map();
  for (const [, group] of groups) {
    if (group.ids.size === 0) continue;
    const ids = [...group.ids];
    const params = ids.map((_, i) => `@p${i}`);
    const req = pool.request();
    ids.forEach((id, i) => req.input(`p${i}`, sql.Int, id));
    try {
      const jenisResult = await req.query(`
        SELECT CAST(${group.idColumn} AS int) AS IdJenis,
               CAST(${group.nameColumn} AS nvarchar(4000)) AS NamaJenis
        FROM [dbo].[${group.tableName}] WITH (NOLOCK)
        WHERE ${group.idColumn} IN (${params.join(",")});
      `);
      for (const j of jenisResult.recordset || []) {
        jenisNameMap.set(`${group.tableName}:${Number(j.IdJenis)}`, j.NamaJenis);
      }
    } catch (err) {
      console.error(`Gagal resolve jenis dari ${group.tableName}:`, err.message);
    }
  }

  const aggMap = await getLabelAggregatesByLokasi(blok);

  return rows.map((row) => {
    const agg = aggMap.get(row.IdLokasi) ?? { TotalLabel: 0, TotalQty: 0, TotalBerat: 0 };
    const uom = String(row.NamaUOM || "").toLowerCase();
    return {
      IdLokasi: row.IdLokasi,
      Blok: row.Blok,
      Description: row.Description,
      Enable: row.Enable,
      IdKategori: row.IdKategori ?? null,
      IdJenis: row.IdJenis ?? null,
      KodeKategori: row.KodeKategori ?? null,
      NamaKategori: row.NamaKategori ?? null,
      NamaJenis:
        row.IdJenis && row.NamaTableJenis
          ? jenisNameMap.get(`${row.NamaTableJenis}:${Number(row.IdJenis)}`) ?? null
          : null,
      IdUOM: row.IdUOM ?? null,
      NamaUOM: row.NamaUOM ?? null,
      TotalLabel: agg.TotalLabel,
      TotalQty: uom === "kg" ? 0 : agg.TotalQty,
      TotalBerat: uom === "pcs" ? 0 : agg.TotalBerat,
    };
  });
}

async function getLabelAggregatesByLokasi(blok) {
  const pool = await poolPromise;
  const request = pool.request();
  request.input("blok", sql.VarChar(100), blok);

  const [countResult, aggResult] = await Promise.all([
    // Count labels (headers) per lokasi
    pool
      .request()
      .input("blok", sql.VarChar(100), blok)
      .query(`
        SELECT IdLokasi, COUNT(*) AS TotalLabel
        FROM (
          SELECT p.IdLokasi FROM dbo.BahanBakuPallet_h p WHERE p.Blok = @blok
            AND EXISTS (SELECT 1 FROM dbo.BahanBaku_d d WHERE d.NoBahanBaku = p.NoBahanBaku AND d.NoPallet = p.NoPallet AND d.DateUsage IS NULL)
          UNION ALL
          SELECT wh.IdLokasi FROM dbo.Washing_h wh WHERE wh.Blok = @blok
            AND EXISTS (SELECT 1 FROM dbo.Washing_d wd WHERE wd.NoWashing = wh.NoWashing AND wd.DateUsage IS NULL)
          UNION ALL
          SELECT bh.IdLokasi FROM dbo.Broker_h bh WHERE bh.Blok = @blok
            AND EXISTS (SELECT 1 FROM dbo.Broker_d bd WHERE bd.NoBroker = bh.NoBroker AND bd.DateUsage IS NULL)
          UNION ALL
          SELECT IdLokasi FROM dbo.Crusher WHERE Blok = @blok AND DateUsage IS NULL
          UNION ALL
          SELECT IdLokasi FROM dbo.Bonggolan WHERE Blok = @blok AND DateUsage IS NULL
          UNION ALL
          SELECT IdLokasi FROM dbo.Gilingan WHERE Blok = @blok AND DateUsage IS NULL
          UNION ALL
          SELECT mh.IdLokasi FROM dbo.Mixer_h mh WHERE mh.Blok = @blok
            AND EXISTS (SELECT 1 FROM dbo.Mixer_d md WHERE md.NoMixer = mh.NoMixer AND md.DateUsage IS NULL)
          UNION ALL
          SELECT IdLokasi FROM dbo.FurnitureWIP WHERE Blok = @blok AND DateUsage IS NULL
          UNION ALL
          SELECT IdLokasi FROM dbo.BarangJadi WHERE Blok = @blok AND DateUsage IS NULL
          UNION ALL
          SELECT IdLokasi FROM dbo.RejectV2 WHERE Blok = @blok AND DateUsage IS NULL
        ) AS AllLabels
        GROUP BY IdLokasi;
      `),
    // Aggregate Qty & Berat per lokasi (simplified, no partial logic)
    pool
      .request()
      .input("blok", sql.VarChar(100), blok)
      .query(`
        SELECT IdLokasi,
               SUM(ISNULL(Qty, 0)) AS TotalQty,
               SUM(ISNULL(Berat, 0)) AS TotalBerat
        FROM (
          SELECT p.IdLokasi, COUNT(*) AS Qty, SUM(ISNULL(d.Berat, 0)) AS Berat
          FROM dbo.BahanBakuPallet_h p
          JOIN dbo.BahanBaku_d d ON d.NoBahanBaku = p.NoBahanBaku AND d.NoPallet = p.NoPallet
          WHERE d.DateUsage IS NULL AND p.Blok = @blok
          GROUP BY p.IdLokasi

          UNION ALL

          SELECT wh.IdLokasi, COUNT(*) AS Qty, SUM(ISNULL(wd.Berat, 0)) AS Berat
          FROM dbo.Washing_h wh
          JOIN dbo.Washing_d wd ON wd.NoWashing = wh.NoWashing
          WHERE wd.DateUsage IS NULL AND wh.Blok = @blok
          GROUP BY wh.IdLokasi

          UNION ALL

          SELECT bh.IdLokasi, COUNT(*) AS Qty, SUM(ISNULL(bd.Berat, 0)) AS Berat
          FROM dbo.Broker_h bh
          JOIN dbo.Broker_d bd ON bd.NoBroker = bh.NoBroker
          WHERE bd.DateUsage IS NULL AND bh.Blok = @blok
          GROUP BY bh.IdLokasi

          UNION ALL
          SELECT IdLokasi, NULL AS Qty, Berat FROM dbo.Crusher WHERE DateUsage IS NULL AND Blok = @blok
          UNION ALL
          SELECT IdLokasi, NULL AS Qty, Berat FROM dbo.Bonggolan WHERE DateUsage IS NULL AND Blok = @blok

          UNION ALL

          SELECT g.IdLokasi, COUNT(*) AS Qty, SUM(ISNULL(d.Berat, 0)) AS Berat
          FROM dbo.Gilingan g
          JOIN dbo.Gilingan d ON d.NoGilingan = g.NoGilingan
          WHERE d.DateUsage IS NULL AND g.Blok = @blok
          GROUP BY g.IdLokasi

          UNION ALL

          SELECT mh.IdLokasi, COUNT(*) AS Qty, SUM(ISNULL(md.Berat, 0)) AS Berat
          FROM dbo.Mixer_h mh
          JOIN dbo.Mixer_d md ON md.NoMixer = mh.NoMixer
          WHERE md.DateUsage IS NULL AND mh.Blok = @blok
          GROUP BY mh.IdLokasi

          UNION ALL

          SELECT fw.IdLokasi, SUM(ISNULL(d.Pcs, 0)) AS Qty, NULL AS Berat
          FROM dbo.FurnitureWIP fw
          JOIN dbo.FurnitureWIP d ON d.NoFurnitureWIP = fw.NoFurnitureWIP
          WHERE d.DateUsage IS NULL AND fw.Blok = @blok
          GROUP BY fw.IdLokasi

          UNION ALL

          SELECT bj.IdLokasi, SUM(ISNULL(d.Pcs, 0)) AS Qty, NULL AS Berat
          FROM dbo.BarangJadi bj
          JOIN dbo.BarangJadi d ON d.NoBJ = bj.NoBJ
          WHERE d.DateUsage IS NULL AND bj.Blok = @blok
          GROUP BY bj.IdLokasi

          UNION ALL
          SELECT IdLokasi, NULL AS Qty, Berat FROM dbo.RejectV2 WHERE DateUsage IS NULL AND Blok = @blok
        ) AS Agg
        GROUP BY IdLokasi;
      `),
  ]);

  const map = new Map();
  const countRows = countResult.recordset || [];
  const aggRows = aggResult.recordset || [];
  for (const row of countRows) {
    map.set(row.IdLokasi, { TotalLabel: row.TotalLabel, TotalQty: 0, TotalBerat: 0 });
  }
  for (const row of aggRows) {
    const entry = map.get(row.IdLokasi) || { TotalLabel: 0, TotalQty: 0, TotalBerat: 0 };
    entry.TotalQty = row.TotalQty;
    entry.TotalBerat = row.TotalBerat;
    map.set(row.IdLokasi, entry);
  }
  return map;
}

async function getLayoutByBlok(blok) {
  const pool = await poolPromise;

  const layoutResult = await pool
    .request()
    .input("blok", sql.VarChar(100), blok).query(`
      SELECT TOP (1)
        IdLayout,
        Rows,
        Cols
      FROM [dbo].[MstLayoutBlok]
      WHERE Blok = @blok;
    `);

  const layout = layoutResult.recordset?.[0];
  if (!layout) {
    return null;
  }

  const cellsResult = await pool
    .request()
    .input("idLayout", sql.Int, layout.IdLayout).query(`
      SELECT
        IdCell AS idCell,
        IdLayout AS idLayout,
        [Row] AS [row],
        [Col] AS [col],
        CellType AS cellType,
        IdLokasi AS idLokasi,
        RowSpan AS rowSpan,
        ColSpan AS colSpan,
        LabelText AS labelText
      FROM [dbo].[MstLayoutCell]
      WHERE IdLayout = @idLayout
      ORDER BY [Row] ASC, [Col] ASC;
    `);

  return {
    rows: layout.Rows,
    cols: layout.Cols,
    cells: cellsResult.recordset || [],
  };
}

async function saveLayoutByBlok(blok, payload) {
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  const normalizedCells = Array.isArray(payload.cells)
    ? payload.cells
        .map((cell) => ({
          ...cell,
          cellType: String(cell?.cellType || "").trim().toLowerCase(),
          rowSpan: cell?.rowSpan,
          colSpan: cell?.colSpan,
          labelText: cell?.labelText ?? null,
        }))
        .filter(
          (cell) =>
            cell &&
            Number.isInteger(cell.row) &&
            Number.isInteger(cell.col) &&
            Number.isInteger(cell.rowSpan) &&
            cell.rowSpan > 0 &&
            Number.isInteger(cell.colSpan) &&
            cell.colSpan > 0 &&
            ALLOWED_LAYOUT_CELL_TYPES.has(cell.cellType),
        )
    : [];

  try {
    await transaction.begin();

    const columnResult = await new sql.Request(transaction).query(`
      SELECT [name]
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.MstLayoutBlok')
        AND [name] IN ('CreatedAt', 'UpdatedAt');
    `);

    const existingColumns = new Set(
      (columnResult.recordset || []).map((row) => row.name),
    );
    const hasCreatedAt = existingColumns.has("CreatedAt");
    const hasUpdatedAt = existingColumns.has("UpdatedAt");

    const existingLayoutResult = await new sql.Request(transaction)
      .input("blok", sql.VarChar(100), blok)
      .query(`
        SELECT TOP (1) IdLayout
        FROM [dbo].[MstLayoutBlok]
        WHERE Blok = @blok;
      `);

    const existingLayout = existingLayoutResult.recordset?.[0];
    let idLayout = existingLayout?.IdLayout ?? null;

    if (idLayout) {
      const updateAssignments = ["Rows = @rows", "Cols = @cols"];
      if (hasUpdatedAt) {
        updateAssignments.push("UpdatedAt = GETDATE()");
      }

      await new sql.Request(transaction)
        .input("idLayout", sql.Int, idLayout)
        .input("rows", sql.Int, payload.rows)
        .input("cols", sql.Int, payload.cols)
        .query(`
          UPDATE [dbo].[MstLayoutBlok]
          SET ${updateAssignments.join(", ")}
          WHERE IdLayout = @idLayout;
        `);
    } else {
      const insertColumns = ["Blok", "Rows", "Cols"];
      const insertValues = ["@blok", "@rows", "@cols"];

      if (hasCreatedAt) {
        insertColumns.push("CreatedAt");
        insertValues.push("GETDATE()");
      }

      if (hasUpdatedAt) {
        insertColumns.push("UpdatedAt");
        insertValues.push("GETDATE()");
      }

      const insertResult = await new sql.Request(transaction)
        .input("blok", sql.VarChar(100), blok)
        .input("rows", sql.Int, payload.rows)
        .input("cols", sql.Int, payload.cols)
        .query(`
          INSERT INTO [dbo].[MstLayoutBlok] (${insertColumns.join(", ")})
          OUTPUT inserted.IdLayout
          VALUES (${insertValues.join(", ")});
        `);

      idLayout = insertResult.recordset?.[0]?.IdLayout ?? null;
    }

    if (!idLayout) {
      throw new Error("IdLayout gagal didapatkan setelah upsert layout");
    }

    await new sql.Request(transaction)
      .input("idLayout", sql.Int, idLayout)
      .query("DELETE FROM [dbo].[MstLayoutCell] WHERE IdLayout = @idLayout;");

    for (const cell of normalizedCells) {
      await new sql.Request(transaction)
        .input("idLayout", sql.Int, idLayout)
        .input("row", sql.Int, cell.row)
        .input("col", sql.Int, cell.col)
        .input("cellType", sql.VarChar(50), String(cell.cellType).trim())
        .input("idLokasi", sql.Int, cell.idLokasi ?? null)
        .input("rowSpan", sql.Int, cell.rowSpan)
        .input("colSpan", sql.Int, cell.colSpan)
        .input("labelText", sql.VarChar(sql.MAX), cell.labelText ?? null).query(`
          INSERT INTO [dbo].[MstLayoutCell]
            (IdLayout, [Row], [Col], CellType, IdLokasi, RowSpan, ColSpan, LabelText)
          VALUES
            (@idLayout, @row, @col, @cellType, @idLokasi, @rowSpan, @colSpan, @labelText);
        `);
    }

    await transaction.commit();
    return getLayoutByBlok(blok);
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback saveLayoutByBlok gagal:", rollbackError);
      }
    }
    throw error;
  }
}

async function createLokasi(blok, payload) {
  const pool = await poolPromise;
  const { IdLokasi, IdKategori, IdJenis, Description, Enable } = payload;

  const result = await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("IdLokasi", sql.Int, IdLokasi)
    .input("IdKategori", sql.Int, IdKategori ?? null)
    .input("IdJenis", sql.Int, IdJenis ?? null)
    .input("Description", sql.VarChar(sql.MAX), Description ?? null)
    .input("Enable", sql.Bit, Enable ?? true).query(`
      INSERT INTO [dbo].[MstLokasi] (Blok, IdLokasi, IdKategori, IdJenis, Description, Enable)
      VALUES (@blok, @IdLokasi, @IdKategori, @IdJenis, @Description, @Enable);
    `);

  return result.rowsAffected[0] > 0;
}

async function updateLokasi(blok, idLokasi, payload) {
  const pool = await poolPromise;
  const { IdKategori, IdJenis, Description, Enable } = payload;

  const result = await pool
    .request()
    .input("blok", sql.VarChar(100), blok)
    .input("idLokasi", sql.Int, idLokasi)
    .input("IdKategori", sql.Int, IdKategori ?? null)
    .input("IdJenis", sql.Int, IdJenis ?? null)
    .input("Description", sql.VarChar(sql.MAX), Description ?? null)
    .input("Enable", sql.Bit, Enable ?? true).query(`
      UPDATE [dbo].[MstLokasi]
      SET
        IdKategori  = @IdKategori,
        IdJenis     = @IdJenis,
        Description = @Description,
        Enable      = @Enable
      WHERE Blok = @blok AND IdLokasi = @idLokasi;
    `);

  return result.rowsAffected[0] > 0;
}

module.exports = {
  getBlokWarehouseMapping,
  getLokasiByBlok,
  getLayoutByBlok,
  saveLayoutByBlok,
  createLokasi,
  updateLokasi,
};
