import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  ALLOWED_META_ALERT_TYPES,
  activeMetaAlerts,
  publicMetaAlerts,
  resolveMetaAlerts,
  type MetaAlertType,
} from '../services/meta-alerts.js';

const router = Router();

router.get('/alerts', requireAuth, (req, res) => {
  const alerts = activeMetaAlerts(req.user!.id);
  res.json({ alerts: publicMetaAlerts(alerts) });
});

router.post('/alerts/clear', requireAuth, (req, res) => {
  const requested = typeof req.body?.tipo === 'string' ? req.body.tipo.trim() : '';
  if (requested && !ALLOWED_META_ALERT_TYPES.includes(requested as MetaAlertType)) {
    res.status(400).json({ error: 'Tipo de alerta inválido.' });
    return;
  }

  resolveMetaAlerts(
    req.user!.id,
    requested ? [requested as MetaAlertType] : undefined,
  );
  const alerts = activeMetaAlerts(req.user!.id);
  res.json({ alerts: publicMetaAlerts(alerts), success: true });
});

export default router;
