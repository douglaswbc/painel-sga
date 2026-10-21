/**
 * AES-256-GCM helpers shared by the WhatsApp provider Edge Functions.
 *
 * Two ciphertext versions exist:
 *   - `v1.<iv>.<ciphertext>`  Zernio API keys, keyed with ZERNIO_ENCRYPTION_KEY.
 *   - `vm1.<iv>.<ciphertext>` Meta access tokens, keyed with META_ENCRYPTION_KEY
 *     and falling back to ZERNIO_ENCRYPTION_KEY when the dedicated secret is
 *     not configured.
 *
 * The owner id is always used as additional authenticated data, so a secret
 * cannot be decrypted by another landlord even with a valid key.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SecretScope = 'zernio' | 'meta';

const SCOPE_PREFIX: Record<SecretScope, string> = {
  zernio: 'v1.',
  meta: 'vm1.',
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secretForScope(scope: SecretScope): string {
  const value = scope === 'meta'
    ? Deno.env.get('META_ENCRYPTION_KEY') ?? Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? ''
    : Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('A chave de criptografia da integração ainda não foi configurada no Supabase.');
  }
  return value;
}

async function cryptoKeyForScope(scope: SecretScope): Promise<CryptoKey> {
  const bytes = Uint8Array.from(secretForScope(scope).match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string, ownerId: string, scope: SecretScope = 'zernio'): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(ownerId) },
    await cryptoKeyForScope(scope),
    encoder.encode(plaintext),
  );
  return `${SCOPE_PREFIX[scope]}${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(ciphertext: string, ownerId: string): Promise<string> {
  const separator = ciphertext.indexOf('.');
  if (separator < 0) throw new Error('Formato da credencial armazenada não reconhecido.');
  const version = ciphertext.slice(0, separator + 1);
  const scope: SecretScope = version === SCOPE_PREFIX.meta ? 'meta' : 'zernio';
  const [encodedIv, encodedCiphertext] = ciphertext.slice(separator + 1).split('.');
  if (!encodedIv || !encodedCiphertext) throw new Error('Formato da credencial armazenada não reconhecido.');

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encodedIv), additionalData: encoder.encode(ownerId) },
    await cryptoKeyForScope(scope),
    fromBase64(encodedCiphertext),
  );
  return decoder.decode(decrypted);
}
