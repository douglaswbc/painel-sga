import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  disableEmailSettings,
  getEmailSettings,
  saveEmailSettings,
  sendDailySummaryManual,
  sendTestEmail,
} from '../services/email-settings-service.js';
import {
  activateMetaProvider,
  clearMetaAlert,
  disconnectMetaChannel,
  getMetaStatus,
  listMetaAlerts,
  refreshMetaStatus,
  registerMetaNumber,
  saveMetaWebhookSettings,
  validateManualMeta,
} from '../services/meta-integration-service.js';
import { PublicError } from '../services/whatsapp-sender.js';
import {
  activateZernioProvider,
  cancelZernioOnboarding,
  completeZernioOnboarding,
  disconnectZernioChannel,
  getZernioStatus,
  provisionZernioWebhook,
  refreshZernioProfiles,
  removeZernioKey,
  selectZernioChannel,
  startZernioOnboarding,
  validateZernioKey,
} from '../services/zernio-integration-service.js';

const router = Router();
router.use(requireAuth);

function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof PublicError) {
    res.status(error.status).json({ error: error.message, ...(error.extra ?? {}) });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  res.status(400).json({ error: message || fallback });
}

// ---------------------------------------------------------------------------
// Zernio Integration
// ---------------------------------------------------------------------------

router.get('/zernio', (req, res) => {
  try {
    res.json(getZernioStatus(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar a integração Zernio.');
  }
});

router.post('/zernio', async (req, res) => {
  try {
    const body = req.body ?? {};
    const action = typeof body.action === 'string' ? body.action : 'status';
    const userId = req.user!.id;

    switch (action) {
      case 'status':
        res.json(getZernioStatus(userId));
        return;
      case 'activate':
        res.json(activateZernioProvider(userId));
        return;
      case 'remove':
      case 'disconnect':
        res.json(removeZernioKey(userId));
        return;
      case 'validate':
      case 'save_key':
        res.json(await validateZernioKey(userId, body.apiKey));
        return;
      case 'refresh':
        res.json(await refreshZernioProfiles(userId));
        return;
      case 'select':
      case 'select_profile':
      case 'select_account':
        res.json(await selectZernioChannel(userId, body.profileId, body.accountId));
        return;
      case 'provision_webhook':
        res.json(await provisionZernioWebhook(userId));
        return;
      default:
        res.status(400).json({ error: 'Ação não reconhecida.' });
    }
  } catch (error) {
    handleError(res, error, 'Não foi possível concluir a operação.');
  }
});

router.post('/zernio/key', async (req, res) => {
  try {
    res.json(await validateZernioKey(req.user!.id, req.body?.apiKey));
  } catch (error) {
    handleError(res, error, 'Não foi possível validar a chave Zernio.');
  }
});

router.post('/zernio/refresh', async (req, res) => {
  try {
    res.json(await refreshZernioProfiles(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível atualizar a lista da Zernio.');
  }
});

router.post('/zernio/select', async (req, res) => {
  try {
    res.json(await selectZernioChannel(req.user!.id, req.body?.profileId, req.body?.accountId));
  } catch (error) {
    handleError(res, error, 'Não foi possível vincular o canal Zernio.');
  }
});

router.post('/zernio/activate', (req, res) => {
  try {
    res.json(activateZernioProvider(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível ativar o canal Zernio.');
  }
});

router.post('/zernio/webhook', async (req, res) => {
  try {
    res.json(await provisionZernioWebhook(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível configurar o webhook Zernio.');
  }
});

router.delete('/zernio', (req, res) => {
  try {
    res.json(removeZernioKey(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível remover a chave Zernio.');
  }
});

// ---------------------------------------------------------------------------
// Zernio Onboarding
// ---------------------------------------------------------------------------

router.post('/zernio/onboarding', async (req, res) => {
  try {
    const body = req.body ?? {};
    const action = typeof body.action === 'string' ? body.action : '';
    const userId = req.user!.id;

    switch (action) {
      case 'start':
        res.json(await startZernioOnboarding(userId, body));
        return;
      case 'complete':
        res.json(await completeZernioOnboarding(userId, body));
        return;
      case 'cancel':
        res.json(cancelZernioOnboarding(userId, body.profileId));
        return;
      case 'disconnect':
        res.json(await disconnectZernioChannel(userId));
        return;
      default:
        res.status(400).json({ error: 'Ação não reconhecida.' });
    }
  } catch (error) {
    handleError(res, error, 'Não foi possível concluir o onboarding.');
  }
});

router.post('/zernio/onboarding/start', async (req, res) => {
  try {
    res.json(await startZernioOnboarding(req.user!.id, req.body ?? {}));
  } catch (error) {
    handleError(res, error, 'Não foi possível iniciar o onboarding.');
  }
});

router.post('/zernio/onboarding/complete', async (req, res) => {
  try {
    res.json(await completeZernioOnboarding(req.user!.id, req.body ?? {}));
  } catch (error) {
    handleError(res, error, 'Não foi possível concluir o onboarding.');
  }
});

router.post('/zernio/onboarding/cancel', (req, res) => {
  try {
    res.json(cancelZernioOnboarding(req.user!.id, req.body?.profileId));
  } catch (error) {
    handleError(res, error, 'Não foi possível cancelar o onboarding.');
  }
});

router.post('/zernio/onboarding/disconnect', async (req, res) => {
  try {
    res.json(await disconnectZernioChannel(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível desconectar o canal.');
  }
});

// ---------------------------------------------------------------------------
// Meta Cloud API Integration
// ---------------------------------------------------------------------------

router.get('/meta', (req, res) => {
  try {
    res.json(getMetaStatus(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar a integração da Meta.');
  }
});

router.post('/meta', async (req, res) => {
  try {
    const body = req.body ?? {};
    const action = typeof body.action === 'string' ? body.action : 'status';
    const userId = req.user!.id;

    switch (action) {
      case 'status':
        res.json(getMetaStatus(userId));
        return;
      case 'alerts':
        res.json(listMetaAlerts(userId));
        return;
      case 'clear_alert':
        res.json(clearMetaAlert(userId, body.tipo));
        return;
      case 'activate':
        res.json(activateMetaProvider(userId, body.provider));
        return;
      case 'disconnect':
        res.json(disconnectMetaChannel(userId));
        return;
      case 'validate_manual':
        res.json(await validateManualMeta(userId, body));
        return;
      case 'save_webhook':
        res.json(saveMetaWebhookSettings(userId, body));
        return;
      case 'register':
        res.json(await registerMetaNumber(userId, body));
        return;
      case 'refresh':
        res.json(await refreshMetaStatus(userId));
        return;
      default:
        res.status(400).json({ error: 'Ação não reconhecida.' });
    }
  } catch (error) {
    handleError(res, error, 'Não foi possível concluir a operação.');
  }
});

router.get('/meta/alerts', (req, res) => {
  try {
    res.json(listMetaAlerts(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar os alertas da Meta.');
  }
});

router.post('/meta/alerts/clear', (req, res) => {
  try {
    res.json(clearMetaAlert(req.user!.id, req.body?.tipo));
  } catch (error) {
    handleError(res, error, 'Não foi possível limpar o alerta.');
  }
});

router.post('/meta/validate-manual', async (req, res) => {
  try {
    res.json(await validateManualMeta(req.user!.id, req.body ?? {}));
  } catch (error) {
    handleError(res, error, 'Não foi possível validar o token manual da Meta.');
  }
});

router.post('/meta/webhook-settings', (req, res) => {
  try {
    res.json(saveMetaWebhookSettings(req.user!.id, req.body ?? {}));
  } catch (error) {
    handleError(res, error, 'Não foi possível salvar os segredos do webhook da Meta.');
  }
});

router.post('/meta/register', async (req, res) => {
  try {
    res.json(await registerMetaNumber(req.user!.id, req.body ?? {}));
  } catch (error) {
    handleError(res, error, 'Não foi possível registrar o número na Meta.');
  }
});

router.post('/meta/refresh', async (req, res) => {
  try {
    res.json(await refreshMetaStatus(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível atualizar o status da Meta.');
  }
});

router.post('/meta/activate', (req, res) => {
  try {
    res.json(activateMetaProvider(req.user!.id, req.body?.provider ?? 'meta'));
  } catch (error) {
    handleError(res, error, 'Não foi possível ativar o provedor.');
  }
});

router.post('/meta/disconnect', (req, res) => {
  try {
    res.json(disconnectMetaChannel(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível desconectar a Meta.');
  }
});

router.delete('/meta', (req, res) => {
  try {
    res.json(disconnectMetaChannel(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível desconectar a Meta.');
  }
});

// ---------------------------------------------------------------------------
// Email Notification Settings (Resend + Daily Summary)
// ---------------------------------------------------------------------------

router.get('/email', (req, res) => {
  try {
    res.json(getEmailSettings(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível carregar as configurações de e-mail.');
  }
});

router.post('/email', async (req, res) => {
  try {
    const body = req.body ?? {};
    const action = typeof body.action === 'string' ? body.action : 'status';
    const userId = req.user!.id;

    switch (action) {
      case 'status':
      case 'get':
        res.json(getEmailSettings(userId));
        return;
      case 'save':
        res.json(await saveEmailSettings(userId, body));
        return;
      case 'disable':
        res.json(disableEmailSettings(userId));
        return;
      case 'test':
        res.json(await sendTestEmail(userId));
        return;
      case 'send_daily_summary':
        res.json(await sendDailySummaryManual(userId));
        return;
      default:
        res.status(400).json({ error: 'Ação não reconhecida.' });
    }
  } catch (error) {
    handleError(res, error, 'Não foi possível concluir a operação.');
  }
});

router.put('/email', async (req, res) => {
  try {
    res.json(await saveEmailSettings(req.user!.id, req.body ?? {}));
  } catch (error) {
    handleError(res, error, 'Não foi possível salvar a configuração de e-mail.');
  }
});

router.post('/email/disable', (req, res) => {
  try {
    res.json(disableEmailSettings(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível desativar as notificações.');
  }
});

router.post('/email/test', async (req, res) => {
  try {
    res.json(await sendTestEmail(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível enviar o e-mail de teste.');
  }
});

router.post('/email/daily-summary', async (req, res) => {
  try {
    res.json(await sendDailySummaryManual(req.user!.id));
  } catch (error) {
    handleError(res, error, 'Não foi possível enviar o resumo diário.');
  }
});

export default router;
