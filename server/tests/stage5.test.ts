import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage5-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3994';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.APP_PUBLIC_URL = 'https://sga.example.com';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { hashPassword, encryptSecret } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
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

test('Stage 5: WhatsApp activity/analytics/health, schedules (BRT + lote), templates legados e midia local', async () => {
  const db = getDb();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Mensagens', ?, 'locador', 1)`,
  ).run(userId, 'msg@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Outro Locador', ?, 'locador', 1)`,
  ).run(otherUserId, 'outro-msg@teste.local', passwordHash);

  const metaTokenEnc = encryptSecret('EAA-fake-meta-token-123', userId);
  db.prepare(
    `INSERT INTO zernio_integracoes (
      id, id_usuario, provider, meta_waba_id, meta_phone_number_id,
      meta_access_token_ciphertext, meta_status, meta_display_phone_number
    ) VALUES (?, ?, 'meta', 'waba-1', 'phone-1', ?, 'connected', '+55 11 99999-0000')`,
  ).run(crypto.randomUUID(), userId, metaTokenEnc);

  const tplId = crypto.randomUUID();
  const otherTplId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO zernio_whatsapp_templates (
      id, id_usuario, provider, account_id, meta_template_id, name, language, category, status, components
    ) VALUES (?, ?, 'meta', 'phone-1', 'ext-tpl-1', 'aviso_manutencao', 'pt_BR', 'UTILITY', 'APPROVED', ?)`,
  ).run(
    tplId,
    userId,
    JSON.stringify([
      {
        type: 'BODY',
        text: 'Ola {{1}}, sua moto tera revisao agendada para amanha na oficina.',
      },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'URL', text: 'Pagar', url: 'https://sga.example.com/pagar/{{1}}' }],
      },
    ]),
  );

  db.prepare(
    `INSERT INTO zernio_whatsapp_templates (
      id, id_usuario, provider, account_id, meta_template_id, name, language, category, status, components
    ) VALUES (?, ?, 'meta', 'phone-other', 'ext-tpl-2', 'outro_tpl', 'pt_BR', 'UTILITY', 'APPROVED', '[]')`,
  ).run(otherTplId, otherUserId);

  const loc1Id = crypto.randomUUID();
  const loc2Id = crypto.randomUUID();
  const locOtherId = crypto.randomUUID();

  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
     VALUES (?, ?, 'Carlos Silva', '11999991111', 1)`,
  ).run(loc1Id, userId);
  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
     VALUES (?, ?, 'Ana Souza', '11988882222', 1)`,
  ).run(loc2Id, userId);
  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
     VALUES (?, ?, 'Terceiro', '11977773333', 1)`,
  ).run(locOtherId, otherUserId);

  const legacyTplId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO mensagens_template (id, id_usuario, ordem, titulo, conteudo, tipo)
     VALUES (?, ?, 1, 'Aviso Geral', 'Texto padrao', 'avulso')`,
  ).run(legacyTplId, userId);

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO zernio_whatsapp_manual_deliveries (
      id, id_usuario, id_locatario, template_id, account_id, idempotency_key,
      template_name, template_language, status, meta_status, provider, sent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'phone-1', 'manual-1', 'aviso_manutencao', 'pt_BR', 'sent', 'delivered', 'meta', ?, ?, ?)`,
  ).run(crypto.randomUUID(), userId, loc1Id, tplId, nowIso, nowIso, nowIso);

  db.prepare(
    `INSERT INTO zernio_whatsapp_manual_deliveries (
      id, id_usuario, id_locatario, template_id, account_id, idempotency_key,
      template_name, template_language, status, meta_status, provider, sent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'phone-other', 'manual-other', 'outro_tpl', 'pt_BR', 'sent', 'sent', 'meta', ?, ?, ?)`,
  ).run(crypto.randomUUID(), otherUserId, locOtherId, otherTplId, nowIso, nowIso, nowIso);

  const token = signAuthToken(userId, 'locador');
  const otherToken = signAuthToken(otherUserId, 'locador');

  const { server, baseUrl } = await startServer();
  try {
    const start = new Date(Date.now() - 86400_000).toISOString();
    const end = new Date(Date.now() + 86400_000).toISOString();

    // 1. Activity view & Analytics
    const activityRes = await fetch(
      `${baseUrl}/api/whatsapp/activity?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&search=Carlos`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(activityRes.status, 200);
    const activityJson = await activityRes.json();
    assert.equal(activityJson.total, 1);
    assert.equal(activityJson.activity[0].recipientName, 'Carlos Silva');
    assert.equal(activityJson.activity[0].metaStatus, 'delivered');

    const analyticsRes = await fetch(
      `${baseUrl}/api/whatsapp/analytics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = await analyticsRes.json();
    assert.equal(analyticsJson.costAvailable, true);
    assert.equal(Array.isArray(analyticsJson.analytics), true);
    assert.equal(analyticsJson.analytics.length, 1);
    assert.equal(analyticsJson.analytics[0].category, 'UTILITY');
    assert.equal(analyticsJson.analytics[0].country, 'BR');
    assert.equal(analyticsJson.analytics[0].volume, 1);
    assert.equal(analyticsJson.analytics[0].cost > 0, true);

    // 2. Schedule validation: past date rejected, future batch expands {{1}} to first name
    const pastRes = await fetch(`${baseUrl}/api/whatsapp/schedules`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId: tplId,
        tenantIds: [loc1Id],
        frequency: 'semanal',
        scheduledDate: '2020-01-01',
        scheduledTime: '08:00',
        templateParams: ['{{nome}}', 'tok-1'],
      }),
    });
    assert.equal(pastRes.status, 400);

    const futureDate = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const batchSchedRes = await fetch(`${baseUrl}/api/whatsapp/schedules`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId: tplId,
        tenantIds: [loc1Id, loc2Id],
        frequency: 'semanal',
        scheduledDate: futureDate,
        scheduledTime: '09:30',
        templateParams: ['{{nome}}', 'tok-batch'],
      }),
    });
    assert.equal(batchSchedRes.status, 201);
    const batchSchedJson = await batchSchedRes.json();
    assert.equal(batchSchedJson.count, 2);

    // 3. /api/agendamentos list, patch, delete + isolation
    const listSchedRes = await fetch(`${baseUrl}/api/agendamentos?template_id=${tplId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listSchedRes.status, 200);
    const listSchedJson = await listSchedRes.json();
    assert.equal(listSchedJson.data.length, 2);
    const carlosSched = listSchedJson.data.find((s: { id_locatario: string }) => s.id_locatario === loc1Id);
    assert.deepEqual(carlosSched.template_params, ['Carlos', 'tok-batch']);
    assert.equal(carlosSched.ativo, true);

    const patchOtherRes = await fetch(`${baseUrl}/api/agendamentos/${carlosSched.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${otherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ativo: false }),
    });
    assert.equal(patchOtherRes.status, 404);

    const patchRes = await fetch(`${baseUrl}/api/agendamentos/${carlosSched.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ativo: false, ultimo_erro: null }),
    });
    assert.equal(patchRes.status, 200);

    const delSchedRes = await fetch(`${baseUrl}/api/agendamentos/${carlosSched.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(delSchedRes.status, 200);

    // 4. Legacy templates /api/mensagens-template
    const legacyGet = await fetch(`${baseUrl}/api/mensagens-template`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(legacyGet.status, 200);
    const legacyGetJson = await legacyGet.json();
    assert.equal(legacyGetJson.data.length, 1);

    const legacyPut = await fetch(`${baseUrl}/api/mensagens-template/${legacyTplId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ titulo: 'Aviso Editado' }),
    });
    assert.equal(legacyPut.status, 200);

    const legacyDel = await fetch(`${baseUrl}/api/mensagens-template/${legacyTplId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(legacyDel.status, 200);

    // 5. Local media upload & delete (/api/media + path traversal guard)
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\n%fake'], { type: 'application/pdf' }), 'comprovante teste.pdf');

    const uploadRes = await fetch(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    assert.equal(uploadRes.status, 201);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.path.startsWith(`${userId}/`), true);
    assert.equal(uploadJson.publicUrl.startsWith('https://sga.example.com/uploads/mensagens-midia/'), true);

    const staticRes = await fetch(`${baseUrl}/uploads/mensagens-midia/${uploadJson.path}`);
    assert.equal(staticRes.status, 200);
    const staticText = await staticRes.text();
    assert.equal(staticText.includes('%PDF-1.4'), true);

    const traversalDel = await fetch(`${baseUrl}/api/media`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${otherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: uploadJson.path }),
    });
    assert.equal(traversalDel.status >= 400, true);

    const okDel = await fetch(`${baseUrl}/api/media`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: uploadJson.path }),
    });
    assert.equal(okDel.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
