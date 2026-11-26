import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage1-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3998';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { encryptSecret, hashPassword } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
const { recordMetaAlert } = await import('../services/meta-alerts.js');
const { createApp } = await import('../app.js');

test.after(() => {
  closeDb();
  resetEnvCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 1 endpoints: nav-counts, search e meta/alerts com isolamento multi-tenant', async () => {
  const db = getDb();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, ?, ?, 'locador', 1)`,
  ).run(userA, 'locadora@teste.local', 'Locador A', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, ?, ?, 'locador', 1)`,
  ).run(userB, 'locadorb@teste.local', 'Locador B', passwordHash);

  // Dados para Locador A
  const locA = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, cpf_enc, ativo)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(locA, userA, 'Carlos Silva', '5511999990001', encryptSecret('12345678901', userA, 'data'));

  const veiA = crypto.randomUUID();
  db.prepare(
    `INSERT INTO veiculos (id, id_usuario, placa, modelo, marca, ativo)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(veiA, userA, 'ABC1D23', 'Onix Plus', 'Chevrolet');

  db.prepare(
    `INSERT INTO cobrancas (id, id_usuario, id_locatario, valor, data_vencimento, status, tipo, pay_token)
     VALUES (?, ?, ?, 500, '2026-11-20', 'atrasado', 'receita', ?)`,
  ).run(crypto.randomUUID(), userA, locA, crypto.randomUUID());

  db.prepare(
    `INSERT INTO candidatos (id, id_usuario, nome, cpf, telefone, status)
     VALUES (?, ?, 'João Candidato', '11122233344', '5511999990002', 'Em análise')`,
  ).run(crypto.randomUUID(), userA);

  recordMetaAlert(userA, {
    type: 'pagamento',
    severity: 'critical',
    code: 131042,
    detail: 'Pagamento pendente na Meta',
  });

  // Dados isolados para Locador B
  const locB = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, cpf, ativo)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(locB, userB, 'Carlos Secreto B', '5511988880000', '99988877766');

  const tokenA = signAuthToken(userA, 'locador');
  const tokenB = signAuthToken(userB, 'locador');

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const countsRes = await fetch(`${baseUrl}/api/dashboard/nav-counts`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(countsRes.status, 200);
    const counts = (await countsRes.json()) as { cobrancasAtrasadas: number; candidatosPendentes: number };
    assert.equal(counts.cobrancasAtrasadas, 1);
    assert.equal(counts.candidatosPendentes, 1);

    const searchRes = await fetch(`${baseUrl}/api/search?q=Carlos`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(searchRes.status, 200);
    const search = (await searchRes.json()) as {
      tenants: Array<{ nome_completo: string; cpf: string }>;
      vehicles: Array<{ placa: string }>;
    };
    assert.equal(search.tenants.length, 1);
    assert.equal(search.tenants[0].nome_completo, 'Carlos Silva');
    assert.equal(search.tenants[0].cpf, '12345678901');

    // Busca por placa para Locador A vs Locador B
    const plateRes = await fetch(`${baseUrl}/api/search?q=ABC1`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const plateData = (await plateRes.json()) as { vehicles: Array<{ placa: string }> };
    assert.equal(plateData.vehicles.length, 1);
    assert.equal(plateData.vehicles[0].placa, 'ABC1D23');

    const plateBRes = await fetch(`${baseUrl}/api/search?q=ABC1`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const plateBData = (await plateBRes.json()) as { vehicles: Array<{ placa: string }> };
    assert.equal(plateBData.vehicles.length, 0);

    // Alertas da Meta
    const alertsRes = await fetch(`${baseUrl}/api/meta/alerts`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(alertsRes.status, 200);
    const alertsBody = (await alertsRes.json()) as { alerts: Array<{ tipo: string; bloqueante: boolean }> };
    assert.equal(alertsBody.alerts.length, 1);
    assert.equal(alertsBody.alerts[0].tipo, 'pagamento');
    assert.equal(alertsBody.alerts[0].bloqueante, true);

    const clearRes = await fetch(`${baseUrl}/api/meta/alerts/clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'pagamento' }),
    });
    assert.equal(clearRes.status, 200);
    const clearBody = (await clearRes.json()) as { alerts: unknown[]; success: boolean };
    assert.equal(clearBody.success, true);
    assert.equal(clearBody.alerts.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
