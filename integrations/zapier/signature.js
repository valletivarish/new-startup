/** Checks HRVoice's webhook signature on the raw request Zapier hands a hook trigger. */

const crypto = require('node:crypto');

/** True when HRVoice-Signature (t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>) matches the raw body. */
function signatureOk(rawRequest, secret, toleranceSec = 900, nowMs = Date.now()) {
  if (!rawRequest || !secret) return false;
  const entry = Object.entries(rawRequest.headers || {}).find(([k]) => /^(http-)?hrvoice-signature$/i.test(k));
  if (!entry) return false;
  const parts = Object.fromEntries(
    String(entry[1]).split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  if (!/^\d+$/.test(parts.t || '') || !/^[0-9a-f]{64}$/i.test(parts.v1 || '')) return false;
  if (Math.abs(nowMs / 1000 - Number(parts.t)) > toleranceSec) return false;
  const want = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawRequest.content || ''}`).digest();
  return crypto.timingSafeEqual(want, Buffer.from(parts.v1, 'hex'));
}

module.exports = { signatureOk };
