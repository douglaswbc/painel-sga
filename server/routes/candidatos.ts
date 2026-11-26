import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  confirmReservationManually,
  createApplicationLink,
  createReservationPix,
  deactivateApplicationLink,
  getApplicationLinkStatus,
  getCandidateReservationHistory,
  listCandidates,
  updateCandidate,
} from '../services/candidatos-service.js';
import { PublicError } from '../services/whatsapp-sender.js';

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

router.get('/link-inscricao', (req, res) => {
  try {
    res.json(getApplicationLinkStatus(req.user!.id));
  } catch (error) {
    sendError(res, error, 'Não foi possível consultar o link de inscrição.');
  }
});

router.post('/link-inscricao', (req, res) => {
  try {
    const origin = req.get('origin') || undefined;
    res.status(201).json(createApplicationLink(req.user!.id, origin));
  } catch (error) {
    sendError(res, error, 'Não foi possível gerar o link de inscrição.');
  }
});

router.delete('/link-inscricao', (req, res) => {
  try {
    res.json(deactivateApplicationLink(req.user!.id));
  } catch (error) {
    sendError(res, error, 'Não foi possível desativar o link de inscrição.');
  }
});

router.get('/', (req, res) => {
  try {
    res.json({ data: listCandidates(req.user!.id) });
  } catch (error) {
    sendError(res, error, 'Não foi possível carregar os candidatos.');
  }
});

router.put('/:id', (req, res) => {
  try {
    res.json({ data: updateCandidate(req.user!.id, req.params.id, req.body ?? {}) });
  } catch (error) {
    sendError(res, error, 'Erro ao atualizar candidato.');
  }
});

router.get('/:id/reserva-historico', (req, res) => {
  try {
    res.json(getCandidateReservationHistory(req.user!.id, req.params.id));
  } catch (error) {
    sendError(res, error, 'Não foi possível carregar o histórico da reserva.');
  }
});

router.post('/:id/reserva-pix', async (req, res) => {
  try {
    res.json(await createReservationPix(req.user!.id, req.params.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, 'Não foi possível gerar o PIX da reserva.');
  }
});

router.post('/:id/confirmar-reserva-manual', (req, res) => {
  try {
    res.json(confirmReservationManually(req.user!.id, req.params.id, req.body?.motivo));
  } catch (error) {
    sendError(res, error, 'Não foi possível confirmar a reserva manualmente.');
  }
});

export default router;
