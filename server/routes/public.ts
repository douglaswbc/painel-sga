import { Router } from 'express';
import { getPublicApplicationMeta, submitPublicCandidateApplication } from '../services/candidatos-service.js';
import { PublicError } from '../services/whatsapp-sender.js';

const router = Router();

router.get('/inscricao/:token', (req, res) => {
  try {
    res.json(getPublicApplicationMeta(req.params.token));
  } catch (error) {
    if (error instanceof PublicError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Não foi possível validar o link de inscrição.' });
  }
});

router.post('/inscricao', (req, res) => {
  try {
    const contentLength = Number(req.headers['content-length'] ?? 0);
    const result = submitPublicCandidateApplication(req.body ?? {}, contentLength);
    res.json(result);
  } catch (error) {
    if (error instanceof PublicError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Não foi possível enviar a inscrição. Confira os dados e tente novamente.' });
  }
});

export default router;
