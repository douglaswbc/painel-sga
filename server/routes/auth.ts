import { Router } from 'express';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import {
  AUTH_COOKIE_NAME,
  getSafeUserById,
  requireAuth,
  signAuthToken,
} from '../middleware/auth.js';
import { verifyPassword } from '../utils/crypto.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Credenciais inválidas.' });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const password = parsed.data.password;

    const db = getDb();
    const row = db.prepare(`
      SELECT id, password_hash, role, ativo
      FROM usuarios
      WHERE lower(email) = ?
    `).get(email) as { id: string; password_hash: string; role: string; ativo: number } | undefined;

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      return;
    }

    if (Number(row.ativo) !== 1) {
      res.status(403).json({ error: 'Usuário inativo. Entre em contato com o suporte.' });
      return;
    }

    const user = getSafeUserById(row.id);
    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const token = signAuthToken(user.id, user.role);
    const env = loadEnv();
    const isHttps = env.appPublicUrl.startsWith('https://');

    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
