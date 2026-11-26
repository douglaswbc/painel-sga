import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage6-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3993';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.APP_PUBLIC_URL = 'https://sga.example.com';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { hashPassword, sha256Hex } = await import('../utils/crypto.js');
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

test('Stage 6: Link de inscricao publico, cota diaria, auditoria de status e reserva manual/PIX', async () => {
  const db = getDb();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Triagem', ?, 'locador', 1)`,
  ).run(userId, 'triagem@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Outro Locador', ?, 'locador', 1)`,
  ).run(otherUserId, 'outro-triagem@teste.local', passwordHash);

  const token = signAuthToken(userId, 'locador');
  const otherToken = signAuthToken(otherUserId, 'locador');

  const { server, baseUrl } = await startServer();
  try {
    // 1. Link status initially missing, then create, verify SHA-256 stored
    const status0 = await fetch(`${baseUrl}/api/candidatos/link-inscricao`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(status0.status, 200);
    assert.deepEqual(await status0.json(), { exists: false, active: false, expiresAt: null });

    const createLinkRes = await fetch(`${baseUrl}/api/candidatos/link-inscricao`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(createLinkRes.status, 201);
    const linkJson = (await createLinkRes.json()) as { token: string; expiresAt: string; url: string };
    assert.match(linkJson.token, /^[0-9a-f]{64}$/);
    assert.equal(linkJson.url, `https://sga.example.com/inscricao/${linkJson.token}`);

    const storedLink = db
      .prepare('SELECT id, token_hash, ativo FROM candidate_application_links WHERE id_usuario = ?')
      .get(userId) as { id: string; token_hash: string; ativo: number };
    assert.equal(storedLink.token_hash, sha256Hex(linkJson.token));
    assert.equal(storedLink.ativo, 1);

    const status1 = await fetch(`${baseUrl}/api/candidatos/link-inscricao`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status1Json = (await status1.json()) as { exists: boolean; active: boolean };
    assert.equal(status1Json.exists, true);
    assert.equal(status1Json.active, true);

    const validAnswers = {
      nome: 'João Pedro Silva',
      cpf: '52998224725',
      telefone: '11999998888',
      email: 'joao.candidato@teste.local',
      idade_faixa: '25 a 34',
      tem_220v: true,
      trabalha_em_app: true,
      caucao_disponivel: 'Sim, integral',
      possui_processos_criminais: false,
    };
    const okStartedAt = Date.now() - 10_000;

    // 2. Public endpoint guards: invalid token, bot speed, honeypot, invalid CPF
    const badTokenRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'a'.repeat(64),
        answers: validAnswers,
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(badTokenRes.status, 404);

    const fastRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: validAnswers,
        startedAt: Date.now(),
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(fastRes.status, 400);

    const honeypotRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: validAnswers,
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: 'https://bot.spam',
      }),
    });
    assert.equal(honeypotRes.status, 200);
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM candidatos').get() as { c: number }).c, 0);

    const badCpfRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: { ...validAnswers, cpf: '12345678900' },
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(badCpfRes.status, 400);

    // 3. Valid public submission -> inserts candidate + audit + increments quota
    const submitRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: validAnswers,
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(submitRes.status, 200);

    // Duplicate CPF -> 409
    const dupRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: validAnswers,
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(dupRes.status, 409);

    // Quota exhaustion -> 429
    db.prepare('UPDATE candidate_application_links SET requests_today = 50 WHERE id = ?').run(storedLink.id);
    const quotaRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: { ...validAnswers, cpf: '11144477735' },
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(quotaRes.status, 429);

    // Deactivate link -> public submit returns 404
    const delLinkRes = await fetch(`${baseUrl}/api/candidatos/link-inscricao`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(delLinkRes.status, 200);
    const afterDeactRes = await fetch(`${baseUrl}/api/public/inscricao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: linkJson.token,
        answers: { ...validAnswers, cpf: '11144477735' },
        startedAt: okStartedAt,
        privacyNoticeRead: true,
        website: '',
      }),
    });
    assert.equal(afterDeactRes.status, 404);

    // 4. List & multi-tenant isolation
    const listOtherRes = await fetch(`${baseUrl}/api/candidatos`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(listOtherRes.status, 200);
    assert.equal((await listOtherRes.json()).data.length, 0);

    const listRes = await fetch(`${baseUrl}/api/candidatos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listRes.status, 200);
    const candidates = (await listRes.json()).data as Array<Record<string, unknown>>;
    assert.equal(candidates.length, 1);
    const cand = candidates[0];
    assert.equal(cand.nome, 'João Pedro Silva');
    assert.equal(cand.tem_220v, true);
    assert.equal(cand.possui_processos_criminais, false);
    const candId = String(cand.id);

    // 5. Status transition & automatic audit
    const crossUpdate = await fetch(`${baseUrl}/api/candidatos/${candId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Pré-aprovado' }),
    });
    assert.equal(crossUpdate.status, 404);

    const approveRes = await fetch(`${baseUrl}/api/candidatos/${candId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Pré-aprovado' }),
    });
    assert.equal(approveRes.status, 200);
    assert.equal((await approveRes.json()).data.status, 'Pré-aprovado');

    const invalidJumpRes = await fetch(`${baseUrl}/api/candidatos/${candId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Vaga reservada' }),
    });
    assert.equal(invalidJumpRes.status, 400);

    // 6. Active PIX reuse + manual confirmation block/unlock
    const futureExp = new Date(Date.now() + 3600_000).toISOString();
    db.prepare(
      `UPDATE candidatos
       SET pagamento_id = 'mp-pix-99', pagamento_status = 'Pendente', status = 'Aguardando reserva',
           pix_qr_code = 'base64qr', pix_copia_e_cola = '000201PIX', reserva_expira_em = ?,
           reserva_idempotency_key = 'idem-1', reserva_valor = 35
       WHERE id = ?`,
    ).run(futureExp, candId);

    const reusePixRes = await fetch(`${baseUrl}/api/candidatos/${candId}/reserva-pix`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'joao.candidato@teste.local', valorCentavos: 3500 }),
    });
    assert.equal(reusePixRes.status, 200);
    const reusePixJson = await reusePixRes.json();
    assert.equal(reusePixJson.alreadyExists, true);
    assert.equal(reusePixJson.paymentId, 'mp-pix-99');

    // Manual confirm blocked while active PIX exists
    const blockedManual = await fetch(`${baseUrl}/api/candidatos/${candId}/confirmar-reserva-manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Comprovante recebido em mãos no escritório' }),
    });
    assert.equal(blockedManual.status, 409);

    // Expire PIX, reject short reason, then confirm manually
    db.prepare(
      `UPDATE candidatos SET reserva_expira_em = ? WHERE id = ?`,
    ).run(new Date(Date.now() - 60_000).toISOString(), candId);

    const shortManual = await fetch(`${baseUrl}/api/candidatos/${candId}/confirmar-reserva-manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'curto' }),
    });
    assert.equal(shortManual.status, 400);

    const okManual = await fetch(`${baseUrl}/api/candidatos/${candId}/confirmar-reserva-manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Pagamento em espécie conferido pelo locador' }),
    });
    assert.equal(okManual.status, 200);
    const okManualJson = await okManual.json();
    assert.equal(okManualJson.data.status, 'Vaga reservada');
    assert.equal(okManualJson.data.pagamento_status, 'Confirmado manualmente');

    // 7. History endpoint returns inscricao_recebida, alteracao_status and confirmacao_manual
    const histRes = await fetch(`${baseUrl}/api/candidatos/${candId}/reserva-historico`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(histRes.status, 200);
    const histJson = (await histRes.json()) as { audit: Array<{ acao: string }>; payments: unknown[] };
    const actions = histJson.audit.map((a) => a.acao);
    assert.equal(actions.includes('inscricao_recebida'), true);
    assert.equal(actions.includes('alteracao_status'), true);
    assert.equal(actions.includes('confirmacao_manual'), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
