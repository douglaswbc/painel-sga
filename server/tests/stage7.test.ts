import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage7-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3992';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.META_APP_SECRET = 'test-meta-app-secret';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { encryptSecret, hashPassword } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
const { handleLockOtp } = await import('../services/lock-otp.js');
const { createApp } = await import('../app.js');

test.after(() => {
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

test('Stage 7: CRUD fechaduras, logs, OTP WhatsApp e webhooks Meta/Fechadura', async () => {
  const db = getDb();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Portaria', ?, 'locador', 1)`,
  ).run(userId, 'portaria@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Outro Locador', ?, 'locador', 1)`,
  ).run(otherUserId, 'outro-portaria@teste.local', passwordHash);

  const locId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
     VALUES (?, ?, 'Marcos Paulo', '5511988887777', 1)`,
  ).run(locId, userId);

  const webhookSecret = 'zernio-secret-123';
  db.prepare(
    `INSERT INTO zernio_integracoes (
      id, id_usuario, provider, whatsapp_account_id, webhook_account_id, webhook_secret_ciphertext, meta_phone_number_id, meta_status
    ) VALUES (?, ?, 'zernio', 'wa-acc-1', 'wa-acc-1', ?, 'meta-phone-99', 'connected')`,
  ).run(crypto.randomUUID(), userId, encryptSecret(webhookSecret, userId));

  const token = signAuthToken(userId, 'locador');
  const otherToken = signAuthToken(otherUserId, 'locador');

  const { server, baseUrl } = await startServer();
  try {
    // 1. CRUD Fechaduras + normalization + 409 duplicate + isolation
    const createRes = await fetch(`${baseUrl}/api/fechaduras`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Garagem Central', identificador: 'Garagem 01', status: 'ativo' }),
    });
    assert.equal(createRes.status, 201);
    const createdLock = (await createRes.json()).data as { id: string; identificador: string; nome: string };
    assert.equal(createdLock.identificador, 'garagem-01');

    const dupRes = await fetch(`${baseUrl}/api/fechaduras`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Outra', identificador: 'garagem-01', status: 'ativo' }),
    });
    assert.equal(dupRes.status, 409);

    const otherListRes = await fetch(`${baseUrl}/api/fechaduras`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal((await otherListRes.json()).data.length, 0);

    const updRes = await fetch(`${baseUrl}/api/fechaduras/${createdLock.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Garagem Principal', status: 'ativo' }),
    });
    assert.equal(updRes.status, 200);
    assert.equal((await updRes.json()).data.nome, 'Garagem Principal');

    // 2. OTP flow (not_found -> unauthorized -> otp -> invalid_code -> otp_validado -> comandos + logs)
    const notFoundOutcome = handleLockOtp(userId, '5511988887777', 'abrir desconhecida');
    assert.equal(notFoundOutcome.kind, 'not_found');

    const unauthOutcome = handleLockOtp(userId, '5511900000000', 'abrir garagem-01');
    assert.equal(unauthOutcome.kind, 'unauthorized');

    const otpReq = handleLockOtp(userId, '551188887777', 'abrir garagem-01');
    assert.equal(otpReq.handled, true);
    assert.equal(otpReq.kind, 'otp');
    const codeMatch = otpReq.reply?.match(/\*(\d{6})\*/);
    assert.ok(codeMatch?.[1]);

    const badCode = handleLockOtp(userId, '551188887777', '000000');
    assert.equal(badCode.kind, 'invalid_code');

    const okCode = handleLockOtp(userId, '5511988887777', codeMatch[1]);
    assert.equal(okCode.handled, true);
    assert.equal(okCode.event, 'otp_validado');

    const cmdRow = db
      .prepare('SELECT status, token_acesso FROM fechadura_comandos WHERE id_fechadura = ?')
      .get(createdLock.id) as { status: string; token_acesso: string } | undefined;
    assert.equal(cmdRow?.status, 'pendente');
    assert.ok(cmdRow?.token_acesso);

    // 3. GET /api/fechaduras/logs joins locatarios & fechaduras
    const logsRes = await fetch(`${baseUrl}/api/fechaduras/logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(logsRes.status, 200);
    const logs = (await logsRes.json()).data as Array<{
      evento: string;
      locatarios: { nome_completo: string } | null;
      fechaduras: { nome: string } | null;
    }>;
    assert.equal(logs.length, 2);
    assert.equal(logs[0].fechaduras?.nome, 'Garagem Principal');
    assert.equal(logs.some((l) => l.evento === 'solicitado' && l.locatarios?.nome_completo === 'Marcos Paulo'), true);

    // 4. Zernio lock webhook signature + dedupe
    const lockPayload = JSON.stringify({
      id: 'zevt-1',
      event: 'message.received',
      account: { accountId: 'wa-acc-1' },
      conversation: { id: 'conv-1' },
      message: {
        direction: 'incoming',
        sender: { phoneNumber: '+5511988887777' },
        text: 'abrir garagem-01',
      },
    });

    const badSigRes = await fetch(`${baseUrl}/api/webhooks/fechadura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zernio-signature': 'sha256=invalido' },
      body: lockPayload,
    });
    assert.equal(badSigRes.status, 401);

    const validSig = crypto.createHmac('sha256', webhookSecret).update(lockPayload, 'utf8').digest('hex');
    const okZernioRes = await fetch(`${baseUrl}/api/webhooks/fechadura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zernio-signature': `sha256=${validSig}` },
      body: lockPayload,
    });
    assert.equal(okZernioRes.status, 200);
    assert.equal((await okZernioRes.json()).handled, true);

    const dupZernioRes = await fetch(`${baseUrl}/api/webhooks/fechadura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zernio-signature': `sha256=${validSig}` },
      body: lockPayload,
    });
    assert.equal(dupZernioRes.status, 200);
    assert.equal((await dupZernioRes.json()).status, 'duplicate');

    // 5. Meta webhook delivery status update with X-Hub-Signature-256
    const cobId = crypto.randomUUID();
    const ctrId = crypto.randomUUID();
    const vehId = crypto.randomUUID();
    const tplId = crypto.randomUUID();
    const delivId = crypto.randomUUID();
    db.prepare(`INSERT INTO veiculos (id, id_usuario, modelo, placa) VALUES (?, ?, 'Moto', 'ABC1D23')`).run(
      vehId,
      userId,
    );
    db.prepare(
      `INSERT INTO contratos (id, id_usuario, id_locatario, id_veiculo, valor, recorrencia, data_inicio, proxima_cobranca, status)
       VALUES (?, ?, ?, ?, 100, 'semanal', '2026-11-01', '2026-12-01', 'ativo')`,
    ).run(ctrId, userId, locId, vehId);
    db.prepare(
      `INSERT INTO cobrancas (id, id_usuario, id_contrato, id_locatario, valor, data_vencimento, status, pay_token)
       VALUES (?, ?, ?, ?, 100, '2026-12-01', 'pendente', ?)`,
    ).run(cobId, userId, ctrId, locId, crypto.randomUUID());
    db.prepare(
      `INSERT INTO zernio_whatsapp_templates (id, id_usuario, provider, account_id, meta_template_id, name, language, category, status)
       VALUES (?, ?, 'meta', 'meta-phone-99', 'tpl-ext', 'cobranca_ok', 'pt_BR', 'UTILITY', 'APPROVED')`,
    ).run(tplId, userId);
    db.prepare(
      `INSERT INTO zernio_whatsapp_deliveries (
        id, id_usuario, id_cobranca, template_id, account_id, idempotency_key, status,
        meta_template_id, template_name, template_language, message_id, provider
      ) VALUES (?, ?, ?, ?, 'meta-phone-99', 'idem-deliv-1', 'sent', 'tpl-ext', 'cobranca_ok', 'pt_BR', 'wamid.12345', 'meta')`,
    ).run(delivId, userId, cobId, tplId);

    const metaBody = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'meta-phone-99' },
                statuses: [{ id: 'wamid.12345', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    });
    const metaSig = crypto.createHmac('sha256', 'test-meta-app-secret').update(metaBody, 'utf8').digest('hex');
    const metaPostRes = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${metaSig}` },
      body: metaBody,
    });
    assert.equal(metaPostRes.status, 200);
    assert.equal((await metaPostRes.json()).statuses, 1);

    const delivRow = db
      .prepare('SELECT meta_status FROM zernio_whatsapp_deliveries WHERE id = ?')
      .get(delivId) as { meta_status: string };
    assert.equal(delivRow.meta_status, 'delivered');

    // 6. Delete lock
    const delLockRes = await fetch(`${baseUrl}/api/fechaduras/${createdLock.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(delLockRes.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
