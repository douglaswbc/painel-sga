import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

const router = Router();
router.use(requireAuth);

const tenantSchema = z.object({
  nome_completo: z.string().trim().min(1, 'Nome completo é obrigatório.'),
  whatsapp: z.string().trim().min(8, 'WhatsApp inválido.'),
  email: z.string().trim().optional().nullable(),
  documento: z.string().trim().optional().nullable(),
  cpf: z.string().trim().optional().nullable(),
  cep: z.string().trim().optional().nullable(),
  rua: z.string().trim().optional().nullable(),
  numero: z.string().trim().optional().nullable(),
  bairro: z.string().trim().optional().nullable(),
  cidade: z.string().trim().optional().nullable(),
  estado: z.string().trim().max(2).optional().nullable(),
  ativo: z.boolean().optional(),
});

function formatTenantRow(row: Record<string, unknown>, userId: string) {
  let documento = row.documento ? String(row.documento) : null;
  let cpf = row.cpf ? String(row.cpf) : null;

  if (typeof row.documento_enc === 'string' && row.documento_enc) {
    try {
      documento = decryptSecret(row.documento_enc, userId);
    } catch {
      // Fallback para texto legado
    }
  }
  if (typeof row.cpf_enc === 'string' && row.cpf_enc) {
    try {
      cpf = decryptSecret(row.cpf_enc, userId);
    } catch {
      // Fallback para texto legado
    }
  }

  return {
    id: String(row.id),
    id_usuario: String(row.id_usuario),
    nome_completo: String(row.nome_completo),
    whatsapp: String(row.whatsapp),
    email: row.email ? String(row.email) : null,
    documento,
    cpf,
    ativo: Number(row.ativo) === 1,
    created_at: String(row.created_at),
    cep: row.cep ? String(row.cep) : null,
    rua: row.rua ? String(row.rua) : null,
    numero: row.numero ? String(row.numero) : null,
    bairro: row.bairro ? String(row.bairro) : null,
    cidade: row.cidade ? String(row.cidade) : null,
    estado: row.estado ? String(row.estado) : null,
    portal_token: row.portal_token ? String(row.portal_token) : null,
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const ativoParam = req.query.ativo;
  const includeAgendamentos = req.query.include === 'agendamentos';

  let sql = 'SELECT * FROM locatarios WHERE id_usuario = ?';
  const params: Array<string | number> = [userId];

  if (ativoParam === 'true' || ativoParam === '1') {
    sql += ' AND ativo = 1';
  } else if (ativoParam === 'false' || ativoParam === '0') {
    sql += ' AND ativo = 0';
  }

  sql += ' ORDER BY nome_completo COLLATE NOCASE ASC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const tenants = rows.map((row) => formatTenantRow(row, userId));

  if (!includeAgendamentos || tenants.length === 0) {
    res.json({ data: tenants });
    return;
  }

  const schedRows = db
    .prepare('SELECT id, id_locatario, ativo FROM agendamentos_mensagens WHERE id_usuario = ?')
    .all(userId) as Array<{ id: string; id_locatario: string; ativo: number }>;

  const byTenant = new Map<string, Array<{ id: string; ativo: boolean }>>();
  for (const sched of schedRows) {
    const list = byTenant.get(sched.id_locatario) || [];
    list.push({ id: sched.id, ativo: Number(sched.ativo) === 1 });
    byTenant.set(sched.id_locatario, list);
  }

  res.json({
    data: tenants.map((t) => ({
      ...t,
      agendamentos_mensagens: byTenant.get(t.id) || [],
    })),
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const row = db
    .prepare('SELECT * FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Locatário não encontrado.' });
    return;
  }
  res.json({ data: formatTenantRow(row, userId) });
});

router.post('/', (req, res) => {
  const parsed = tenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do locatário inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const id = crypto.randomUUID();
  const portalToken = crypto.randomUUID();
  const input = parsed.data;

  const docEnc = input.documento ? encryptSecret(input.documento, userId, 'data') : null;
  const cpfEnc = input.cpf ? encryptSecret(input.cpf, userId, 'data') : null;

  db.prepare(`
    INSERT INTO locatarios (
      id, id_usuario, nome_completo, whatsapp, email, documento, cpf, ativo,
      cep, rua, numero, bairro, cidade, estado, portal_token, documento_enc, cpf_enc
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    input.nome_completo,
    input.whatsapp,
    input.email || null,
    input.ativo === false ? 0 : 1,
    input.cep || null,
    input.rua || null,
    input.numero || null,
    input.bairro || null,
    input.cidade || null,
    input.estado || null,
    portalToken,
    docEnc,
    cpfEnc,
  );

  const created = db
    .prepare('SELECT * FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(id, userId) as Record<string, unknown>;

  res.status(201).json({ data: formatTenantRow(created, userId) });
});

router.put('/:id', (req, res) => {
  const parsed = tenantSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do locatário inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT * FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Locatário não encontrado.' });
    return;
  }

  const input = parsed.data;
  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.nome_completo !== undefined) {
    updates.push('nome_completo = ?');
    values.push(input.nome_completo);
  }
  if (input.whatsapp !== undefined) {
    updates.push('whatsapp = ?');
    values.push(input.whatsapp);
  }
  if (input.email !== undefined) {
    updates.push('email = ?');
    values.push(input.email || null);
  }
  if (input.documento !== undefined) {
    updates.push('documento = NULL', 'documento_enc = ?');
    values.push(input.documento ? encryptSecret(input.documento, userId, 'data') : null);
  }
  if (input.cpf !== undefined) {
    updates.push('cpf = NULL', 'cpf_enc = ?');
    values.push(input.cpf ? encryptSecret(input.cpf, userId, 'data') : null);
  }
  if (input.cep !== undefined) {
    updates.push('cep = ?');
    values.push(input.cep || null);
  }
  if (input.rua !== undefined) {
    updates.push('rua = ?');
    values.push(input.rua || null);
  }
  if (input.numero !== undefined) {
    updates.push('numero = ?');
    values.push(input.numero || null);
  }
  if (input.bairro !== undefined) {
    updates.push('bairro = ?');
    values.push(input.bairro || null);
  }
  if (input.cidade !== undefined) {
    updates.push('cidade = ?');
    values.push(input.cidade || null);
  }
  if (input.estado !== undefined) {
    updates.push('estado = ?');
    values.push(input.estado || null);
  }
  if (input.ativo !== undefined) {
    updates.push('ativo = ?');
    values.push(input.ativo ? 1 : 0);
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE locatarios SET ${updates.join(', ')} WHERE id = ? AND id_usuario = ?`).run(
      ...values,
      req.params.id,
      userId,
    );
  }

  const updated = db
    .prepare('SELECT * FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId) as Record<string, unknown>;

  res.json({ data: formatTenantRow(updated, userId) });
});

router.patch('/:id/status', (req, res) => {
  const ativo = Boolean(req.body?.ativo);
  const db = getDb();
  const userId = req.user!.id;

  const result = db
    .prepare('UPDATE locatarios SET ativo = ? WHERE id = ? AND id_usuario = ?')
    .run(ativo ? 1 : 0, req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Locatário não encontrado.' });
    return;
  }

  res.json({ success: true, ativo });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  try {
    const result = db
      .prepare('DELETE FROM locatarios WHERE id = ? AND id_usuario = ?')
      .run(req.params.id, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Locatário não encontrado.' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('FOREIGN KEY constraint failed')) {
      res.status(409).json({
        error: 'Não é possível excluir: o locatário possui contratos ou cobranças vinculadas.',
      });
      return;
    }
    throw error;
  }
});

export default router;
