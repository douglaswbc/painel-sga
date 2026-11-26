import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sga-stage9-'));
process.env.NODE_ENV = 'test';
process.env.PORT = '3994';
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

async function startServer() {
  const app = createApp();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

test('Stage 9: Administração de usuários (/api/admin/usuarios) com requireAdmin e exclusão em cascata', async () => {
  const db = getDb();
  const adminId = crypto.randomUUID();
  const landlordId = crypto.randomUUID();
  const passwordHash = await hashPassword('Senha123!');

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
     VALUES (?, ?, 'Super Admin', ?, 'admin', 1)`,
  ).run(adminId, 'admin9@teste.local', passwordHash);

  db.prepare(
    `INSERT INTO usuarios (id, email, nome_completo, whatsapp, password_hash, role, ativo)
     VALUES (?, ?, 'Locador Nove', '5511999990909', ?, 'locador', 1)`,
  ).run(landlordId, 'locador9@teste.local', passwordHash);

  const adminToken = signAuthToken(adminId, 'admin');
  const landlordToken = signAuthToken(landlordId, 'locador');

  const { server, baseUrl } = await startServer();
  try {
    // 1. Non-admin is blocked with 403
    const forbiddenRes = await fetch(`${baseUrl}/api/admin/usuarios`, {
      headers: { Authorization: `Bearer ${landlordToken}` },
    });
    assert.equal(forbiddenRes.status, 403);

    // 2. List users
    const listRes = await fetch(`${baseUrl}/api/admin/usuarios`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.data.length, 2);
    assert.equal(typeof listJson.data[0].ativo, 'boolean');

    // 3. Create user with password & role
    const createRes = await fetch(`${baseUrl}/api/admin/usuarios`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'novo.locador@teste.local',
        password: 'NovaSenha9!',
        nome_completo: 'Novo Locador',
        whatsapp: '5511988889000',
        role: 'locador',
        ativo: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = await createRes.json();
    const createdId = createdJson.userId as string;
    assert.equal(createdJson.data.role, 'locador');
    assert.equal(createdJson.data.ativo, true);

    // Duplicate email -> 409
    const dupEmailRes = await fetch(`${baseUrl}/api/admin/usuarios`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'novo.locador@teste.local',
        password: 'NovaSenha9!',
        nome_completo: 'Duplicado',
        role: 'locador',
      }),
    });
    assert.equal(dupEmailRes.status, 409);

    // Created user can log in immediately
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'novo.locador@teste.local', password: 'NovaSenha9!' }),
    });
    assert.equal(loginRes.status, 200);

    // 4. Update user (PUT /api/admin/usuarios/:id)
    const updRes = await fetch(`${baseUrl}/api/admin/usuarios/${createdId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_completo: 'Novo Locador Editado',
        whatsapp: '5511988889001',
        role: 'locador',
        ativo: true,
      }),
    });
    assert.equal(updRes.status, 200);
    assert.equal((await updRes.json()).data.nome_completo, 'Novo Locador Editado');

    // Duplicate WhatsApp on update -> 409
    const dupWaRes = await fetch(`${baseUrl}/api/admin/usuarios/${createdId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_completo: 'Novo Locador Editado',
        whatsapp: '5511999990909',
        role: 'locador',
        ativo: true,
      }),
    });
    assert.equal(dupWaRes.status, 409);

    // 5. Toggle status (PATCH /api/admin/usuarios/:id/status)
    const deactivateRes = await fetch(`${baseUrl}/api/admin/usuarios/${createdId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: false }),
    });
    assert.equal(deactivateRes.status, 200);
    assert.equal((await deactivateRes.json()).data.ativo, false);

    // Inactive user cannot login
    const inactiveLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'novo.locador@teste.local', password: 'NovaSenha9!' }),
    });
    assert.equal(inactiveLogin.status, 403);

    // 6. Seed child records (locatario, veiculo, contrato, cobranca, fechadura, upload dir) and test cascade delete
    const locId = crypto.randomUUID();
    const vehId = crypto.randomUUID();
    const ctrId = crypto.randomUUID();
    const cobId = crypto.randomUUID();
    const lockId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO locatarios (id, id_usuario, nome_completo, whatsapp, ativo)
       VALUES (?, ?, 'Locatário Cascata', '5511911112222', 1)`,
    ).run(locId, createdId);
    db.prepare(`INSERT INTO veiculos (id, id_usuario, placa, modelo) VALUES (?, ?, 'CAS1A23', 'HB20')`).run(
      vehId,
      createdId,
    );
    db.prepare(
      `INSERT INTO contratos (id, id_usuario, id_locatario, id_veiculo, valor, recorrencia, data_inicio, proxima_cobranca, status)
       VALUES (?, ?, ?, ?, 500, 'semanal', '2026-11-01', '2026-12-01', 'ativo')`,
    ).run(ctrId, createdId, locId, vehId);
    db.prepare(
      `INSERT INTO cobrancas (id, id_usuario, id_contrato, id_locatario, valor, data_vencimento, status, pay_token)
       VALUES (?, ?, ?, ?, 500, '2026-12-01', 'pendente', ?)`,
    ).run(cobId, createdId, ctrId, locId, crypto.randomUUID());
    db.prepare(
      `INSERT INTO fechaduras (id, id_usuario, identificador, nome, status)
       VALUES (?, ?, 'portao-1', 'Portão', 'ativo')`,
    ).run(lockId, createdId);

    const userUploadDir = path.join(process.env.UPLOAD_DIR!, 'mensagens-midia', createdId);
    fs.mkdirSync(userUploadDir, { recursive: true });
    fs.writeFileSync(path.join(userUploadDir, 'foto.txt'), 'teste');

    // Cannot change own role or deactivate self
    const selfRoleRes = await fetch(`${baseUrl}/api/admin/usuarios/${adminId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_completo: 'Super Admin',
        whatsapp: null,
        role: 'locador',
        ativo: true,
      }),
    });
    assert.equal(selfRoleRes.status, 400);

    const selfDeactPutRes = await fetch(`${baseUrl}/api/admin/usuarios/${adminId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome_completo: 'Super Admin',
        whatsapp: null,
        role: 'admin',
        ativo: false,
      }),
    });
    assert.equal(selfDeactPutRes.status, 400);

    const selfDeactPatchRes = await fetch(`${baseUrl}/api/admin/usuarios/${adminId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: false }),
    });
    assert.equal(selfDeactPatchRes.status, 400);

    // Cannot delete self
    const selfDelRes = await fetch(`${baseUrl}/api/admin/usuarios/${adminId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(selfDelRes.status, 400);

    // Delete created user + all cascaded data
    const delRes = await fetch(`${baseUrl}/api/admin/usuarios/${createdId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delRes.status, 200);
    assert.equal((await delRes.json()).success, true);

    assert.equal(db.prepare('SELECT id FROM usuarios WHERE id = ?').get(createdId), undefined);
    assert.equal(db.prepare('SELECT id FROM locatarios WHERE id_usuario = ?').get(createdId), undefined);
    assert.equal(db.prepare('SELECT id FROM cobrancas WHERE id_usuario = ?').get(createdId), undefined);
    assert.equal(db.prepare('SELECT id FROM fechaduras WHERE id_usuario = ?').get(createdId), undefined);
    assert.equal(fs.existsSync(userUploadDir), false);

    // Deleting unknown user -> 404
    const notFoundDel = await fetch(`${baseUrl}/api/admin/usuarios/${crypto.randomUUID()}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(notFoundDel.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
