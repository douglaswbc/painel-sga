import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';
import { billContractById, runAutoBilling } from '../services/billing-service.js';
import {
  PublicError,
  sendChargeReminder,
  sendPaymentConfirmationByCharge,
} from '../services/whatsapp-sender.js';

const router = Router();
router.use(requireAuth);

const createChargeSchema = z.object({
  id_contrato: z.string().trim().optional().nullable(),
  id_locatario: z.string().trim().optional().nullable(),
  valor: z.coerce.number().positive('O valor da cobrança deve ser maior que zero.'),
  data_vencimento: z.string().trim().min(1, 'Data de vencimento é obrigatória.'),
  ciclo_cobranca: z.string().trim().optional().nullable(),
  status: z.enum(['pendente', 'pago', 'atrasado', 'cancelado']).default('pendente'),
  categoria: z.string().trim().optional().nullable(),
  tipo: z.enum(['receita', 'despesa']).default('receita'),
  data_pagamento: z.string().trim().optional().nullable(),
});

function formatChargeListRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    id_contrato: row.id_contrato ? String(row.id_contrato) : null,
    id_locatario: row.id_locatario ? String(row.id_locatario) : null,
    id_usuario: String(row.id_usuario),
    valor: Number(row.valor),
    data_vencimento: String(row.data_vencimento),
    ciclo_cobranca: row.ciclo_cobranca ? String(row.ciclo_cobranca) : null,
    data_pagamento: row.data_pagamento ? String(row.data_pagamento) : null,
    status: String(row.status),
    tentativas_envio: Number(row.tentativas_envio ?? 0),
    created_at: String(row.created_at),
    mercado_pago_id: row.mercado_pago_id ? String(row.mercado_pago_id) : null,
    payment_link: row.payment_link ? String(row.payment_link) : null,
    categoria: row.categoria ? String(row.categoria) : null,
    tipo: row.tipo ? String(row.tipo) : 'receita',
    ultimo_lembrete_at: row.ultimo_lembrete_at ? String(row.ultimo_lembrete_at) : null,
    pix_expires_at: row.pix_expires_at ? String(row.pix_expires_at) : null,
    next_reminder_at: row.next_reminder_at ? String(row.next_reminder_at) : null,
    reminder_interval_minutes: Number(row.reminder_interval_minutes ?? 30),
    pix_expired_at: row.pix_expired_at ? String(row.pix_expired_at) : null,
    pay_token: String(row.pay_token),
    locatario_cobranca: row.lc_nome
      ? { nome_completo: String(row.lc_nome), whatsapp: String(row.lc_whatsapp ?? '') }
      : null,
    contratos: row.id_contrato
      ? {
          id: String(row.id_contrato),
          id_locatario: row.k_locatario_id ? String(row.k_locatario_id) : null,
          locatarios: row.cl_nome ? { nome_completo: String(row.cl_nome) } : null,
          veiculos: row.v_placa ? { placa: String(row.v_placa) } : null,
        }
      : null,
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const rows = db
    .prepare(
      `SELECT
        c.*,
        lc.nome_completo AS lc_nome, lc.whatsapp AS lc_whatsapp,
        k.id_locatario AS k_locatario_id,
        cl.nome_completo AS cl_nome,
        v.placa AS v_placa
       FROM cobrancas c
       LEFT JOIN locatarios lc ON lc.id = c.id_locatario AND lc.id_usuario = c.id_usuario
       LEFT JOIN contratos k ON k.id = c.id_contrato AND k.id_usuario = c.id_usuario
       LEFT JOIN locatarios cl ON cl.id = k.id_locatario AND cl.id_usuario = c.id_usuario
       LEFT JOIN veiculos v ON v.id = k.id_veiculo AND v.id_usuario = c.id_usuario
       WHERE c.id_usuario = ?
       ORDER BY c.data_vencimento DESC, c.created_at DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;

  res.json({ data: rows.map(formatChargeListRow) });
});

router.get('/contrato/:contratoId/pendente', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const row = db
    .prepare(
      `SELECT id, valor, data_vencimento
       FROM cobrancas
       WHERE id_usuario = ? AND id_contrato = ? AND status = 'pendente'
       ORDER BY data_vencimento ASC
       LIMIT 1`,
    )
    .get(userId, req.params.contratoId) as { id: string; valor: number; data_vencimento: string } | undefined;

  res.json({ data: row || null });
});

router.post('/', (req, res) => {
  const parsed = createChargeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados da cobrança inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const input = parsed.data;
  let resolvedLocatarioId = input.id_locatario || null;

  if (input.id_contrato) {
    const contract = db
      .prepare('SELECT id_locatario FROM contratos WHERE id = ? AND id_usuario = ?')
      .get(input.id_contrato, userId) as { id_locatario: string } | undefined;
    if (!contract) {
      res.status(403).json({ error: 'O contrato da cobrança não pertence ao locador informado.' });
      return;
    }
    if (resolvedLocatarioId && resolvedLocatarioId !== contract.id_locatario) {
      res.status(400).json({ error: 'O locatário da cobrança não corresponde ao contrato.' });
      return;
    }
    resolvedLocatarioId = contract.id_locatario;
  } else if (resolvedLocatarioId) {
    const tenant = db
      .prepare('SELECT id FROM locatarios WHERE id = ? AND id_usuario = ?')
      .get(resolvedLocatarioId, userId);
    if (!tenant) {
      res.status(403).json({ error: 'O locatário informado não pertence a este usuário.' });
      return;
    }
  }

  const id = crypto.randomUUID();
  const payToken = crypto.randomUUID();

  db.prepare(
    `INSERT INTO cobrancas (
      id, id_contrato, id_locatario, id_usuario, valor, data_vencimento, ciclo_cobranca,
      data_pagamento, status, categoria, tipo, pay_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.id_contrato || null,
    resolvedLocatarioId,
    userId,
    input.valor,
    input.data_vencimento,
    input.ciclo_cobranca || null,
    input.status === 'pago' ? input.data_pagamento || new Date().toISOString() : null,
    input.status,
    input.categoria || 'aluguel',
    input.tipo,
    payToken,
  );

  const created = db
    .prepare('SELECT * FROM cobrancas WHERE id = ? AND id_usuario = ?')
    .get(id, userId) as Record<string, unknown>;

  res.status(201).json({ data: created });
});

router.put('/:id', (req, res) => {
  const parsed = createChargeSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados da cobrança inválidos.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT id FROM cobrancas WHERE id = ? AND id_usuario = ?')
    .get(req.params.id, userId);
  if (!existing) {
    res.status(404).json({ error: 'Cobrança não encontrada.' });
    return;
  }

  const input = parsed.data;
  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.valor !== undefined) {
    updates.push('valor = ?');
    values.push(input.valor);
  }
  if (input.data_vencimento !== undefined) {
    updates.push('data_vencimento = ?');
    values.push(input.data_vencimento);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.categoria !== undefined) {
    updates.push('categoria = ?');
    values.push(input.categoria || null);
  }
  if (input.tipo !== undefined) {
    updates.push('tipo = ?');
    values.push(input.tipo);
  }
  if (input.data_pagamento !== undefined) {
    updates.push('data_pagamento = ?');
    values.push(input.data_pagamento || null);
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE cobrancas SET ${updates.join(', ')} WHERE id = ? AND id_usuario = ?`).run(
      ...values,
      req.params.id,
      userId,
    );
  }

  res.json({ success: true });
});

router.patch('/:id/pagar', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const nowIso = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE cobrancas
       SET status = 'pago', data_pagamento = ?, next_reminder_at = NULL
       WHERE id = ? AND id_usuario = ?`,
    )
    .run(nowIso, req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Cobrança não encontrada.' });
    return;
  }

  res.json({ success: true, data_pagamento: nowIso });
});

router.patch('/:id/cancelar', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const result = db
    .prepare(
      `UPDATE cobrancas
       SET status = 'cancelado', next_reminder_at = NULL
       WHERE id = ? AND id_usuario = ?`,
    )
    .run(req.params.id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Cobrança não encontrada.' });
    return;
  }

  res.json({ success: true });
});

router.post('/faturar', async (req, res, next) => {
  try {
    const result = await runAutoBilling(req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/cobrar-contrato', async (req, res) => {
  const contratoId = typeof req.body?.contratoId === 'string' ? req.body.contratoId.trim() : '';
  if (!contratoId) {
    res.status(400).json({ error: 'contratoId é obrigatório.' });
    return;
  }

  try {
    const outcome = await billContractById(req.user!.id, contratoId);
    res.json(outcome);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: 'error', msg });
  }
});

router.post('/:id/gerar-pix', async (req, res) => {
  try {
    const result = await sendChargeReminder(req.user!.id, req.params.id);
    res.json(result);
  } catch (error) {
    if (error instanceof PublicError) {
      res.status(error.status).json({ error: error.message, ...(error.extra ?? {}) });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao enviar cobrança.' });
  }
});

router.post('/:id/confirmar-pagamento', async (req, res) => {
  try {
    const result = await sendPaymentConfirmationByCharge(req.user!.id, req.params.id);
    res.json(result);
  } catch (error) {
    if (error instanceof PublicError) {
      res.status(error.status).json({ error: error.message, ...(error.extra ?? {}) });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao enviar confirmação.' });
  }
});

export default router;
