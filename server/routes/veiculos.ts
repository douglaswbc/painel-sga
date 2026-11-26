import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const assetInputSchema = z.object({
  placa: z.string().trim().optional(),
  identificador: z.string().trim().optional(),
  modelo: z.string().trim().optional(),
  titulo: z.string().trim().optional(),
  nome: z.string().trim().optional(),
  marca: z.string().trim().optional().nullable(),
  cor: z.string().trim().optional().nullable(),
  ano: z.union([z.coerce.number().int(), z.null()]).optional(),
  tipo: z.string().trim().max(40).optional().nullable(),
  categoria: z.string().trim().max(80).optional().nullable(),
  descricao: z.string().trim().max(500).optional().nullable(),
  atributos: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().nullable(),
  ativo: z.boolean().optional(),
});

function parseAttributes(raw: unknown): Record<string, string | number | boolean | null> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number | boolean | null>;
    }
  } catch {
    // Mantém nulo caso atributos salvos não sejam JSON válido
  }
  return null;
}

function serializeAttributes(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    const key = k.trim().slice(0, 40);
    if (!key) continue;
    if (typeof v === 'string') {
      const trimmed = v.trim().slice(0, 160);
      if (trimmed) clean[key] = trimmed;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      clean[key] = v;
    }
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
}

function formatVehicleRow(row: Record<string, unknown>) {
  const placa = String(row.placa);
  const modelo = String(row.modelo);
  return {
    id: String(row.id),
    id_usuario: String(row.id_usuario),
    placa,
    identificador: placa,
    modelo,
    titulo: modelo,
    marca: row.marca ? String(row.marca) : null,
    cor: row.cor ? String(row.cor) : null,
    ano: row.ano !== null && row.ano !== undefined ? Number(row.ano) : null,
    tipo: row.tipo ? String(row.tipo) : 'item',
    categoria: row.categoria ? String(row.categoria) : null,
    descricao: row.descricao ? String(row.descricao) : null,
    atributos: parseAttributes(row.atributos_json),
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
    if (!c.id_veiculo) continue;
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
  const parsed = assetInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do item inválidos.' });
    return;
  }

  const input = parsed.data;
  const code = (input.placa || input.identificador || '').trim().toUpperCase();
  const title = (input.modelo || input.titulo || input.nome || '').trim();
  if (!code) {
    res.status(400).json({ error: 'Código / identificador é obrigatório.' });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'Nome / descrição principal é obrigatório.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO veiculos (
      id, id_usuario, placa, modelo, marca, cor, ano, tipo, categoria, descricao, atributos_json, ativo
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    code,
    title,
    input.marca || null,
    input.cor || null,
    input.ano ?? null,
    input.tipo || 'item',
    input.categoria || null,
    input.descricao || null,
    serializeAttributes(input.atributos),
    input.ativo === false ? 0 : 1,
  );

  const created = db
    .prepare('SELECT * FROM veiculos WHERE id = ? AND id_usuario = ?')
    .get(id, userId) as Record<string, unknown>;

  res.status(201).json({ data: { ...formatVehicleRow(created), contratos: [] } });
});

router.put('/:id', (req, res) => {
  const parsed = assetInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do item inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT id FROM veiculos WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId);

  if (!existing) {
    res.status(404).json({ error: 'Item não encontrado.' });
    return;
  }

  const input = parsed.data;
  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  const nextCode = input.placa !== undefined ? input.placa : input.identificador;
  if (nextCode !== undefined) {
    const normalized = nextCode.trim().toUpperCase();
    if (!normalized) {
      res.status(400).json({ error: 'Código / identificador não pode ficar vazio.' });
      return;
    }
    updates.push('placa = ?');
    values.push(normalized);
  }

  const nextTitle =
    input.modelo !== undefined
      ? input.modelo
      : input.titulo !== undefined
        ? input.titulo
        : input.nome;
  if (nextTitle !== undefined) {
    const normalized = nextTitle.trim();
    if (!normalized) {
      res.status(400).json({ error: 'Nome / descrição principal não pode ficar vazio.' });
      return;
    }
    updates.push('modelo = ?');
    values.push(normalized);
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
  if (input.tipo !== undefined) {
    updates.push('tipo = ?');
    values.push(input.tipo || 'item');
  }
  if (input.categoria !== undefined) {
    updates.push('categoria = ?');
    values.push(input.categoria || null);
  }
  if (input.descricao !== undefined) {
    updates.push('descricao = ?');
    values.push(input.descricao || null);
  }
  if (input.atributos !== undefined) {
    updates.push('atributos_json = ?');
    values.push(serializeAttributes(input.atributos));
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
