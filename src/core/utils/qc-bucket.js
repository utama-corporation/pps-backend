/**
 * Utilitas window jam QC per bucket produksi ("QC tiap jam").
 *
 * Pola ini dipakai pertama kali di fitur QC inject (buildQcBuckets inline di
 * inject-production-service.js) dan kini dipakai juga oleh washing & broker.
 * Seluruh bucket dihitung dari tglProduksi + hourStart/hourEnd produksi asli,
 * bukan ditebak dari jam device — supaya data lampau yang jam-of-day-nya
 * kebetulan mirip shift hari ini tidak salah dikira "baru mau dibuka".
 */

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDateOnlyString(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  if (typeof value === "string") {
    const datePart = value.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
  }

  return null;
}

function normalizeTimeString(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function addDays(dateString, dayOffset) {
  const baseDate = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return null;

  baseDate.setDate(baseDate.getDate() + dayOffset);
  return `${baseDate.getFullYear()}-${pad2(baseDate.getMonth() + 1)}-${pad2(baseDate.getDate())}`;
}

function parseMinutesHM(hhmm) {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm || "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtHM(totalMinutes) {
  const minOfDay = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(minOfDay / 60))}:${pad2(minOfDay % 60)}`;
}

// Instant naive "YYYY-MM-DDTHH:mm:00" (tanpa offset timezone).
function buildQcBucketInstant(tglDateStr, baseMinutes, offsetMinutes) {
  const totalMin = baseMinutes + offsetMinutes;
  const dayOffset = Math.floor(totalMin / (24 * 60));
  const minOfDay = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const dateStr = dayOffset === 0 ? tglDateStr : addDays(tglDateStr, dayOffset);
  const hh = pad2(Math.floor(minOfDay / 60));
  const mm = pad2(minOfDay % 60);
  return `${dateStr}T${hh}:${mm}:00`;
}

// Pecah range [hourStart, hourEnd) produksi menjadi bucket per jam.
// Setiap bucket: hourStart/hourEnd (label jam), opensAt (QC mulai bisa
// diinput, = akhir jam produksi), closesAt (= opensAt + 60 menit).
// Konvensi shift 3 (produksi mulai sebelum jam 06:00) ikut pola inject:
// anchor tanggal dimajukan 1 hari.
function buildQcBuckets(tglProduksi, hourStartRaw, hourEndRaw, shift) {
  let tglDateStr = toDateOnlyString(tglProduksi);
  const startMin = parseMinutesHM(normalizeTimeString(hourStartRaw));
  const endMin = parseMinutesHM(normalizeTimeString(hourEndRaw));
  if (!tglDateStr || startMin == null || endMin == null) return [];

  let duration = endMin - startMin;
  if (duration <= 0) duration += 24 * 60;
  if (duration <= 0) return [];

  const startRem = startMin % 60;
  const firstStep = startRem === 0 ? 60 : 60 - startRem;

  const buckets = [];
  let offset = 0;

  if (shift === 3 && startMin >= 0 && startMin <= 360) {
    const tanggal = new Date(tglDateStr);
    tanggal.setDate(tanggal.getDate() + 1);
    tglDateStr = tanggal.toISOString().split("T")[0];
  }

  while (offset < duration) {
    const step = offset === 0 && startRem !== 0 ? firstStep : 60;
    const nextOffset = Math.min(offset + step, duration);

    buckets.push({
      hourStart: fmtHM(startMin + offset),
      hourEnd: fmtHM(startMin + nextOffset),
      opensAt: buildQcBucketInstant(tglDateStr, startMin, nextOffset),
      closesAt: buildQcBucketInstant(tglDateStr, startMin, nextOffset + 60),
      label: `${fmtHM(startMin + offset)} - ${fmtHM(startMin + nextOffset)}`,
    });
    offset = nextOffset;
  }

  return buckets;
}

module.exports = {
  buildQcBuckets,
  pad2,
  toDateOnlyString,
  normalizeTimeString,
  addDays,
  parseMinutesHM,
  fmtHM,
  buildQcBucketInstant,
};