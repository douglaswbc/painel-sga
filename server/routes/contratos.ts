import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const contractSchema = z.object({
  id_locatario: z.string().trim().min(1, 'Selecione um cliente.'),
  id_veiculo: z.string().trim().optional().nullable(),
  valor: z.coerce.number().positive('O valor do contrato deve ser maior que zero.'),
  recorrencia: z.string().trim().min(1, 'Recorrência é obrigatória.'),
  data_inicio: z.string().trim().min(1, 'Data de início é obrigatória.'),
  proxima_cobranca: z.string().trim().min(1, 'Próxima cobrança é obrigatória.'),
  status: z.enum(['ativo', 'pausado', 'encerrado']).default('ativo'),
});

function formatContractRow(row: Record<string, unknown>) {
  const idVeiculo = row.id_veiculo ? String(row.id_veiculo) : null;
  const placa = row.veiculo_placa ? String(row.veiculo_placa) : null;
  const modelo = row.veiculo_modelo ? String(row.veiculo_modelo) : '';
  const categoria = row.veiculo_categoria ? String(row.veiculo_categoria) : null;
  return {
    id: String(row.id),
    id_locatario: String(row.id_locatario),
    id_veiculo: idVeiculo,
    id_usuario: String(row.id_usuario),
    valor: Number(row.valor),
    recorrencia: String(row.recorrencia),
    data_inicio: String(row.data_inicio),
    proxima_cobranca: String(row.proxima_cobranca),
    status: String(row.status),
    created_at: String(row.created_at),
    ocorrencias_realizadas: Number(row.ocorrencias_realizadas ?? 0),
    locatarios: row.locatario_nome ? { nome_completo: String(row.locatario_nome) } : null,
    veiculos: placa ? { placa, modelo } : null,
    ativo: placa
      ? { id: idVeiculo, identificador: placa, titulo: modelo, categoria }
      : null,
  };
}

function assertTenantAndVehicleOwner(
  userId: string,
  locatarioId: string,
  veiculoId: string | null | undefined,
): string | null {
  const db = getDb();
  const loc = db
    .prepare('SELECT id FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(locatarioId, userId);
  if (!loc) return 'O cliente informado não pertence a este usuário.';

  if (veiculoId) {
    const vei = db
      .prepare('SELECT id FROM veiculos WHERE id = ? AND id_usuario = ?')
      .get(veiculoId, userId);
    if (!vei) return 'O item informado não pertence a este usuário.';
  }

  return null;
}

router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const rows = db
    .prepare(`
      SELECT
        c.*,
        l.nome_completo AS locatario_nome,
        v.placa AS veiculo_placa,
        v.modelo AS veiculo_modelo,
        v.categoria AS veiculo_categoria
      FROM contratos c
      LEFT JOIN locatarios l ON l.id = c.id_locatario AND l.id_usuario = c.id_usuario
      LEFT JOIN veiculos v ON v.id = c.id_veiculo AND v.id_usuario = c.id_usuario
      WHERE c.id_usuario = ?
      ORDER BY c.created_at DESC
    `)
    .all(userId) as Array<Record<string, unknown>>;

  res.json({ data: rows.map(formatContractRow) });
});

router.get('/ativo-por-locatario/:locatarioId', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const row = db
    .prepare(
      `SELECT id FROM contratos
       WHERE id_locatario = ? AND id_usuario = ? AND status = 'ativo'
       LIMIT 1`,
    )
    .get(req.params.locatarioId, userId) as { id: string } | undefined;

  res.json({ data: row || null });
});

router.post('/', (req, res) => {
  const parsed = contractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do contrato inválidos.' });
    return;
  }

  const input = parsed.data;
  const userId = req.user!.id;
  const normalizedVehicleId = input.id_veiculo ? input.id_veiculo : null;
  const ownerError = assertTenantAndVehicleOwner(userId, input.id_locatario, normalizedVehicleId);
  if (ownerError) {
    res.status(403).json({ error: ownerError });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO contratos (
      id, id_locatario, id_veiculo, id_usuario, valor, recorrencia, data_inicio, proxima_cobranca, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.id_locatario,
    normalizedVehicleId,
    userId,
    input.valor,
    input.recorrencia,
    input.data_inicio,
    input.proxima_cobranca,
    input.status,
  );

  const created = db
    .prepare(`
      SELECT c.*, l.nome_completo AS locatario_nome, v.placa AS veiculo_placa, v.modelo AS veiculo_modelo, v.categoria AS veiculo_categoria
      FROM contratos c
      LEFT JOIN locatarios l ON l.id = c.id_locatario AND l.id_usuario = c.id_usuario
      LEFT JOIN veiculos v ON v.id = c.id_veiculo AND v.id_usuario = c.id_usuario
      WHERE c.id = ? AND c.id_usuario = ?
    `)
    .get(id, userId) as Record<string, unknown>;

  res.status(201).json({ data: formatContractRow(created) });
});

router.put('/:id', (req, res) => {
  const parsed = contractSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do contrato inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT id_locatario, id_veiculo FROM contratos WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId) as { id_locatario: string; id_veiculo: string | null } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Contrato não encontrado.' });
    return;
  }

  const input = parsed.data;
  const targetLoc = input.id_locatario ?? existing.id_locatario;
  const targetVei = input.id_veiculo !== undefined ? (input.id_veiculo || null) : existing.id_veiculo;
  const ownerError = assertTenantAndVehicleOwner(userId, targetLoc, targetVei);
  if (ownerError) {
    res.status(403).json({ error: ownerError });
    return;
  }

  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.id_locatario !== undefined) {
    updates.push('id_locatario = ?');
    values.push(input.id_locatario);
  }
  if (input.id_veiculo !== undefined) {
    updates.push('id_veiculo = ?');
    values.push(input.id_veiculo || null);
  }
  if (input.valor !== undefined) {
    updates.push('valor = ?');
    values.push(input.valor);
  }
  if (input.recorrencia !== undefined) {
    updates.push('recorrencia = ?');
    values.push(input.recorrencia);
  }
  if (input.data_inicio !== undefined) {
    updates.push('data_inicio = ?');
    values.push(input.data_inicio);
  }
  if (input.proxima_cobranca !== undefined) {
    updates.push('proxima_cobranca = ?');
    values.push(input.proxima_cobranca);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE contratos SET ${updates.join(', ')} WHERE id = ? AND id_usuario = ?`).run(
      ...values,
      req.params.id,
      userId,
    );
  }

  const updated = db
    .prepare(`
      SELECT c.*, l.nome_completo AS locatario_nome, v.placa AS veiculo_placa, v.modelo AS veiculo_modelo, v.categoria AS veiculo_categoria
      FROM contratos c
      LEFT JOIN locatarios l ON l.id = c.id_locatario AND l.id_usuario = c.id_usuario
      LEFT JOIN veiculos v ON v.id = c.id_veiculo AND v.id_usuario = c.id_usuario
      WHERE c.id = ? AND c.id_usuario = ?
    `)
    .get(req.params.id, userId) as Record<string, unknown>;

  res.json({ data: formatContractRow(updated) });
});

router.patch('/:id/status', (req, res) => {
  const statusParsed = z.enum(['ativo', 'pausado', 'encerrado']).safeParse(req.body?.status);
  if (!statusParsed.success) {
    res.status(400).json({ error: 'Status de contrato inválido.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const result = db
    .prepare('UPDATE contratos SET status = ? WHERE id = ? AND id_usuario = ?')
    .run(statusParsed.data, req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Contrato não encontrado.' });
    return;
  }

  res.json({ success: true, status: statusParsed.data });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const result = db
    .prepare('DELETE FROM contratos WHERE id = ? AND id_usuario = ?')
    .run(req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Contrato não encontrado.' });
    return;
  }

  res.json({ success: true });
});

export default router;
