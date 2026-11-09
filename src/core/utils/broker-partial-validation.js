const { badReq } = require('./http-error');
function validateBrokerPartialWeights(payload) {
  for (const key of ['brokerPartial', 'brokerPartialNew']) {
    if (!Array.isArray(payload?.[key])) continue;
    for (const row of payload[key]) {
      const raw = row?.berat;
      const value = Number(raw);
      if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '' ||
          !Number.isFinite(value) || value <= 0 ||
          Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
        throw badReq('Berat broker parsial harus > 0 dan maksimal 2 angka di belakang koma');
      }
    }
  }
}
module.exports = { validateBrokerPartialWeights };
