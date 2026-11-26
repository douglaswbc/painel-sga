import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import {
  SEGMENT_IDS,
  normalizeSegmentConfig,
  normalizeSegmentId,
  serializeSegmentConfig,
} from '../config/segments.js';
import { getDb } from '../db/database.js';
import { getSafeUserById, requireAdmin, requireAuth } from '../middleware/auth.js';
import { hashPassword } from '../utils/crypto.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const roleSchema = z.enum(['admin', 'locador', 'locatario'], {
  error: 'Papel de usuário inválido.',
});

const createUserSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.').max(128),
  nome_completo: z.string().trim().max(160, 'Nome muito longo.').nullable().optional(),
  whatsapp: z.string().trim().max(30, 'WhatsApp muito longo.').nullable().optional(),
  role: roleSchema,
  ativo: z.boolean().optional().default(true),
  empresa_nome: z.string().trim().max(160, 'Nome da empresa muito longo.').nullable().optional(),
  segmento: z.enum(SEGMENT_IDS).optional().default('geral'),
  segmento_config: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateUserSchema = z.object({
  nome_completo: z.string().trim().max(160, 'Nome muito longo.').nullable().optional(),
  whatsapp: z.string().trim().max(30, 'WhatsApp muito longo.').nullable().optional(),
  role: roleSchema,
  ativo: z.boolean({ error: 'Informe o status ativo do usuário.' }),
  empresa_nome: z.string().trim().max(160, 'Nome da empresa muito longo.').nullable().optional(),
  segmento: z.enum(SEGMENT_IDS).optional(),
  segmento_config: z.record(z.string(), z.unknown()).nullable().optional(),
});

const statusSchema = z.object({
  ativo: z.boolean({ error: 'Informe o status ativo do usuário.' }),
});

function normalizeNullable(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

router.get('/usuarios', (_req, res, next) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, nome_completo, whatsapp, email, role, empresa_nome, segmento, segmento_config_json, ativo, created_at,
                mp_notification_url, reminder_stagger_minutes, reminder_dispatch_delay_seconds
         FROM usuarios
         ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    const users = rows.map((row) => ({
      id: String(row.id),
      nome_completo: row.nome_completo ? String(row.nome_completo) : null,
      whatsapp: row.whatsapp ? String(row.whatsapp) : null,
      email: String(row.email),
      role: String(row.role),
      empresa_nome: row.empresa_nome ? String(row.empresa_nome) : null,
      segmento: normalizeSegmentId(row.segmento),
      segmento_config: normalizeSegmentConfig(row.segmento_config_json),
      ativo: Number(row.ativo) === 1,
      created_at: String(row.created_at),
      mp_notification_url: row.mp_notification_url ? String(row.mp_notification_url) : null,
      reminder_stagger_minutes: Number(row.reminder_stagger_minutes ?? 2),
      reminder_dispatch_delay_seconds: Number(row.reminder_dispatch_delay_seconds ?? 5),
    }));

    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

router.post('/usuarios', async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const nome = normalizeNullable(parsed.data.nome_completo);
    const whatsapp = normalizeNullable(parsed.data.whatsapp);
    const empresa = normalizeNullable(parsed.data.empresa_nome);
    const ativoInt = parsed.data.ativo ? 1 : 0;

    const db = getDb();
    const existingEmail = db
      .prepare('SELECT id FROM usuarios WHERE lower(email) = ?')
      .get(email) as { id: string } | undefined;
    if (existingEmail) {
      res.status(409).json({ error: 'Já existe um usuário cadastrado com este e-mail.' });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      db.prepare(
        `INSERT INTO usuarios (
          id, nome_completo, whatsapp, email, password_hash, role, empresa_nome, segmento, segmento_config_json, ativo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        nome,
        whatsapp,
        email,
        passwordHash,
        parsed.data.role,
        empresa,
        parsed.data.segmento,
        serializeSegmentConfig(parsed.data.segmento_config),
        ativoInt,
        now,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE constraint failed: usuarios.whatsapp')) {
        res.status(409).json({ error: 'Este WhatsApp já está cadastrado em outra conta.' });
        return;
      }
      if (msg.includes('UNIQUE constraint failed: usuarios.email')) {
        res.status(409).json({ error: 'Já existe um usuário cadastrado com este e-mail.' });
        return;
      }
      throw err;
    }

    res.status(201).json({
      success: true,
      userId,
      data: getSafeUserById(userId),
    });
  } catch (error) {
    next(error);
  }
});

router.put('/usuarios/:id', (req, res, next) => {
  try {
    const userId = req.params.id?.trim();
    if (!userId) {
      res.status(400).json({ error: 'ID do usuário inválido.' });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }

    if (userId === req.user!.id) {
      if (parsed.data.role !== req.user!.role) {
        res.status(400).json({ error: 'Você não pode alterar o seu próprio tipo de usuário.' });
        return;
      }
      if (!parsed.data.ativo) {
        res.status(400).json({ error: 'Você não pode desativar a sua própria conta.' });
        return;
      }
    }

    const db = getDb();
    const sets = ['nome_completo = ?', 'whatsapp = ?', 'role = ?', 'ativo = ?'];
    const params: Array<string | number | null> = [
      normalizeNullable(parsed.data.nome_completo),
      normalizeNullable(parsed.data.whatsapp),
      parsed.data.role,
      parsed.data.ativo ? 1 : 0,
    ];

    if (parsed.data.empresa_nome !== undefined) {
      sets.push('empresa_nome = ?');
      params.push(normalizeNullable(parsed.data.empresa_nome));
    }
    if (parsed.data.segmento !== undefined) {
      sets.push('segmento = ?');
      params.push(parsed.data.segmento);
    }
    if (parsed.data.segmento_config !== undefined) {
      sets.push('segmento_config_json = ?');
      params.push(serializeSegmentConfig(parsed.data.segmento_config));
    }

    try {
      const result = db
        .prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params, userId);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE constraint failed: usuarios.whatsapp')) {
        res.status(409).json({ error: 'Este WhatsApp já está cadastrado em outra conta.' });
        return;
      }
      throw err;
    }

    res.json({ success: true, data: getSafeUserById(userId) });
  } catch (error) {
    next(error);
  }
});

router.patch('/usuarios/:id/status', (req, res, next) => {
  try {
    const userId = req.params.id?.trim();
    if (!userId) {
      res.status(400).json({ error: 'ID do usuário inválido.' });
      return;
    }

    const parsed = statusSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }

    if (userId === req.user!.id && !parsed.data.ativo) {
      res.status(400).json({ error: 'Você não pode desativar a sua própria conta.' });
      return;
    }

    const db = getDb();
    const result = db
      .prepare('UPDATE usuarios SET ativo = ? WHERE id = ?')
      .run(parsed.data.ativo ? 1 : 0, userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({ success: true, data: getSafeUserById(userId) });
  } catch (error) {
    next(error);
  }
});

router.delete('/usuarios/:id', (req, res, next) => {
  try {
    const userId = req.params.id?.trim();
    if (!userId) {
      res.status(400).json({ error: 'ID do usuário inválido.' });
      return;
    }

    if (userId === req.user!.id) {
      res.status(400).json({ error: 'Não é possível excluir a sua própria conta de administrador.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(userId) as { id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    // Remove filhos com FK RESTRICT/NO ACTION antes de apagar o usuário em cascata
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM cobrancas WHERE id_usuario = ?').run(userId);
      db.prepare('DELETE FROM agendamentos_mensagens WHERE id_usuario = ?').run(userId);
      db.prepare('DELETE FROM contratos WHERE id_usuario = ?').run(userId);
      db.prepare('DELETE FROM locatarios WHERE id_usuario = ?').run(userId);
      db.prepare('DELETE FROM veiculos WHERE id_usuario = ?').run(userId);
      db.prepare('DELETE FROM usuarios WHERE id = ?').run(userId);
      db.exec('COMMIT');
    } catch (txError) {
      db.exec('ROLLBACK');
      throw txError;
    }

    const userUploadDir = path.join(loadEnv().uploadDir, 'mensagens-midia', userId);
    fs.rmSync(userUploadDir, { recursive: true, force: true });

    res.json({
      success: true,
      message: 'Usuário e dados associados excluídos com sucesso.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
