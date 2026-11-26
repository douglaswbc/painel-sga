import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage4-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3995';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { hashPassword } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
const { parseRecurrence, nextContractSchedule, paymentIdempotencyKey } = await import('../services/billing-helpers.js');
const { buildTemplateComponents, whatsappNumberVariants } = await import('../services/meta-messages.js');
const { createApp } = await import('../app.js');

test.after(() => {
  closeDb();
  resetEnvCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 4: billing helpers e meta-messages (componentes e 9o digito)', () => {
  const due = new Date('2026-11-26T20:00:00.000Z');
  const config = parseRecurrence('{"frequencia":"weekly","intervalo":2,"dias":["qui"]}', due);
  assert.equal(config.frequencia, 'weekly');
  assert.equal(config.intervalo, 2);

  const schedule = nextContractSchedule(due, 1, config);
  assert.equal(schedule.ocorrencias_realizadas, 2);
  assert.equal(schedule.status, 'ativo');

  const key1 = paymentIdempotencyKey('ctr-1', '2026-11-26');
  const key2 = paymentIdempotencyKey('ctr-1', '2026-11-26');
  assert.equal(key1, key2);
  assert.match(key1, /^[0-9a-f-]{36}$/);

  const variants = whatsappNumberVariants('5511922175013');
  assert.deepEqual(variants, ['5511922175013', '551122175013']);

  const components = buildTemplateComponents(
    [
      { type: 'BODY', text: 'Oi {{1}}, valor {{2}} vence {{3}}' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://sga.local/pagar/{{1}}' }] },
    ],
    ['Maria', 'R$ 300,00', '26/11/2026', 'tok-abc'],
  );
  assert.equal(components.length, 2);
  assert.equal((components[0].parameters as Array<{ text: string }>)[2].text, '26/11/2026');
  assert.equal((components[1].parameters as Array<{ text: string }>)[0].text, 'tok-abc');
});

test('Stage 4: Dashboard summary/charges/operational-stats e CRUD cobrancas', async () => {
  const db = getDb();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Financeiro', ?, 'locador', 1)`,
  ).run(userId, 'fin@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Outro Locador', ?, 'locador', 1)`,
  ).run(otherUserId, 'outro@teste.local', passwordHash);

  const locId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
     VALUES (?, ?, 'João Pagador', '5511999998888', 1)`,
  ).run(locId, userId);

  const veiId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO veiculos (id, id_usuario, placa, modelo, ativo)
     VALUES (?, ?, 'FIN1A23', 'Factor 150', 1)`,
  ).run(veiId, userId);

  const ctrId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO contratos (id, id_locatario, id_veiculo, id_usuario, valor, recorrencia, data_inicio, proxima_cobranca, status)
     VALUES (?, ?, ?, ?, 400, '{"frequencia":"weekly","intervalo":1}', '2026-11-01', '2026-11-26T20:00:00.000Z', 'ativo')`,
  ).run(ctrId, locId, veiId, userId);

  // Cobrança atrasada + despesa paga neste mês (America/Sao_Paulo)
  const hojeBrt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO cobrancas (id, id_contrato, id_locatario, id_usuario, valor, data_vencimento, status, tipo, pay_token)
     VALUES (?, ?, ?, ?, 400, ?, 'atrasado', 'receita', ?)`,
  ).run(crypto.randomUUID(), ctrId, locId, userId, hojeBrt, crypto.randomUUID());

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, valor, data_vencimento, data_pagamento, status, tipo, categoria, pay_token)
     VALUES (?, ?, 150, ?, ?, 'pago', 'despesa', 'manutencao', ?)`,
  ).run(crypto.randomUUID(), userId, hojeBrt, nowIso, crypto.randomUUID());

  const token = signAuthToken(userId, 'locador');
  const otherToken = signAuthToken(otherUserId, 'locador');

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const authOther = { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' };

  try {
    // 1. Criar cobrança avulsa vinculada ao contrato (auto-preenche id_locatario)
    const createRes = await fetch(`${baseUrl}/api/cobrancas`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        id_contrato: ctrId,
        valor: 250,
        data_vencimento: hojeBrt,
        categoria: 'extra',
        tipo: 'receita',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = ((await createRes.json()) as { data: { id: string; id_locatario: string; pay_token: string } }).data;
    assert.equal(created.id_locatario, locId);
    assert.ok(created.pay_token);

    // 2. Outro usuário não pode criar cobrança usando contrato de userId
    const crossRes = await fetch(`${baseUrl}/api/cobrancas`, {
      method: 'POST',
      headers: authOther,
      body: JSON.stringify({
        id_contrato: ctrId,
        valor: 250,
        data_vencimento: hojeBrt,
      }),
    });
    assert.equal(crossRes.status, 403);

    // 3. Dar baixa na cobrança criada
    const payRes = await fetch(`${baseUrl}/api/cobrancas/${created.id}/pagar`, {
      method: 'PATCH',
      headers: auth,
    });
    assert.equal(payRes.status, 200);

    // 4. Dashboard summary reflete receita (250) - despesa (150) = 100 e a receber = 400
    const sumRes = await fetch(`${baseUrl}/api/dashboard/summary`, { headers: auth });
    assert.equal(sumRes.status, 200);
    const sum = (await sumRes.json()) as {
      saldo_liquido_mes: number;
      receita_a_receber: number;
      total_atrasado: number;
      contratos_ativos: number;
      cobrancas_vencidas_mes: number;
      cobrancas_pagas_mes: number;
      adimplencia_mes: number;
    };
    assert.equal(sum.saldo_liquido_mes, 100);
    assert.equal(sum.receita_a_receber, 400);
    assert.equal(sum.total_atrasado, 400);
    assert.equal(sum.contratos_ativos, 1);
    assert.equal(sum.cobrancas_vencidas_mes, 2);
    assert.equal(sum.cobrancas_pagas_mes, 1);
    assert.equal(sum.adimplencia_mes, 50);

    // 5. Fila do Dashboard e Operational Stats
    const queueRes = await fetch(`${baseUrl}/api/dashboard/charges?page=1&pageSize=8&status=all`, {
      headers: auth,
    });
    assert.equal(queueRes.status, 200);
    const queue = (await queueRes.json()) as { items: unknown[]; total: number; statusCounts: Record<string, number> };
    assert.equal(queue.total, 1);
    assert.equal(queue.statusCounts.atrasado, 1);
    assert.equal(queue.statusCounts.pago, 1);

    const opsRes = await fetch(`${baseUrl}/api/dashboard/operational-stats`, { headers: auth });
    assert.equal(opsRes.status, 200);
    const ops = (await opsRes.json()) as { fleetStats: { total: number; alugados: number } };
    assert.equal(ops.fleetStats.total, 1);
    assert.equal(ops.fleetStats.alugados, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
