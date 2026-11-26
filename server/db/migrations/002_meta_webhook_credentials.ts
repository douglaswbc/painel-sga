import type { DatabaseSync } from 'node:sqlite';

const COLUMNS = [
  { name: 'meta_app_secret_ciphertext', def: 'TEXT' },
  { name: 'meta_app_secret_last4', def: 'TEXT' },
  { name: 'meta_webhook_verify_token_ciphertext', def: 'TEXT' },
  { name: 'meta_webhook_verify_token_last4', def: 'TEXT' },
] as const;

export function applyMetaWebhookCredentialsMigration(db: DatabaseSync): void {
  const existing = db
    .prepare("PRAGMA table_info('zernio_integracoes')")
    .all() as Array<{ name: string }>;
  const existingNames = new Set(existing.map((col) => col.name));

  for (const col of COLUMNS) {
    if (!existingNames.has(col.name)) {
      db.exec(`ALTER TABLE zernio_integracoes ADD COLUMN ${col.name} ${col.def}`);
    }
  }
}
