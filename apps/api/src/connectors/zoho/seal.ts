/**
 * Sealed secrets for connector tokens: AES-256-GCM, a fresh 12-byte IV per seal,
 * stored as base64url "v1.<iv>.<tag>.<ciphertext>". The key is derived (HKDF-SHA256)
 * from BETTER_AUTH_SECRET, so no new secret has to be managed.
 * ponytail: rotating BETTER_AUTH_SECRET makes stored tokens unreadable; the
 * connection then needs a reconnect. A dedicated key env var if that ever hurts.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface Sealer {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function createSealer(secret: string): Sealer {
  const key = Buffer.from(hkdfSync('sha256', secret, 'hrvoice-connectors', 'connector-tokens-v1', 32));
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
    },
    open(sealed) {
      const [v, iv, tag, body] = sealed.split('.');
      if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('unreadable sealed value');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}
