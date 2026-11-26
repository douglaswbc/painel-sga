import { Router, type Response } from 'express';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function applySecurityHeaders(res: Response): void {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  });
}

function redirectNotice(res: Response, reason: string): void {
  const env = loadEnv();
  applySecurityHeaders(res);
  res.redirect(302, `${env.appPublicUrl}/pagar/aviso/${reason}`);
}

// Permite que /pagar/aviso/:motivo siga para o SPA (PaymentNotice.jsx)
router.use('/aviso', (_req, _res, next) => {
  next('router');
});

router.all('/:token', (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    applySecurityHeaders(res);
    res.status(405).type('text/plain').send('Method not allowed.');
    return;
  }

  const token = String(req.params.token ?? '').trim();
  if (!UUID_PATTERN.test(token)) {
    redirectNotice(res, 'invalido');
    return;
  }

  try {
    const db = getDb();
    const data = db
      .prepare(
        `SELECT status, payment_link, pix_expires_at, pix_expired_at
         FROM cobrancas
         WHERE pay_token = ?`,
      )
      .get(token) as
      | {
          status: string;
          payment_link: string | null;
          pix_expires_at: string | null;
          pix_expired_at: string | null;
        }
      | undefined;

    if (!data) {
      redirectNotice(res, 'invalido');
      return;
    }
    if (data.status === 'pago') {
      redirectNotice(res, 'pago');
      return;
    }
    if (data.status === 'cancelado') {
      redirectNotice(res, 'cancelado');
      return;
    }

    const expiresAt = data.pix_expires_at ? new Date(data.pix_expires_at).getTime() : null;
    const expired =
      Boolean(data.pix_expired_at) ||
      (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now());
    if (expired) {
      redirectNotice(res, 'expirado');
      return;
    }

    if (typeof data.payment_link !== 'string' || !data.payment_link) {
      redirectNotice(res, 'indisponivel');
      return;
    }

    let target: URL;
    try {
      target = new URL(data.payment_link);
    } catch {
      redirectNotice(res, 'indisponivel');
      return;
    }

    if (target.protocol !== 'https:') {
      redirectNotice(res, 'indisponivel');
      return;
    }

    applySecurityHeaders(res);
    res.redirect(302, target.toString());
  } catch (error) {
    console.error('[pay-link] Falha ao resolver token:', error);
    redirectNotice(res, 'indisponivel');
  }
});

export default router;
