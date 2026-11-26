import { Router } from 'express';
import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { handleMercadoPagoWebhook } from '../services/billing-service.js';
import { handleMetaWebhookEvent, handleZernioLockWebhook } from '../services/webhooks-service.js';
import { timingSafeEqualStr } from '../utils/crypto.js';

const router = Router();

/**
 * Verificação de webhook da Meta Cloud API (GET).
 */
router.get('/meta', (req, res) => {
  const env = loadEnv();
  const mode = String(req.query['hub.mode'] ?? '');
  const verifyToken = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');

  if (
    mode === 'subscribe' &&
    env.meta.webhookVerifyToken &&
    timingSafeEqualStr(verifyToken, env.meta.webhookVerifyToken)
  ) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.status(403).json({ error: 'Verificação do webhook Meta falhou.' });
});

/**
 * Webhook de entrada e status da Meta Cloud API (POST) com validação HMAC-SHA256.
 */
router.post('/meta', async (req, res) => {
  const env = loadEnv();
  const header = req.headers['x-hub-signature-256'];
  if (!env.meta.appSecret || typeof header !== 'string' || !req.rawBody) {
    res.status(401).json({ error: 'Assinatura Meta ausente ou não configurada.' });
    return;
  }

  const signature = header.replace(/^sha256=/i, '').trim();
  const expected = crypto
    .createHmac('sha256', env.meta.appSecret)
    .update(req.rawBody, 'utf8')
    .digest('hex');

  if (!timingSafeEqualStr(expected, signature)) {
    res.status(401).json({ error: 'Assinatura Meta inválida.' });
    return;
  }

  try {
    const result = await handleMetaWebhookEvent(req.body ?? {});
    res.status(200).json(result);
  } catch (error) {
    console.error('[webhook:meta] Falha ao processar evento:', error);
    res.status(500).json({ error: 'Falha ao processar o webhook.' });
  }
});

/**
 * Webhook de pagamentos do Mercado Pago (cobranças e reservas de candidatos).
 */
router.post('/mercadopago', async (req, res) => {
  try {
    const queryId = typeof req.query.id === 'string' ? req.query.id : undefined;
    const outcome = await handleMercadoPagoWebhook(req.body ?? {}, queryId);
    res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('[webhook:mercadopago] Erro ao processar:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Erro ao processar o pagamento.',
    });
  }
});

/**
 * Webhook de fechaduras via Zernio (POST) com validação HMAC-SHA256 por conta.
 */
router.post('/fechadura', async (req, res) => {
  try {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const outcome = await handleZernioLockWebhook(rawBody, req.headers, req.body ?? {});
    res.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('[webhook:fechadura] Erro ao processar:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
