import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-integration-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3996';
process.env.APP_PUBLIC_URL = 'https://sga.integracao.local';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.META_APP_SECRET = 'integration-meta-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'integration-verify-token';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { encryptSecret, hashPassword } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
const { createApp } = await import('../app.js');

const realFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = realFetch;
  closeDb();
  resetEnvCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function startServer() {
  const app = createApp();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

test('Integração: Auth (cookie + bearer + logout), isolamento SQLite multi-tenant e Webhooks (Meta, Fechadura e Mercado Pago)', async () => {
  const db = getDb();
  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  const passwordHash = await hashPassword('SenhaForte!1');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, mp_token_ciphertext, role, ativo)
     VALUES (?, ?, 'Locador A', ?, ?, 'locador', 1)`,
  ).run(ownerA, 'a@integracao.local', passwordHash, encryptSecret('APP_USR_MP_A', ownerA, 'mp'));

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador B', ?, 'locador', 1)`,
  ).run(ownerB, 'b@integracao.local', passwordHash);

  const tokenB = signAuthToken(ownerB, 'locador');

  globalThis.fetch = (async (input: string | URL | Request, init?: Parameters<typeof realFetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('http://127.0.0.1')) {
      return realFetch(input as any, init);
    }
    if (url === 'https://api.mercadopago.com/v1/payments/mp-pay-9001') {
      return new Response(
        JSON.stringify({
          id: 'mp-pay-9001',
          status: 'approved',
          status_detail: 'accredited',
          transaction_amount: 450,
          date_approved: '2026-11-26T15:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: `Unexpected external URL: ${url}` }), { status: 500 });
  }) as typeof fetch;

  const { server, baseUrl } = await startServer();
  try {
    // 1. Auth via login -> HttpOnly cookie + Bearer + logout
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@integracao.local', password: 'SenhaForte!1' }),
    });
    assert.equal(loginRes.status, 200);
    const setCookieHeader = loginRes.headers.get('set-cookie') || '';
    const cookiePair = setCookieHeader.split(';')[0];
    assert.ok(cookiePair.startsWith('sga_token='));

    const meCookieRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(meCookieRes.status, 200);
    assert.equal((await meCookieRes.json()).user.id, ownerA);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    assert.equal(logoutRes.status, 200);
    assert.ok((logoutRes.headers.get('set-cookie') || '').includes('sga_token=;'));

    // 2. Multi-tenant isolation across SQLite foreign-key domain tables
    const locARes = await fetch(`${baseUrl}/api/locatarios`, {
      method: 'POST',
      headers: { Cookie: cookiePair, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome_completo: 'Inquilino A', whatsapp: '5511977770001' }),
    });
    assert.equal(locARes.status, 201);
    const locAId = (await locARes.json()).data.id as string;

    const vehARes = await fetch(`${baseUrl}/api/veiculos`, {
      method: 'POST',
      headers: { Cookie: cookiePair, 'Content-Type': 'application/json' },
      body: JSON.stringify({ placa: 'INT1A23', modelo: 'Polo' }),
    });
    assert.equal(vehARes.status, 201);
    const vehAId = (await vehARes.json()).data.id as string;

    // Owner B cannot create contract referencing Owner A's tenant/vehicle
    const crossContract = await fetch(`${baseUrl}/api/contratos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_locatario: locAId,
        id_veiculo: vehAId,
        valor: 450,
        recorrencia: 'semanal',
        data_inicio: '2026-11-26',
        proxima_cobranca: '2026-12-03',
      }),
    });
    assert.ok([400, 403, 404].includes(crossContract.status));

    // Owner A creates contract and charge with mercado_pago_id
    const ctrARes = await fetch(`${baseUrl}/api/contratos`, {
      method: 'POST',
      headers: { Cookie: cookiePair, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_locatario: locAId,
        id_veiculo: vehAId,
        valor: 450,
        recorrencia: 'semanal',
        data_inicio: '2026-11-26',
        proxima_cobranca: '2026-12-03',
      }),
    });
    assert.equal(ctrARes.status, 201);
    const ctrAId = (await ctrARes.json()).data.id as string;

    const cobAId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO cobrancas (id, id_usuario, id_contrato, id_locatario, valor, data_vencimento, status, mercado_pago_id, pay_token)
       VALUES (?, ?, ?, ?, 450, '2026-12-03', 'pendente', 'mp-pay-9001', ?)`,
    ).run(cobAId, ownerA, ctrAId, locAId, crypto.randomUUID());

    // 3. Mercado Pago webhook settles the charge
    const mpWebhookRes = await fetch(`${baseUrl}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment', data: { id: 'mp-pay-9001' } }),
    });
    assert.equal(mpWebhookRes.status, 200);
    const updatedCharge = db.prepare('SELECT status, data_pagamento FROM cobrancas WHERE id = ?').get(cobAId) as {
      status: string;
      data_pagamento: string | null;
    };
    assert.equal(updatedCharge.status, 'pago');
    assert.ok(updatedCharge.data_pagamento);

    // 4. Meta webhook GET challenge + invalid signature rejection
    const metaChallengeRes = await fetch(
      `${baseUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=integration-verify-token&hub.challenge=987654`,
    );
    assert.equal(metaChallengeRes.status, 200);
    assert.equal(await metaChallengeRes.text(), '987654');

    const metaInvalidSigRes = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=wrong' },
      body: JSON.stringify({ entry: [] }),
    });
    assert.equal(metaInvalidSigRes.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
