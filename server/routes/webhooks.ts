import { Router, type Request, type Response } from 'express';
import { handleMercadoPagoWebhook } from '../services/billing-service.js';
import {
  handleMetaWebhookEvent,
  handleZernioLockWebhook,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from '../services/webhooks-service.js';

const router = Router();

function handleMetaGet(req: Request, res: Response, ownerId?: string): void {
  const mode = String(req.query['hub.mode'] ?? '');
  const verifyToken = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');

  if (mode === 'subscribe' && verifyMetaWebhookChallenge(verifyToken, ownerId)) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.status(403).json({ error: 'Verificação do webhook Meta falhou.' });
}

async function handleMetaPost(req: Request, res: Response, ownerId?: string): Promise<void> {
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !req.rawBody) {
    res.status(401).json({ error: 'Assinatura Meta ausente ou não configurada.' });
    return;
  }

  const signature = header.replace(/^sha256=/i, '').trim();
  const check = verifyMetaWebhookSignature(req.rawBody, signature, ownerId);
  if (!check.configured) {
    res.status(401).json({ error: 'Assinatura Meta ausente ou não configurada.' });
    return;
  }
  if (!check.valid) {
    res.status(401).json({ error: 'Assinatura Meta inválida.' });
    return;
  }

  try {
    const result = await handleMetaWebhookEvent(req.body ?? {}, check.matchedOwnerId);
    res.status(200).json(result);
  } catch (error) {
    console.error('[webhook:meta] Falha ao processar evento:', error);
    res.status(500).json({ error: 'Falha ao processar o webhook.' });
  }
}

/**
 * Verificação de webhook da Meta Cloud API (GET).
 */
router.get('/meta', (req, res) => handleMetaGet(req, res));
router.get('/meta/:ownerId', (req, res) => handleMetaGet(req, res, req.params.ownerId));

/**
 * Webhook de entrada e status da Meta Cloud API (POST) com validação HMAC-SHA256.
 */
router.post('/meta', (req, res) => handleMetaPost(req, res));
router.post('/meta/:ownerId', (req, res) => handleMetaPost(req, res, req.params.ownerId));

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
