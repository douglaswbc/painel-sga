import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { loadEnv } from '../config/env.js';

const scryptAsync = promisify(crypto.scrypt);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SecretScope = 'zernio' | 'meta' | 'resend' | 'mp' | 'data';

const SCOPE_PREFIX: Record<SecretScope, string> = {
  zernio: 'v1.',
  meta: 'vm1.',
  resend: 'vr1.',
  mp: 'vp1.',
  data: 'vd1.',
};

function keyBytesForScope(scope: SecretScope): Buffer {
  const { encryptionKeys } = loadEnv();
  const hex =
    scope === 'meta'
      ? encryptionKeys.meta
      : scope === 'resend'
        ? encryptionKeys.resend
        : scope === 'mp'
          ? encryptionKeys.mp
          : scope === 'zernio'
            ? encryptionKeys.zernio
            : encryptionKeys.master;

  if (!/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error(`Chave de criptografia ausente para o escopo "${scope}".`);
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Criptografa um segredo com AES-256-GCM vinculando ao ownerId via AAD.
 * Mantém o formato exato `v1.<iv>.<ciphertext+tag>` usado pelas Edge Functions antigas.
 */
export function encryptSecret(plaintext: string, ownerId: string, scope: SecretScope = 'data'): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytesForScope(scope), iv);
  cipher.setAAD(encoder.encode(ownerId));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, tag]);
  return `${SCOPE_PREFIX[scope]}${iv.toString('base64')}.${combined.toString('base64')}`;
}

/**
 * Descriptografa segredo cifrado com AES-256-GCM (WebCrypto ou Node `crypto` são idênticos: cipher || 16-byte tag).
 */
export function decryptSecret(ciphertext: string, ownerId: string): string {
  const separator = ciphertext.indexOf('.');
  if (separator < 0) {
    throw new Error('Formato da credencial armazenada não reconhecido.');
  }
  const version = ciphertext.slice(0, separator + 1);
  const scope: SecretScope =
    version === SCOPE_PREFIX.meta
      ? 'meta'
      : version === SCOPE_PREFIX.resend
        ? 'resend'
        : version === SCOPE_PREFIX.mp
          ? 'mp'
          : version === SCOPE_PREFIX.data
            ? 'data'
            : 'zernio';

  const rest = ciphertext.slice(separator + 1);
  const [encodedIv, encodedPayload] = rest.split('.');
  if (!encodedIv || !encodedPayload) {
    throw new Error('Formato da credencial armazenada não reconhecido.');
  }

  const iv = Buffer.from(encodedIv, 'base64');
  const combined = Buffer.from(encodedPayload, 'base64');
  if (combined.length < 16) {
    throw new Error('Credencial criptografada corrompida.');
  }

  const encrypted = combined.subarray(0, combined.length - 16);
  const authTag = combined.subarray(combined.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytesForScope(scope), iv);
  decipher.setAAD(encoder.encode(ownerId));
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decoder.decode(decrypted);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
