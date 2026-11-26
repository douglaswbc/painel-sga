import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env.js';
import {
  normalizeSegmentConfig,
  normalizeSegmentId,
  type SegmentCustomConfig,
  type SegmentId,
} from '../config/segments.js';
import { getDb } from '../db/database.js';

export type AuthUser = {
  id: string;
  email: string;
  nome_completo: string | null;
  whatsapp: string | null;
  role: 'admin' | 'locador' | 'locatario';
  empresa_nome: string | null;
  segmento: SegmentId;
  segmento_config: SegmentCustomConfig | null;
  ativo: boolean;
  created_at: string;
  mp_notification_url: string | null;
  reminder_stagger_minutes: number;
  reminder_dispatch_delay_seconds: number;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      rawBody?: string;
    }
  }
}

type JwtPayload = {
  sub: string;
  role: string;
};

export const AUTH_COOKIE_NAME = 'sga_token';

export function signAuthToken(userId: string, role: string): string {
  const env = loadEnv();
  return jwt.sign({ sub: userId, role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAuthToken(token: string): JwtPayload {
  const env = loadEnv();
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded !== 'object' || decoded === null || typeof decoded.sub !== 'string') {
    throw new Error('Token inválido.');
  }
  return {
    sub: decoded.sub,
    role: typeof decoded.role === 'string' ? decoded.role : 'locador',
  };
}

function parseCookies(headerValue: string | undefined): Record<string, string> {
  if (!headerValue) return {};
  const cookies: Record<string, string> = {};
  for (const part of headerValue.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] || null;
}

export function getSafeUserById(userId: string): AuthUser | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      id, nome_completo, whatsapp, email, role, empresa_nome, segmento, segmento_config_json, ativo, created_at,
      mp_notification_url, reminder_stagger_minutes, reminder_dispatch_delay_seconds
    FROM usuarios
    WHERE id = ?
  `).get(userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: String(row.id),
    email: String(row.email),
    nome_completo: row.nome_completo ? String(row.nome_completo) : null,
    whatsapp: row.whatsapp ? String(row.whatsapp) : null,
    role: row.role as AuthUser['role'],
    empresa_nome: row.empresa_nome ? String(row.empresa_nome) : null,
    segmento: normalizeSegmentId(row.segmento),
    segmento_config: normalizeSegmentConfig(row.segmento_config_json),
    ativo: Number(row.ativo) === 1,
    created_at: String(row.created_at),
    mp_notification_url: row.mp_notification_url ? String(row.mp_notification_url) : null,
    reminder_stagger_minutes: Number(row.reminder_stagger_minutes ?? 2),
    reminder_dispatch_delay_seconds: Number(row.reminder_dispatch_delay_seconds ?? 5),
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractAuthToken(req);
  if (!token) {
    res.status(401).json({ error: 'Autenticação obrigatória.' });
    return;
  }

  try {
    const payload = verifyAuthToken(token);
    const user = getSafeUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (!user.ativo) {
      res.status(403).json({ error: 'Usuário inativo. Entre em contato com o suporte.' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Autenticação obrigatória.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores.' });
    return;
  }
  next();
}
