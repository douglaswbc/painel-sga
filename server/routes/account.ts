import { Router } from 'express';
import { z } from 'zod';
import { SEGMENT_IDS, serializeSegmentConfig } from '../config/segments.js';
import { getDb } from '../db/database.js';
import { getSafeUserById, requireAuth } from '../middleware/auth.js';
import { getUserMpToken, setUserMpToken } from '../services/secrets.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';

const router = Router();
router.use(requireAuth);

const saveSecretSchema = z.object({
  secretType: z.enum(['mp_token'], { error: 'Tipo de segredo inválido.' }),
  value: z.string({ error: 'Valor do segredo é obrigatório.' }),
});

const updateProfileSchema = z.object({
  nome_completo: z.string().trim().max(160, 'Nome muito longo.').nullable().optional(),
  whatsapp: z.string().trim().max(30, 'WhatsApp muito longo.').nullable().optional(),
  empresa_nome: z.string().trim().max(160, 'Nome da empresa muito longo.').nullable().optional(),
  segmento: z.enum(SEGMENT_IDS).optional(),
  segmento_config: z.record(z.string(), z.unknown()).nullable().optional(),
  reminder_stagger_minutes: z.coerce.number().int().min(0).max(60).optional(),
  reminder_dispatch_delay_seconds: z.coerce.number().int().min(0).max(30).optional(),
  current_password: z.string().optional(),
  new_password: z.string().min(6, 'A nova senha deve ter pelo menos 6 caracteres.').max(128).optional(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Informe a senha atual.'),
  new_password: z.string().min(6, 'A nova senha deve ter pelo menos 6 caracteres.').max(128),
});

router.get('/secrets', (req, res, next) => {
  try {
    const mpToken = getUserMpToken(req.user!.id);
    res.json({ success: true, mp_token: mpToken || '' });
  } catch (error) {
    next(error);
  }
});

router.post('/secrets', (req, res, next) => {
  try {
    const parsed = saveSecretSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }

    setUserMpToken(req.user!.id, parsed.data.value);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.put('/profile', async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }

    const data = parsed.data;
    const db = getDb();
    const userId = req.user!.id;

    let nextPasswordHash: string | null = null;
    if (data.new_password !== undefined) {
      if (!data.current_password) {
        res.status(400).json({ error: 'Informe sua senha atual para definir uma nova senha.' });
        return;
      }
      const row = db
        .prepare('SELECT password_hash FROM usuarios WHERE id = ?')
        .get(userId) as { password_hash: string } | undefined;
      if (!row || !(await verifyPassword(data.current_password, row.password_hash))) {
        res.status(400).json({ error: 'Senha atual incorreta.' });
        return;
      }
      nextPasswordHash = await hashPassword(data.new_password);
    }

    const sets: string[] = [];
    const params: Array<string | number | null> = [];

    if (data.nome_completo !== undefined) {
      sets.push('nome_completo = ?');
      params.push(data.nome_completo ? data.nome_completo : null);
    }
    if (data.whatsapp !== undefined) {
      sets.push('whatsapp = ?');
      params.push(data.whatsapp ? data.whatsapp : null);
    }
    if (data.empresa_nome !== undefined) {
      sets.push('empresa_nome = ?');
      params.push(data.empresa_nome ? data.empresa_nome : null);
    }
    if (data.segmento !== undefined) {
      sets.push('segmento = ?');
      params.push(data.segmento);
    }
    if (data.segmento_config !== undefined) {
      sets.push('segmento_config_json = ?');
      params.push(serializeSegmentConfig(data.segmento_config));
    }
    if (data.reminder_stagger_minutes !== undefined) {
      sets.push('reminder_stagger_minutes = ?');
      params.push(data.reminder_stagger_minutes);
    }
    if (data.reminder_dispatch_delay_seconds !== undefined) {
      sets.push('reminder_dispatch_delay_seconds = ?');
      params.push(data.reminder_dispatch_delay_seconds);
    }
    if (nextPasswordHash) {
      sets.push('password_hash = ?');
      params.push(nextPasswordHash);
    }

    if (sets.length > 0) {
      try {
        db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...params, userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('UNIQUE constraint failed: usuarios.whatsapp')) {
          res.status(409).json({ error: 'Este WhatsApp já está cadastrado em outra conta.' });
          return;
        }
        throw err;
      }
    }

    res.json({ success: true, user: getSafeUserById(userId) });
  } catch (error) {
    next(error);
  }
});

router.post('/password', async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' });
      return;
    }

    const db = getDb();
    const userId = req.user!.id;
    const row = db
      .prepare('SELECT password_hash FROM usuarios WHERE id = ?')
      .get(userId) as { password_hash: string } | undefined;

    if (!row || !(await verifyPassword(parsed.data.current_password, row.password_hash))) {
      res.status(400).json({ error: 'Senha atual incorreta.' });
      return;
    }

    const nextHash = await hashPassword(parsed.data.new_password);
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(nextHash, userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
