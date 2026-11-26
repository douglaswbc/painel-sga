import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage3-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3996';
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-32-characters-12345';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENABLE_CRON = 'false';

const { getDb, closeDb } = await import('../db/database.js');
const { resetEnvCache } = await import('../config/env.js');
const { hashPassword } = await import('../utils/crypto.js');
const { signAuthToken } = await import('../middleware/auth.js');
const { createApp } = await import('../app.js');

test.after(() => {
  closeDb();
  resetEnvCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 3: CRUD locatarios (CPF cifrado), veiculos e contratos com isolamento multi-tenant', async () => {
  const db = getDb();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador A', ?, 'locador', 1)`,
  ).run(userA, 'a@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Locador B', ?, 'locador', 1)`,
  ).run(userB, 'b@teste.local', passwordHash);

  const tokenA = signAuthToken(userA, 'locador');
  const tokenB = signAuthToken(userB, 'locador');

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const authA = { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };
  const authB = { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' };

  try {
    // 1. Criar locatário para A e verificar que CPF é criptografado em disco e devolvido descriptografado pela API
    const createLocRes = await fetch(`${baseUrl}/api/locatarios`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        nome_completo: 'Maria Souza',
        whatsapp: '5511999991111',
        documento: 'CPF',
        cpf: '123.456.789-01',
        cidade: 'São Paulo',
        estado: 'SP',
      }),
    });
    assert.equal(createLocRes.status, 201);
    const createdLoc = ((await createLocRes.json()) as { data: { id: string; cpf: string; documento: string } }).data;
    assert.equal(createdLoc.cpf, '123.456.789-01');
    assert.equal(createdLoc.documento, 'CPF');

    const rawLoc = db.prepare('SELECT cpf, documento, cpf_enc, documento_enc FROM locatarios WHERE id = ?').get(createdLoc.id) as {
      cpf: string | null;
      documento: string | null;
      cpf_enc: string | null;
      documento_enc: string | null;
    };
    assert.equal(rawLoc.cpf, null);
    assert.equal(rawLoc.documento, null);
    assert.ok(rawLoc.cpf_enc?.startsWith('vd1.'));
    assert.ok(rawLoc.documento_enc?.startsWith('vd1.'));

    // 2. Criar veículo para A
    const createVeiRes = await fetch(`${baseUrl}/api/veiculos`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        placa: 'xyz9k88',
        modelo: 'CG 160 Titan',
        marca: 'Honda',
        cor: 'Preta',
        ano: 2025,
      }),
    });
    assert.equal(createVeiRes.status, 201);
    const createdVei = ((await createVeiRes.json()) as { data: { id: string; placa: string } }).data;
    assert.equal(createdVei.placa, 'XYZ9K88');

    // 3. Locador B NÃO pode criar contrato usando locatário/veículo do Locador A
    const crossContractRes = await fetch(`${baseUrl}/api/contratos`, {
      method: 'POST',
      headers: authB,
      body: JSON.stringify({
        id_locatario: createdLoc.id,
        id_veiculo: createdVei.id,
        valor: 350,
        recorrencia: '{"frequencia":"weekly","intervalo":1}',
        data_inicio: '2026-11-26',
        proxima_cobranca: '2026-11-26T20:00:00.000Z',
        status: 'ativo',
      }),
    });
    assert.equal(crossContractRes.status, 403);

    // 4. Locador A cria contrato e vê o veículo com contrato ativo
    const createContractRes = await fetch(`${baseUrl}/api/contratos`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        id_locatario: createdLoc.id,
        id_veiculo: createdVei.id,
        valor: 350,
        recorrencia: '{"frequencia":"weekly","intervalo":1}',
        data_inicio: '2026-11-26',
        proxima_cobranca: '2026-11-26T20:00:00.000Z',
        status: 'ativo',
      }),
    });
    assert.equal(createContractRes.status, 201);
    const createdContract = ((await createContractRes.json()) as {
      data: { id: string; locatarios: { nome_completo: string }; veiculos: { placa: string } };
    }).data;
    assert.equal(createdContract.locatarios.nome_completo, 'Maria Souza');
    assert.equal(createdContract.veiculos.placa, 'XYZ9K88');

    const listVeiRes = await fetch(`${baseUrl}/api/veiculos`, { headers: authA });
    const listVei = ((await listVeiRes.json()) as { data: Array<{ contratos: Array<{ status: string }> }> }).data;
    assert.equal(listVei[0].contratos.length, 1);
    assert.equal(listVei[0].contratos[0].status, 'ativo');

    // 5. Não deve permitir excluir veículo vinculado a contrato (409)
    const delVeiBlocked = await fetch(`${baseUrl}/api/veiculos/${createdVei.id}`, {
      method: 'DELETE',
      headers: authA,
    });
    assert.equal(delVeiBlocked.status, 409);

    // 6. Excluir contrato libera exclusão de veículo e locatário
    const delContractRes = await fetch(`${baseUrl}/api/contratos/${createdContract.id}`, {
      method: 'DELETE',
      headers: authA,
    });
    assert.equal(delContractRes.status, 200);

    const delVeiOk = await fetch(`${baseUrl}/api/veiculos/${createdVei.id}`, {
      method: 'DELETE',
      headers: authA,
    });
    assert.equal(delVeiOk.status, 200);

    const delLocOk = await fetch(`${baseUrl}/api/locatarios/${createdLoc.id}`, {
      method: 'DELETE',
      headers: authA,
    });
    assert.equal(delLocOk.status, 200);

    // 7. Fluxo agnóstico: /api/ativos com atributos genéricos + contrato sem item físico (id_veiculo = null)
    const locServiceRes = await fetch(`${baseUrl}/api/locatarios`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        nome_completo: 'Empresa Alpha Ltda',
        whatsapp: '11988887777',
        documento: 'CPF',
        cpf: '52998224725',
      }),
    });
    assert.equal(locServiceRes.status, 201);
    const locService = ((await locServiceRes.json()) as { data: { id: string } }).data;

    const createAtivoRes = await fetch(`${baseUrl}/api/ativos`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        identificador: 'sala-204',
        titulo: 'Sala Comercial Centro',
        categoria: 'Imóvel',
        descricao: '40m² mobiliada',
        atributos: { andar: 2, area_m2: 40 },
      }),
    });
    assert.equal(createAtivoRes.status, 201);
    const createdAtivo = ((await createAtivoRes.json()) as {
      data: { id: string; placa: string; identificador: string; categoria: string; atributos: { andar: number } };
    }).data;
    assert.equal(createdAtivo.identificador, 'SALA-204');
    assert.equal(createdAtivo.placa, 'SALA-204');
    assert.equal(createdAtivo.categoria, 'Imóvel');
    assert.equal(createdAtivo.atributos.andar, 2);

    const serviceContractRes = await fetch(`${baseUrl}/api/contratos`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        id_locatario: locService.id,
        id_veiculo: null,
        valor: 500,
        recorrencia: '{"frequencia":"monthly","intervalo":1}',
        data_inicio: '2026-11-26',
        proxima_cobranca: '2026-11-26T20:00:00.000Z',
        status: 'ativo',
      }),
    });
    assert.equal(serviceContractRes.status, 201);
    const serviceContract = ((await serviceContractRes.json()) as {
      data: { id: string; id_veiculo: string | null; veiculos: unknown };
    }).data;
    assert.equal(serviceContract.id_veiculo, null);
    assert.equal(serviceContract.veiculos, null);

    const opStatsRes = await fetch(`${baseUrl}/api/dashboard/operational-stats`, { headers: authA });
    assert.equal(opStatsRes.status, 200);
    const opStats = (await opStatsRes.json()) as { fleetStats: { total: number; alugados: number; disponiveis: number } };
    assert.equal(opStats.fleetStats.total, 1);
    assert.equal(opStats.fleetStats.alugados, 0);
    assert.equal(opStats.fleetStats.disponiveis, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
