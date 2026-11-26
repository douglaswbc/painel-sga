import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const vehicleSchema = z.object({
  placa: z.string().trim().min(1, 'Placa é obrigatória.').transform((v) => v.toUpperCase()),
  modelo: z.string().trim().min(1, 'Modelo é obrigatório.'),
  marca: z.string().trim().optional().nullable(),
  cor: z.string().trim().optional().nullable(),
  ano: z.union([z.coerce.number().int(), z.null()]).optional(),
  ativo: z.boolean().optional(),
});

function formatVehicleRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    id_usuario: String(row.id_usuario),
    placa: String(row.placa),
    modelo: String(row.modelo),
    marca: row.marca ? String(row.marca) : null,
    cor: row.cor ? String(row.cor) : null,
    ano: row.ano !== null && row.ano !== undefined ? Number(row.ano) : null,
    ativo: Number(row.ativo) === 1,
    created_at: String(row.created_at),
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const ativoParam = req.query.ativo;

  let sql = 'SELECT * FROM veiculos WHERE id_usuario = ?';
  const params: Array<string | number> = [userId];

  if (ativoParam === 'true' || ativoParam === '1') {
    sql += ' AND ativo = 1';
  } else if (ativoParam === 'false' || ativoParam === '0') {
    sql += ' AND ativo = 0';
  }

  sql += ' ORDER BY modelo COLLATE NOCASE ASC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const contractRows = db
    .prepare('SELECT id, id_veiculo, status FROM contratos WHERE id_usuario = ?')
    .all(userId) as Array<{ id: string; id_veiculo: string; status: string }>;

  const contractsByVehicle = new Map<string, Array<{ id: string; status: string }>>();
  for (const c of contractRows) {
    const list = contractsByVehicle.get(c.id_veiculo) || [];
    list.push({ id: c.id, status: c.status });
    contractsByVehicle.set(c.id_veiculo, list);
  }

  res.json({
    data: rows.map((row) => {
      const formatted = formatVehicleRow(row);
      return {
        ...formatted,
        contratos: contractsByVehicle.get(formatted.id) || [],
      };
    }),
  });
});

router.post('/', (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do veículo inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const id = crypto.randomUUID();
  const input = parsed.data;

  db.prepare(`
    INSERT INTO veiculos (id, id_usuario, placa, modelo, marca, cor, ano, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    input.placa,
    input.modelo,
    input.marca || null,
    input.cor || null,
    input.ano ?? null,
    input.ativo === false ? 0 : 1,
  );

  const created = db
    .prepare('SELECT * FROM veiculos WHERE id = ? AND id_usuario = ?')
    .get(id, userId) as Record<string, unknown>;

  res.status(201).json({ data: { ...formatVehicleRow(created), contratos: [] } });
});

router.put('/:id', (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do veículo inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT id FROM veiculos WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId);

  if (!existing) {
    res.status(404).json({ error: 'Veículo não encontrado.' });
    return;
  }

  const input = parsed.data;
  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.placa !== undefined) {
    updates.push('placa = ?');
    values.push(input.placa);
  }
  if (input.modelo !== undefined) {
    updates.push('modelo = ?');
    values.push(input.modelo);
  }
  if (input.marca !== undefined) {
    updates.push('marca = ?');
    values.push(input.marca || null);
  }
  if (input.cor !== undefined) {
    updates.push('cor = ?');
    values.push(input.cor || null);
  }
  if (input.ano !== undefined) {
    updates.push('ano = ?');
    values.push(input.ano ?? null);
  }
  if (input.ativo !== undefined) {
    updates.push('ativo = ?');
    values.push(input.ativo ? 1 : 0);
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE veiculos SET ${updates.join(', ')} WHERE id = ? AND id_usuario = ?`).run(
      ...values,
      req.params.id,
      userId,
    );
  }

  const updated = db
    .prepare('SELECT * FROM veiculos WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId) as Record<string, unknown>;

  res.json({ data: formatVehicleRow(updated) });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  try {
    const result = db
      .prepare('DELETE FROM veiculos WHERE id = ? AND id_usuario = ?')
      .run(req.params.id, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('FOREIGN KEY constraint failed')) {
      res.status(409).json({
        error: 'Erro ao excluir: o veículo está vinculado a contratos existentes.',
      });
      return;
    }
    throw error;
  }
});

export default router;
