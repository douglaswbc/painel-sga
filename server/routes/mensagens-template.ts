import { Router } from 'express';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const tipo = typeof req.query.tipo === 'string' ? req.query.tipo.trim() : '';

  let sql = 'SELECT * FROM mensagens_template WHERE id_usuario = ?';
  const params: string[] = [userId];

  if (tipo) {
    sql += ' AND tipo = ? ORDER BY titulo COLLATE NOCASE ASC';
    params.push(tipo);
  } else {
    sql += ' ORDER BY ordem ASC';
  }

  const templates = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  if (tipo || templates.length === 0) {
    res.json({ data: templates });
    return;
  }

  const scheds = db
    .prepare('SELECT id, id_template, ativo FROM agendamentos_mensagens WHERE id_usuario = ? AND id_template IS NOT NULL')
    .all(userId) as Array<{ id: string; id_template: string; ativo: number }>;

  const byTemplate = new Map<string, Array<{ id: string; ativo: boolean }>>();
  for (const s of scheds) {
    const list = byTemplate.get(s.id_template) || [];
    list.push({ id: s.id, ativo: Number(s.ativo) === 1 });
    byTemplate.set(s.id_template, list);
  }

  res.json({
    data: templates.map((t) => ({
      ...t,
      agendamentos_mensagens: byTemplate.get(String(t.id)) || [],
    })),
  });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const body = req.body ?? {};
  const allowed = ['ordem', 'titulo', 'conteudo', 'tipo', 'media_url', 'media_type', 'media_mimetype', 'media_filename'];
  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  for (const field of allowed) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length > 0) {
    const result = db
      .prepare(`UPDATE mensagens_template SET ${updates.join(', ')} WHERE id = ? AND id_usuario = ?`)
      .run(...values, req.params.id, userId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Modelo de mensagem não encontrado.' });
      return;
    }
  }

  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM mensagens_template WHERE id = ? AND id_usuario = ?')
    .run(req.params.id, req.user!.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Modelo de mensagem não encontrado.' });
    return;
  }

  res.json({ success: true });
});

export default router;
