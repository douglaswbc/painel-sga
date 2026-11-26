import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const lockSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da porta.').max(120),
  identificador: z.string().trim().min(1, 'Informe o identificador único.').max(80),
  status: z.enum(['ativo', 'inativo', 'manutencao']).default('ativo'),
});

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, '-');
}

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM fechaduras WHERE id_usuario = ? ORDER BY created_at DESC')
    .all(req.user!.id);
  res.json({ data: rows });
});

router.get('/logs', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.*, loc.nome_completo AS loc_nome, f.nome AS fechadura_nome
       FROM fechadura_logs l
       LEFT JOIN locatarios loc ON loc.id = l.id_locatario AND loc.id_usuario = l.id_usuario
       LEFT JOIN fechaduras f ON f.id = l.id_fechadura
       WHERE l.id_usuario = ?
       ORDER BY l.timestamp DESC
       LIMIT 50`,
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const formatted = rows.map((row) => ({
    id: row.id,
    id_usuario: row.id_usuario,
    id_locatario: row.id_locatario,
    id_fechadura: row.id_fechadura,
    whatsapp: row.whatsapp,
    evento: row.evento,
    detalhes: row.detalhes,
    timestamp: row.timestamp,
    locatarios: row.loc_nome ? { nome_completo: String(row.loc_nome) } : null,
    fechaduras: row.fechadura_nome ? { nome: String(row.fechadura_nome) } : null,
  }));

  res.json({ data: formatted });
});

router.post('/', (req, res) => {
  const parsed = lockSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos da fechadura.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const identificador = normalizeIdentifier(parsed.data.identificador);
  const duplicate = db
    .prepare('SELECT id FROM fechaduras WHERE id_usuario = ? AND identificador = ?')
    .get(userId, identificador);

  if (duplicate) {
    res.status(409).json({ error: 'Já existe uma fechadura com este identificador para sua conta.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO fechaduras (id, id_usuario, identificador, nome, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, identificador, parsed.data.nome, parsed.data.status);

  const created = db.prepare('SELECT * FROM fechaduras WHERE id = ? AND id_usuario = ?').get(id, userId);
  res.status(201).json({ data: created });
});

router.put('/:id', (req, res) => {
  const parsed = lockSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dados inválidos para atualizar fechadura.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT * FROM fechaduras WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Fechadura não encontrada.' });
    return;
  }

  const nextIdentificador =
    parsed.data.identificador !== undefined
      ? normalizeIdentifier(parsed.data.identificador)
      : String(existing.identificador);

  if (nextIdentificador !== existing.identificador) {
    const duplicate = db
      .prepare('SELECT id FROM fechaduras WHERE id_usuario = ? AND identificador = ? AND id <> ?')
      .get(userId, nextIdentificador, req.params.id);
    if (duplicate) {
      res.status(409).json({ error: 'Já existe uma fechadura com este identificador para sua conta.' });
      return;
    }
  }

  db.prepare(
    `UPDATE fechaduras
     SET nome = ?, identificador = ?, status = ?
     WHERE id = ? AND id_usuario = ?`,
  ).run(
    parsed.data.nome ?? String(existing.nome),
    nextIdentificador,
    parsed.data.status ?? String(existing.status),
    req.params.id,
    userId,
  );

  const updated = db.prepare('SELECT * FROM fechaduras WHERE id = ? AND id_usuario = ?').get(req.params.id, userId);
  res.json({ data: updated });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM fechaduras WHERE id = ? AND id_usuario = ?')
    .run(req.params.id, req.user!.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Fechadura não encontrada.' });
    return;
  }

  res.json({ success: true });
});

export default router;
