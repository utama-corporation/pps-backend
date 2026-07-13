// src/core/shared/stock-opname-lock-guard.js
const { sql, poolPromise } = require("../config/db");
const { notFound, conflict } = require("../utils/http-error");

async function getRequest(runner) {
  const r = typeof runner?.then === "function" ? await runner : runner;
  if (r instanceof sql.Request) return r;
  if (r instanceof sql.Transaction) return new sql.Request(r);
  if (r?.request) return r.request();
  const pool = await poolPromise;
  return pool.request();
}

/**
 * Tolak operasi tulis (insert-label, delete-hasil, dll) kalau NoSO sudah ditandai selesai
 * (IsComplete = 1) lewat endpoint complete di stock-opname-v2.
 */
async function assertStockOpnameNotComplete(noso, runner) {
  const request = await getRequest(runner);
  const res = await request
    .input("noso_lockcheck", sql.VarChar, noso)
    .query(`
      SELECT IsComplete FROM dbo.StockOpname_h WHERE NoSO = @noso_lockcheck;
    `);

  const row = res.recordset?.[0];
  if (!row) throw notFound(`NoSO tidak ditemukan: ${noso}`);

  if (row.IsComplete) {
    const e = conflict(
      `Stock opname ${noso} sudah ditandai selesai, tidak bisa diubah lagi.`,
    );
    e.code = "STOCK_OPNAME_COMPLETED";
    throw e;
  }
}

module.exports = { assertStockOpnameNotComplete };
