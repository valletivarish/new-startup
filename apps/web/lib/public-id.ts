/**
 * Opaque URL ids — real UUIDs stay in the DB/API; browser URLs show encrypted tokens.
 * Sync encode/decode for client Link hrefs. Accepts legacy raw UUIDs for old bookmarks.
 */

const VERSION = 'v1';

function secret(): string {
  if (typeof process !== 'undefined') {
    return (
      process.env.NEXT_PUBLIC_URL_ID_SECRET ||
      process.env.URL_ID_SECRET ||
      process.env.BETTER_AUTH_SECRET ||
      'dev-url-id-secret-change-me'
    );
  }
  return 'dev-url-id-secret-change-me';
}

function keyStream(length: number): Uint8Array {
  const seed = secret();
  const out = new Uint8Array(length);
  // Expand secret into a keystream (not a wire cipher — URL obfuscation + auth gate).
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < length; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out[i] = h & 0xff;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string): Uint8Array | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin =
      typeof atob === 'function'
        ? atob(b64 + pad)
        : Buffer.from(b64 + pad, 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Encrypt a UUID for use in URLs. */
export function toPublicId(uuid: string): string {
  const normalized = uuid.trim().toLowerCase();
  if (!UUID_RE.test(normalized)) return uuid;
  const raw = hexToBytes(normalized.replace(/-/g, ''));
  const key = keyStream(raw.length);
  const enc = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) enc[i] = raw[i]! ^ key[i]!;
  return `${VERSION}.${toBase64Url(enc)}`;
}

/** Decrypt a public URL id, or pass through a legacy UUID. */
export function fromPublicId(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.trim();
  if (UUID_RE.test(t)) return t.toLowerCase();
  if (!t.startsWith(`${VERSION}.`)) return null;
  const payload = t.slice(VERSION.length + 1);
  const enc = fromBase64Url(payload);
  if (!enc || enc.length !== 16) return null;
  const key = keyStream(enc.length);
  const raw = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) raw[i] = enc[i]! ^ key[i]!;
  const hex = bytesToHex(raw);
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_RE.test(uuid) ? uuid : null;
}

export function isPublicIdToken(token: string): boolean {
  return token.startsWith(`${VERSION}.`) || UUID_RE.test(token.trim());
}
