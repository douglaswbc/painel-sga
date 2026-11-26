import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage2-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3997';
process.env.APP_PUBLIC_URL = 'https://sga.teste.local';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { hashPassword } = await import('../utils/crypto.js');
const { createApp } = await import('../app.js');

test.after(() => {
  closeDb();
  resetEnvCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 2: /pagar/:token redireciona corretamente todos os estados e /api/auth/login valida inativo/senha', async () => {
  const db = getDb();
  const userId = crypto.randomUUID();
  const inactiveUserId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Ativo', ?, 'locador', 1)`,
  ).run(userId, 'ativo@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Inativo', ?, 'locador', 0)`,
  ).run(inactiveUserId, 'inativo@teste.local', passwordHash);

  const validToken = crypto.randomUUID();
  const paidToken = crypto.randomUUID();
  const cancelledToken = crypto.randomUUID();
  const expiredToken = crypto.randomUUID();
  const unsafeLinkToken = crypto.randomUUID();
  const missingToken = crypto.randomUUID();

  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  const pastIso = new Date(Date.now() - 3600_000).toISOString();

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, valor, data_vencimento, status, tipo, payment_link, pix_expires_at, pay_token)
     VALUES (?, ?, 100, '2026-11-30', 'pendente', 'receita', 'https://www.mercadopago.com.br/payments/123', ?, ?)`,
  ).run(crypto.randomUUID(), userId, futureIso, validToken);

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, valor, data_vencimento, status, tipo, payment_link, pix_expires_at, pay_token)
     VALUES (?, ?, 100, '2026-11-30', 'pago', 'receita', 'https://www.mercadopago.com.br/payments/124', ?, ?)`,
  ).run(crypto.randomUUID(), userId, futureIso, paidToken);

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, valor, data_vencimento, status, tipo, payment_link, pix_expires_at, pay_token)
     VALUES (?, ?, 100, '2026-11-30', 'cancelado', 'receita', 'https://www.mercadopago.com.br/payments/125', ?, ?)`,
  ).run(crypto.randomUUID(), userId, futureIso, cancelledToken);

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, valor, data_vencimento, status, tipo, payment_link, pix_expires_at, pay_token)
     VALUES (?, ?, 100, '2026-11-30', 'pendente', 'receita', 'https://www.mercadopago.com.br/payments/126', ?, ?)`,
  ).run(crypto.randomUUID(), userId, pastIso, expiredToken);

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, valor, data_vencimento, status, tipo, payment_link, pix_expires_at, pay_token)
     VALUES (?, ?, 100, '2026-11-30', 'pendente', 'receita', 'http://insecure.local/127', ?, ?)`,
  ).run(crypto.randomUUID(), userId, futureIso, unsafeLinkToken);

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const validRes = await fetch(`${baseUrl}/pagar/${validToken}`, { redirect: 'manual' });
    assert.equal(validRes.status, 302);
    assert.equal(validRes.headers.get('location'), 'https://www.mercadopago.com.br/payments/123');

    const paidRes = await fetch(`${baseUrl}/pagar/${paidToken}`, { redirect: 'manual' });
    assert.equal(paidRes.status, 302);
    assert.equal(paidRes.headers.get('location'), 'https://sga.teste.local/pagar/aviso/pago');

    const cancelledRes = await fetch(`${baseUrl}/pagar/${cancelledToken}`, { redirect: 'manual' });
    assert.equal(cancelledRes.status, 302);
    assert.equal(cancelledRes.headers.get('location'), 'https://sga.teste.local/pagar/aviso/cancelado');

    const expiredRes = await fetch(`${baseUrl}/pagar/${expiredToken}`, { redirect: 'manual' });
    assert.equal(expiredRes.status, 302);
    assert.equal(expiredRes.headers.get('location'), 'https://sga.teste.local/pagar/aviso/expirado');

    const unsafeRes = await fetch(`${baseUrl}/pagar/${unsafeLinkToken}`, { redirect: 'manual' });
    assert.equal(unsafeRes.status, 302);
    assert.equal(unsafeRes.headers.get('location'), 'https://sga.teste.local/pagar/aviso/indisponivel');

    const missingRes = await fetch(`${baseUrl}/pagar/${missingToken}`, { redirect: 'manual' });
    assert.equal(missingRes.status, 302);
    assert.equal(missingRes.headers.get('location'), 'https://sga.teste.local/pagar/aviso/invalido');

    const badFormatRes = await fetch(`${baseUrl}/pagar/nao-e-uuid`, { redirect: 'manual' });
    assert.equal(badFormatRes.status, 302);
    assert.equal(badFormatRes.headers.get('location'), 'https://sga.teste.local/pagar/aviso/invalido');

    // Login com usuário inativo e senha errada
    const inactiveRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inativo@teste.local', password: 'Senha123!' }),
    });
    assert.equal(inactiveRes.status, 403);

    const wrongPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ativo@teste.local', password: 'Errada!' }),
    });
    assert.equal(wrongPassRes.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
