import { getDb } from '../db/database.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

export function setUserMpToken(userId: string, token: string): void {
  const db = getDb();
  const trimmed = token.trim();
  const ciphertext = trimmed ? encryptSecret(trimmed, userId, 'mp') : null;
  const result = db
    .prepare('UPDATE usuarios SET mp_token_ciphertext = ? WHERE id = ?')
    .run(ciphertext, userId);

  if (result.changes === 0) {
    throw new Error('Usuário não encontrado para salvar o token do Mercado Pago.');
  }
}

export function getUserMpToken(userId: string): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT mp_token_ciphertext FROM usuarios WHERE id = ?')
    .get(userId) as { mp_token_ciphertext: string | null } | undefined;

  if (!row?.mp_token_ciphertext) return null;
  return decryptSecret(row.mp_token_ciphertext, userId);
}
