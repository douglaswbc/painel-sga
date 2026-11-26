import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage0-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3999';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ADMIN_EMAIL = 'admin@teste.local';
process.env.ADMIN_PASSWORD = 'SenhaForte123!';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'meta-verify-123';
process.env.ENABLE_CRON = 'false';

const { loadEnv, resetEnvCache } = await import('../config/env.js');
const { getDb, bootstrapAdmin, closeDb } = await import('../db/database.js');
const { encryptSecret, decryptSecret, hashPassword, verifyPassword } = await import('../utils/crypto.js');
const { createApp } = await import('../app.js');

test.after(() => {
  closeDb();
  resetEnvCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('SQLite schema, migrations, views e bootstrapAdmin', async () => {
  loadEnv();
  const db = getDb();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const tableNames = new Set(tables.map((t) => t.name));

  for (const expected of [
    'usuarios',
    'locatarios',
    'veiculos',
    'contratos',
    'cobrancas',
    'candidatos',
    'zernio_integracoes',
    'zernio_whatsapp_templates',
    'fechaduras',
    'meta_alertas',
    'email_notificacoes_config',
    '_migrations',
  ]) {
    assert.ok(tableNames.has(expected), `Tabela esperada ausente: ${expected}`);
  }

  const views = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
    .all() as Array<{ name: string }>;
  const viewNames = new Set(views.map((v) => v.name));
  assert.ok(viewNames.has('locatarios_safe'));
  assert.ok(viewNames.has('zernio_whatsapp_activity_log'));

  await bootstrapAdmin();
  const admin = db.prepare('SELECT email, role, ativo FROM usuarios WHERE email = ?').get('admin@teste.local') as {
    email: string;
    role: string;
    ativo: number;
  };
  assert.equal(admin.role, 'admin');
  assert.equal(admin.ativo, 1);
});

test('Criptografia AES-256-GCM com AAD e hash de senha', async () => {
  const ownerId = 'user-123';
  for (const scope of ['zernio', 'meta', 'resend', 'mp', 'data'] as const) {
    const cipher = encryptSecret('segredo-super-sensivel', ownerId, scope);
    const plain = decryptSecret(cipher, ownerId);
    assert.equal(plain, 'segredo-super-sensivel');
    assert.throws(() => decryptSecret(cipher, 'outro-usuario'));
  }

  const hash = await hashPassword('MinhaSenha123');
  assert.equal(await verifyPassword('MinhaSenha123', hash), true);
  assert.equal(await verifyPassword('Errada', hash), false);
});

test('HTTP server: /api/health, login, /api/auth/me e Meta webhook challenge', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { ok: boolean };
    assert.equal(health.ok, true);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@teste.local', password: 'SenhaForte123!' }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = (await loginRes.json()) as { token: string; user: { email: string; role: string } };
    assert.ok(loginBody.token);
    assert.equal(loginBody.user.role, 'admin');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    assert.equal(meRes.status, 200);
    const meBody = (await meRes.json()) as { user: { email: string } };
    assert.equal(meBody.user.email, 'admin@teste.local');

    const metaRes = await fetch(
      `${baseUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=meta-verify-123&hub.challenge=CHALLENGE_OK`,
    );
    assert.equal(metaRes.status, 200);
    assert.equal(await metaRes.text(), 'CHALLENGE_OK');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
