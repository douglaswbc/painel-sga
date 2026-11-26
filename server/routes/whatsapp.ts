import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { PublicError } from '../services/whatsapp-sender.js';
import {
  createWhatsappSchedule,
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  getWhatsappActivity,
  getWhatsappAnalytics,
  getWhatsappHealth,
  listWhatsappTemplates,
  removeWhatsappTemplateUsage,
  saveChargeTemplateOrder,
  sendManualTemplate,
  setWhatsappTemplateDefault,
  updateWhatsappTemplate,
} from '../services/whatsapp-templates-service.js';

const router = Router();
router.use(requireAuth);

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof PublicError) {
    res.status(error.status).json({ error: error.message, ...(error.extra ?? {}) });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  res.status(500).json({ error: message || fallback });
}

router.get('/health', async (req, res) => {
  try {
    res.json(await getWhatsappHealth(req.user!.id));
  } catch (error) {
    sendError(res, error, 'Não foi possível consultar o canal WhatsApp.');
  }
});

router.get('/activity', (req, res) => {
  try {
    const start = typeof req.query.start === 'string' ? req.query.start : undefined;
    const end = typeof req.query.end === 'string' ? req.query.end : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 25;
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    res.json(getWhatsappActivity(req.user!.id, { start, end, page, pageSize, search }));
  } catch (error) {
    sendError(res, error, 'Não foi possível carregar o histórico de atividade.');
  }
});

router.get('/analytics', (req, res) => {
  try {
    const start = typeof req.query.start === 'string' ? req.query.start : undefined;
    const end = typeof req.query.end === 'string' ? req.query.end : undefined;
    res.json(getWhatsappAnalytics(req.user!.id, { start, end }));
  } catch (error) {
    sendError(res, error, 'Não foi possível calcular os custos estimados.');
  }
});

router.get('/templates', async (req, res) => {
  try {
    res.json(await listWhatsappTemplates(req.user!.id));
  } catch (error) {
    sendError(res, error, 'Não foi possível listar os templates WhatsApp.');
  }
});

router.post('/templates', async (req, res) => {
  try {
    res.status(201).json(await createWhatsappTemplate(req.user!.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, 'Não foi possível criar o template.');
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    res.json(await updateWhatsappTemplate(req.user!.id, req.params.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, 'Não foi possível atualizar o template.');
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    res.json(await deleteWhatsappTemplate(req.user!.id, req.params.id));
  } catch (error) {
    sendError(res, error, 'Não foi possível excluir o template.');
  }
});

router.post('/templates/default', async (req, res) => {
  try {
    res.json(await setWhatsappTemplateDefault(req.user!.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, 'Não foi possível configurar o template padrão.');
  }
});

router.delete('/templates/:id/usage/:purpose', async (req, res) => {
  try {
    res.json(await removeWhatsappTemplateUsage(req.user!.id, req.params.id, req.params.purpose));
  } catch (error) {
    sendError(res, error, 'Não foi possível remover a classificação do template.');
  }
});

router.post('/templates/charge-order', async (req, res) => {
  try {
    const templateIds = Array.isArray(req.body?.templateIds) ? req.body.templateIds : [];
    res.json(await saveChargeTemplateOrder(req.user!.id, templateIds));
  } catch (error) {
    sendError(res, error, 'Não foi possível salvar a ordem dos templates de cobrança.');
  }
});

router.post('/send-template', async (req, res) => {
  try {
    res.json(await sendManualTemplate(req.user!.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, 'Não foi possível enviar o template.');
  }
});

router.post('/schedules', (req, res) => {
  try {
    res.status(201).json(createWhatsappSchedule(req.user!.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, 'Não foi possível criar o agendamento.');
  }
});

export default router;
