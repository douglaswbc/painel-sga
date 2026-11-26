import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function formatScheduleRow(row: Record<string, unknown>) {
  let templateParams: unknown[] = [];
  if (typeof row.template_params === 'string') {
    try {
      const parsed = JSON.parse(row.template_params);
      if (Array.isArray(parsed)) templateParams = parsed;
    } catch {
      templateParams = [];
    }
  } else if (Array.isArray(row.template_params)) {
    templateParams = row.template_params;
  }

  return {
    id: String(row.id),
    id_usuario: String(row.id_usuario),
    id_locatario: String(row.id_locatario),
    id_template: row.id_template ? String(row.id_template) : null,
    id_contrato: row.id_contrato ? String(row.id_contrato) : null,
    zernio_template_id: row.zernio_template_id ? String(row.zernio_template_id) : null,
    template_params: templateParams,
    frequencia: String(row.frequencia),
    frequencia_dias: row.frequencia_dias !== null && row.frequencia_dias !== undefined ? Number(row.frequencia_dias) : null,
    proximo_envio: String(row.proximo_envio),
    horario_envio: String(row.horario_envio),
    ativo: Number(row.ativo) === 1,
    ultimo_erro: row.ultimo_erro ? String(row.ultimo_erro) : null,
    ultima_execucao: row.ultima_execucao ? String(row.ultima_execucao) : null,
    created_at: String(row.created_at),
    locatarios: row.loc_nome
      ? {
          id: String(row.id_locatario),
          nome_completo: String(row.loc_nome),
          whatsapp: String(row.loc_whatsapp ?? ''),
        }
      : null,
    mensagens_template: row.legacy_titulo ? { titulo: String(row.legacy_titulo) } : null,
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const where: string[] = ['a.id_usuario = ?'];
  const params: Array<string | number> = [userId];

  const idTemplate = typeof req.query.id_template === 'string' ? req.query.id_template.trim() : '';
  const idLocatario = typeof req.query.id_locatario === 'string' ? req.query.id_locatario.trim() : '';
  const anyTemplateId = typeof req.query.template_id === 'string' ? req.query.template_id.trim() : '';
  const tenantIdsRaw = typeof req.query.tenant_ids === 'string' ? req.query.tenant_ids.trim() : '';
  const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit) || 20)) : null;

  if (anyTemplateId) {
    where.push('(a.id_template = ? OR a.zernio_template_id = ?)');
    params.push(anyTemplateId, anyTemplateId);
  } else if (idTemplate) {
    where.push('a.id_template = ?');
    params.push(idTemplate);
  }

  if (tenantIdsRaw) {
    const ids = tenantIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      where.push(`a.id_locatario IN (${placeholders})`);
      params.push(...ids);
    }
  } else if (idLocatario) {
    where.push('a.id_locatario = ?');
    params.push(idLocatario);
  }

  let sql = `
    SELECT
      a.*,
      l.nome_completo AS loc_nome,
      l.whatsapp AS loc_whatsapp,
      m.titulo AS legacy_titulo
    FROM agendamentos_mensagens a
    LEFT JOIN locatarios l ON l.id = a.id_locatario AND l.id_usuario = a.id_usuario
    LEFT JOIN mensagens_template m ON m.id = a.id_template AND m.id_usuario = a.id_usuario
    WHERE ${where.join(' AND ')}
    ORDER BY a.proximo_envio ASC, a.horario_envio ASC
  `;

  if (limit !== null) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json({ data: rows.map(formatScheduleRow) });
});

const patchSchema = z.object({
  ativo: z.boolean().optional(),
  ultimo_erro: z.string().nullable().optional(),
  proximo_envio: z.string().optional(),
  horario_envio: z.string().optional(),
});

router.patch('/:id', (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados inválidos para atualizar agendamento.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const input = parsed.data;
  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.ativo !== undefined) {
    updates.push('ativo = ?');
    values.push(input.ativo ? 1 : 0);
  }
  if (input.ultimo_erro !== undefined) {
    updates.push('ultimo_erro = ?');
    values.push(input.ultimo_erro);
  }
  if (input.proximo_envio !== undefined) {
    updates.push('proximo_envio = ?');
    values.push(input.proximo_envio);
  }
  if (input.horario_envio !== undefined) {
    updates.push('horario_envio = ?');
    values.push(input.horario_envio);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    const result = db
      .prepare(`UPDATE agendamentos_mensagens SET ${updates.join(', ')} WHERE id = ? AND id_usuario = ?`)
      .run(...values, req.params.id, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Agendamento não encontrado.' });
      return;
    }
  }

  res.json({ success: true });
});

router.post('/', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const db = getDb();
  const userId = req.user!.id;
  const created: Array<Record<string, unknown>> = [];

  const insertStmt = db.prepare(`
    INSERT INTO agendamentos_mensagens (
      id, id_template, zernio_template_id, id_locatario, id_usuario, id_contrato,
      frequencia, frequencia_dias, proximo_envio, horario_envio, ativo, template_params
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of items) {
    const id = crypto.randomUUID();
    insertStmt.run(
      id,
      item.id_template || null,
      item.zernio_template_id || null,
      item.id_locatario,
      userId,
      item.id_contrato || null,
      item.frequencia,
      item.frequencia_dias ?? null,
      item.proximo_envio,
      item.horario_envio || '08:00:00',
      item.ativo === false ? 0 : 1,
      JSON.stringify(Array.isArray(item.template_params) ? item.template_params : []),
    );
    const row = db
      .prepare('SELECT * FROM agendamentos_mensagens WHERE id = ? AND id_usuario = ?')
      .get(id, userId) as Record<string, unknown>;
    created.push(formatScheduleRow(row));
  }

  res.status(201).json({ data: created });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM agendamentos_mensagens WHERE id = ? AND id_usuario = ?')
    .run(req.params.id, req.user!.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Agendamento não encontrado.' });
    return;
  }

  res.json({ success: true });
});

export default router;
