import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage8-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3993';
process.env.APP_PUBLIC_URL = 'https://sga.teste.local';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.META_APP_ID = 'meta-app-123';
process.env.META_APP_SECRET = 'meta-secret-456';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'meta-verify-token';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { hashPassword } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
const {
  buildDailySummaryEmail,
  getYesterdayBrtRange,
  runDailySummaryCron,
  summarizeDailyData,
} = await import('../services/daily-summary.js');
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

test('Stage 8: Conta (/api/account), Zernio + Onboarding, Meta Cloud API e Email/Resumo Diário', async () => {
  const db = getDb();
  const ownerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, empresa_nome, whatsapp, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Oito', 'Frota Oito', '5511999990008', ?, 'locador', 1)`,
  ).run(ownerId, 'locador8@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, whatsapp, password_hash, role, ativo)
     VALUES (?, ?, 'Outro Locador', '5511999990009', ?, 'locador', 1)`,
  ).run(otherId, 'outro8@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Admin Oito', ?, 'admin', 1)`,
  ).run(adminId, 'admin8@teste.local', passwordHash);

  const ownerToken = signAuthToken(ownerId, 'locador');
  const adminToken = signAuthToken(adminId, 'admin');

  const capturedWebhookBodies: Array<Record<string, unknown>> = [];
  const sentEmails: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: Parameters<typeof realFetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('http://127.0.0.1')) {
      return realFetch(input as any, init);
    }

    const jsonRes = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    // Zernio API mocks
    if (url === 'https://zernio.com/api/v1/profiles') {
      return jsonRes({
        profiles: [{ _id: '660000000000000000000001', name: 'Perfil Frota Oito' }],
      });
    }
    if (url.startsWith('https://zernio.com/api/v1/accounts?')) {
      return jsonRes({
        accounts: [
          {
            _id: '660000000000000000000002',
            platform: 'whatsapp',
            displayName: 'WhatsApp Principal',
            phoneNumber: '+5511999990008',
            isActive: true,
            profileId: '660000000000000000000001',
          },
        ],
      });
    }
    if (url === 'https://zernio.com/api/v1/webhooks/settings') {
      const parsed = JSON.parse(String(init?.body ?? '{}'));
      capturedWebhookBodies.push(parsed);
      return jsonRes({ webhook: { _id: 'wh-zernio-1' } });
    }
    if (url.startsWith('https://zernio.com/api/v1/connect/whatsapp?')) {
      const parsedUrl = new URL(url);
      const redirectUrl = parsedUrl.searchParams.get('redirect_url') || '';
      assert.ok(redirectUrl.startsWith('https://sga.teste.local/zernio/callback?sga_state='));
      return jsonRes({ authUrl: 'https://www.facebook.com/v23.0/dialog/oauth?state=abc' });
    }
    if (url.startsWith('https://zernio.com/api/v1/accounts/660000000000000000000002') && init?.method === 'DELETE') {
      return jsonRes({ success: true });
    }

    // Meta Graph API mocks
    if (url.includes('/oauth/access_token')) {
      return new Response('EAA_TEST_META_LONG_LIVED_TOKEN_12345678901234567890', { status: 200 });
    }
    if (url.includes('/debug_token')) {
      return jsonRes({
        data: {
          is_valid: true,
          user_id: '9988776655443322',
          expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 60,
          granular_scopes: [{ target_ids: ['102290129340398'] }],
        },
      });
    }
    if (url.includes('/102290129340398/phone_numbers')) {
      return jsonRes({
        data: [{ id: '106540352242922', display_phone_number: '+55 11 98888-1111', verified_name: 'Frota 1', quality_rating: 'GREEN' }],
      });
    }
    if (url.includes('/102290129340398/subscribed_apps')) {
      return jsonRes({ success: true });
    }
    if (url.includes('/102290129340398')) {
      return jsonRes({ id: '102290129340398', name: 'WABA Frota Oito' });
    }
    if (url.includes('/106540352242922/register') || url.includes('/106540352242933/register')) {
      return jsonRes({ success: true });
    }
    if (url.includes('/106540352242922') || url.includes('/106540352242933')) {
      return jsonRes({
        id: url.includes('106540352242933') ? '106540352242933' : '106540352242922',
        display_phone_number: '+55 11 98888-1111',
        verified_name: 'Frota Oito',
        quality_rating: 'GREEN',
        name_status: 'APPROVED',
        code_verification_status: 'VERIFIED',
        messaging_limit_tier: 'TIER_1K',
      });
    }

    // Resend API mocks
    if (url === 'https://api.resend.com/domains') {
      return jsonRes({ data: [{ id: 'dom-1', name: 'teste.local' }] });
    }
    if (url === 'https://api.resend.com/emails') {
      const parsed = JSON.parse(String(init?.body ?? '{}'));
      sentEmails.push(parsed);
      return jsonRes({ id: `re_msg_${sentEmails.length}` });
    }

    return jsonRes({ error: `Unmocked external URL: ${url}` }, 500);
  }) as typeof fetch;

  const { server, baseUrl } = await startServer();
  try {
    // 1. Account secrets & profile
    const secEmpty = await fetch(`${baseUrl}/api/account/secrets`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(secEmpty.status, 200);
    assert.equal((await secEmpty.json()).mp_token, '');

    const secSave = await fetch(`${baseUrl}/api/account/secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretType: 'mp_token', value: 'APP_USR-secret-token-999' }),
    });
    assert.equal(secSave.status, 200);

    const secRead = await fetch(`${baseUrl}/api/account/secrets`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal((await secRead.json()).mp_token, 'APP_USR-secret-token-999');

    // Duplicate WhatsApp returns 409
    const dupPhone = await fetch(`${baseUrl}/api/account/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsapp: '5511999990009' }),
    });
    assert.equal(dupPhone.status, 409);

    // Update profile + password
    const badPwd = await fetch(`${baseUrl}/api/account/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: 'wrong', new_password: 'NovaSenha123!' }),
    });
    assert.equal(badPwd.status, 400);

    const updProfile = await fetch(`${baseUrl}/api/account/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_completo: 'Locador Oito Atualizado',
        reminder_stagger_minutes: 4,
        reminder_dispatch_delay_seconds: 8,
        current_password: 'Senha123!',
        new_password: 'NovaSenha123!',
      }),
    });
    assert.equal(updProfile.status, 200);
    const updJson = await updProfile.json();
    assert.equal(updJson.user.nome_completo, 'Locador Oito Atualizado');
    assert.equal(updJson.user.reminder_stagger_minutes, 4);

    // Verify login works with new password
    const loginNew = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'locador8@teste.local', password: 'NovaSenha123!' }),
    });
    assert.equal(loginNew.status, 200);

    // 2. Zernio Integration (403 for admin, full flow for locador)
    const adminZernio = await fetch(`${baseUrl}/api/integrations/zernio`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminZernio.status, 403);

    const validZernioKey = `sk_${'a'.repeat(64)}`;
    const zVal = await fetch(`${baseUrl}/api/integrations/zernio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'validate', apiKey: validZernioKey }),
    });
    assert.equal(zVal.status, 200);
    const zValJson = await zVal.json();
    assert.equal(zValJson.integration.hasApiKey, true);
    assert.equal(zValJson.integration.keyLast4, 'aaaa');
    assert.equal(zValJson.profiles.length, 1);

    const zSel = await fetch(`${baseUrl}/api/integrations/zernio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        profileId: '660000000000000000000001',
        accountId: '660000000000000000000002',
      }),
    });
    assert.equal(zSel.status, 200);
    const zSelJson = await zSel.json();
    assert.equal(zSelJson.webhookWarning, null);
    assert.equal(zSelJson.integration.account.id, '660000000000000000000002');
    assert.equal(capturedWebhookBodies[0]?.url, 'https://sga.teste.local/api/webhooks/fechadura');

    // 3. Zernio Onboarding (start -> disconnect -> start -> complete -> replay 409 -> cancel)
    const zDisc = await fetch(`${baseUrl}/api/integrations/zernio/onboarding/disconnect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(zDisc.status, 200);
    assert.equal((await zDisc.json()).integration.account, null);

    const zStart = await fetch(`${baseUrl}/api/integrations/zernio/onboarding/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: '660000000000000000000001', onboardingMode: 'api' }),
    });
    assert.equal(zStart.status, 200);
    const zStartJson = await zStart.json();
    assert.ok(zStartJson.authUrl.startsWith('https://www.facebook.com/'));

    // Test cancel on pending session
    const zCancel = await fetch(`${baseUrl}/api/integrations/zernio/onboarding/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: '660000000000000000000001' }),
    });
    assert.equal(zCancel.status, 200);
    assert.equal((await zCancel.json()).cancelled, 1);

    // Insert a pending session with known state to test /onboarding/complete
    const knownState = 'sga_known_state_token_for_testing_1234567890123456';
    const knownHash = crypto.createHash('sha256').update(knownState, 'utf8').digest('hex');
    db.prepare(
      `INSERT INTO zernio_onboarding_sessions (
        id, id_usuario, state_hash, zernio_profile_id, onboarding_mode, status, expires_at
      ) VALUES (?, ?, ?, '660000000000000000000001', 'api', 'pending', ?)`,
    ).run(crypto.randomUUID(), ownerId, knownHash, new Date(Date.now() + 600_000).toISOString());

    const zComplete = await fetch(`${baseUrl}/api/integrations/zernio/onboarding/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sgaState: knownState,
        connected: 'whatsapp',
        callbackProfileId: '660000000000000000000001',
        accountId: '660000000000000000000002',
        platform: 'whatsapp',
      }),
    });
    assert.equal(zComplete.status, 200);
    const zCompleteJson = await zComplete.json();
    assert.equal(zCompleteJson.outcome, 'completed');
    assert.equal(zCompleteJson.integration.account.id, '660000000000000000000002');

    // Cancelled callback outcome
    const cancelState = 'sga_cancel_state_token_for_testing_123456789012345';
    const cancelHash = crypto.createHash('sha256').update(cancelState, 'utf8').digest('hex');
    db.prepare(
      `INSERT INTO zernio_onboarding_sessions (
        id, id_usuario, state_hash, zernio_profile_id, onboarding_mode, status, expires_at
      ) VALUES (?, ?, ?, '660000000000000000000001', 'api', 'pending', ?)`,
    ).run(crypto.randomUUID(), ownerId, cancelHash, new Date(Date.now() + 600_000).toISOString());

    const zCancelCb = await fetch(`${baseUrl}/api/integrations/zernio/onboarding/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgaState: cancelState, callbackError: 'connection_cancelled' }),
    });
    assert.equal(zCancelCb.status, 200);
    assert.equal((await zCancelCb.json()).outcome, 'cancelled');

    // Expired session -> 409
    const expState = 'sga_expired_state_token_for_testing_12345678901234';
    const expHash = crypto.createHash('sha256').update(expState, 'utf8').digest('hex');
    db.prepare(
      `INSERT INTO zernio_onboarding_sessions (
        id, id_usuario, state_hash, zernio_profile_id, onboarding_mode, status, expires_at
      ) VALUES (?, ?, ?, '660000000000000000000001', 'api', 'pending', ?)`,
    ).run(crypto.randomUUID(), ownerId, expHash, new Date(Date.now() - 60_000).toISOString());

    const zExpCb = await fetch(`${baseUrl}/api/integrations/zernio/onboarding/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgaState: expState, connected: 'whatsapp' }),
    });
    assert.equal(zExpCb.status, 409);

    // 4. Meta Cloud API integration
    const mStatus = await fetch(`${baseUrl}/api/integrations/meta`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(mStatus.status, 200);
    const mStatusJson = await mStatus.json();
    assert.equal(mStatusJson.webhookUrl, `https://sga.teste.local/api/webhooks/meta/${ownerId}`);

    const mManual = await fetch(`${baseUrl}/api/integrations/meta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'validate_manual',
        accessToken: 'EAA_MANUAL_TOKEN_VALID_123456789012345678901234567890',
        phoneNumberId: '106540352242922',
        wabaId: '102290129340398',
        appSecret: 'locador1_meta_secret_1234',
        webhookVerifyToken: 'locador1_verify_5678',
      }),
    });
    assert.equal(mManual.status, 200);
    const mManualJson = await mManual.json();
    assert.equal(mManualJson.integration.provider, 'meta');
    assert.equal(mManualJson.integration.meta.status, 'connected');
    assert.equal(mManualJson.integration.meta.hasAppSecret, true);
    assert.equal(mManualJson.integration.meta.appSecretLast4, '1234');
    assert.equal(mManualJson.integration.meta.hasWebhookVerifyToken, true);
    assert.equal(mManualJson.integration.meta.webhookVerifyTokenLast4, '5678');

    // Rotate per-landlord webhook credentials independently
    const mWebhookSave = await fetch(`${baseUrl}/api/integrations/meta/webhook-settings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appSecret: 'locador1_rotated_secret_8888',
        webhookVerifyToken: 'locador1_rotated_verify_9999',
      }),
    });
    assert.equal(mWebhookSave.status, 200);
    const mWebhookSaveJson = await mWebhookSave.json();
    assert.equal(mWebhookSaveJson.integration.meta.appSecretLast4, '8888');
    assert.equal(mWebhookSaveJson.integration.meta.webhookVerifyTokenLast4, '9999');

    // Per-landlord Meta webhook challenge verification (GET /api/webhooks/meta/:ownerId)
    const whGetGlobalToken = await fetch(
      `${baseUrl}/api/webhooks/meta/${ownerId}?hub.mode=subscribe&hub.verify_token=meta-verify-token&hub.challenge=NOPE`,
    );
    assert.equal(whGetGlobalToken.status, 403);

    const whGetOk = await fetch(
      `${baseUrl}/api/webhooks/meta/${ownerId}?hub.mode=subscribe&hub.verify_token=locador1_rotated_verify_9999&hub.challenge=CHALLENGE_LOCADOR_1`,
    );
    assert.equal(whGetOk.status, 200);
    assert.equal(await whGetOk.text(), 'CHALLENGE_LOCADOR_1');

    // Per-landlord Meta webhook HMAC validation (POST /api/webhooks/meta/:ownerId)
    const sampleMetaBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const badSig = crypto.createHmac('sha256', 'meta-secret-456').update(sampleMetaBody).digest('hex');
    const whPostBad = await fetch(`${baseUrl}/api/webhooks/meta/${ownerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${badSig}` },
      body: sampleMetaBody,
    });
    assert.equal(whPostBad.status, 401);

    const goodSig = crypto
      .createHmac('sha256', 'locador1_rotated_secret_8888')
      .update(sampleMetaBody)
      .digest('hex');
    const whPostOk = await fetch(`${baseUrl}/api/webhooks/meta/${ownerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${goodSig}` },
      body: sampleMetaBody,
    });
    assert.equal(whPostOk.status, 200);
    assert.equal((await whPostOk.json()).ok, true);

    // Cross-tenant isolation on /api/webhooks/meta/:otherId
    const otherToken = signAuthToken(otherId, 'locador');
    const otherWhSave = await fetch(`${baseUrl}/api/integrations/meta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_webhook',
        appSecret: 'locador2_secret_7777',
        webhookVerifyToken: 'locador2_verify_5555',
      }),
    });
    assert.equal(otherWhSave.status, 200);

    const crossTenantPost = await fetch(`${baseUrl}/api/webhooks/meta/${otherId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${goodSig}` },
      body: sampleMetaBody,
    });
    assert.equal(crossTenantPost.status, 401);

    // Switch back to zernio and then back to meta via activate
    const actZernio = await fetch(`${baseUrl}/api/integrations/meta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate', provider: 'zernio' }),
    });
    assert.equal((await actZernio.json()).integration.provider, 'zernio');

    const actMeta = await fetch(`${baseUrl}/api/integrations/meta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate', provider: 'meta' }),
    });
    assert.equal((await actMeta.json()).integration.provider, 'meta');

    const mRefresh = await fetch(`${baseUrl}/api/integrations/meta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh' }),
    });
    assert.equal(mRefresh.status, 200);

    const mDisconnect = await fetch(`${baseUrl}/api/integrations/meta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    });
    assert.equal(mDisconnect.status, 200);
    const mDiscJson = await mDisconnect.json();
    assert.equal(mDiscJson.integration.meta.status, 'missing');
    assert.equal(mDiscJson.integration.meta.hasAppSecret, false);
    assert.equal(mDiscJson.integration.meta.hasWebhookVerifyToken, false);
    assert.equal(mDiscJson.integration.provider, 'zernio');

    // 5. Email Settings + Daily Summary + Cron idempotency
    const eSave = await fetch(`${baseUrl}/api/integrations/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        enabled: true,
        fromEmail: 'avisos@teste.local',
        fromName: 'Painel SGA',
        apiKey: 're_1234567890abcdef1234567890abcdef',
        preferences: { notificar_resumo_diario: true, notificar_limite_envio: false },
      }),
    });
    assert.equal(eSave.status, 200);
    const eSaveJson = await eSave.json();
    assert.equal(eSaveJson.config.hasKey, true);
    assert.equal(eSaveJson.config.preferences.notificar_limite_envio, false);
    assert.equal(eSaveJson.config.preferences.notificar_resumo_diario, true);

    const eTest = await fetch(`${baseUrl}/api/integrations/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    });
    assert.equal(eTest.status, 200);
    assert.equal(sentEmails.length, 1);

    // Seed yesterday's charge & activity for daily summary
    const fixedNow = new Date('2026-11-26T11:00:00.000Z'); // 08:00 BRT
    const yesterdayRange = getYesterdayBrtRange(fixedNow);
    const locId = crypto.randomUUID();
    const vehId = crypto.randomUUID();
    const ctrId = crypto.randomUUID();
    const tplId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
       VALUES (?, ?, 'Carlos Souza', '5511988887777', 1)`,
    ).run(locId, ownerId);
    db.prepare(`INSERT INTO veiculos (id, id_usuario, placa, modelo) VALUES (?, ?, 'XYZ9K99', 'Onix')`).run(
      vehId,
      ownerId,
    );
    db.prepare(
      `INSERT INTO contratos (id, id_usuario, id_locatario, id_veiculo, valor, recorrencia, data_inicio, proxima_cobranca, status)
       VALUES (?, ?, ?, ?, 650, 'semanal', '2026-11-01', '2026-12-01', 'ativo')`,
    ).run(ctrId, ownerId, locId, vehId);

    // Seed one paid charge due yesterday (for manual/cron summary check using current BRT yesterday too)
    const currentYesterday = getYesterdayBrtRange(new Date()).referenceDate;
    db.prepare(
      `INSERT INTO cobrancas (id, id_usuario, id_contrato, id_locatario, valor, data_vencimento, status, tipo, categoria, pay_token)
       VALUES (?, ?, ?, ?, 650, ?, 'pago', 'receita', 'aluguel', ?)`,
    ).run(crypto.randomUUID(), ownerId, ctrId, locId, currentYesterday, crypto.randomUUID());

    db.prepare(
      `INSERT INTO zernio_whatsapp_templates (id, id_usuario, provider, account_id, meta_template_id, name, language, category, status)
       VALUES (?, ?, 'zernio', '660000000000000000000002', 'tpl-1', 'cobranca_aluguel', 'pt_BR', 'UTILITY', 'APPROVED')`,
    ).run(tplId, ownerId);

    const eSummary = await fetch(`${baseUrl}/api/integrations/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_daily_summary' }),
    });
    assert.equal(eSummary.status, 200);
    const eSummaryJson = await eSummary.json();
    assert.equal(eSummaryJson.summary.paid.total, 650);
    assert.equal(sentEmails.length, 2);

    // Run cron twice -> first sends, second skips (already_sent_for_date)
    const cron1 = await runDailySummaryCron(fixedNow);
    assert.equal(cron1.sent, 1);
    const cron2 = await runDailySummaryCron(fixedNow);
    assert.equal(cron2.sent, 0);
    assert.equal(cron2.skipped, 1);
    assert.equal(cron2.results[0]?.reason, 'already_sent_for_date');

    // Pure daily summary unit checks
    assert.equal(yesterdayRange.referenceDate, '2026-11-25');
    const summaryData = summarizeDailyData(
      '2026-11-25',
      [{ id: '1', valor: 650, status: 'pago', tipo: 'receita', locatarios: { nome_completo: 'Maria' } }],
      [{ status: 'sent', category: 'UTILITY', recipient_phone: '5511988887777' }],
    );
    const built = buildDailySummaryEmail({
      ownerName: 'Douglas',
      companyName: 'Locadora Prime',
      summary: summaryData,
      appUrl: 'https://sga.teste.local',
    });
    assert.ok(built.html.includes('https://sga.teste.local/cobrancas'));

    // Disable email
    const eDisable = await fetch(`${baseUrl}/api/integrations/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable' }),
    });
    assert.equal(eDisable.status, 200);
    assert.equal((await eDisable.json()).config.enabled, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
