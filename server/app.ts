import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { loadEnv } from './config/env.js';
import agendamentosRouter from './routes/agendamentos.js';
import accountRouter from './routes/account.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import candidatosRouter from './routes/candidatos.js';
import cobrancasRouter from './routes/cobrancas.js';
import contratosRouter from './routes/contratos.js';
import dashboardRouter from './routes/dashboard.js';
import fechadurasRouter from './routes/fechaduras.js';
import integrationsRouter from './routes/integrations.js';
import locatariosRouter from './routes/locatarios.js';
import mediaRouter from './routes/media.js';
import mensagensTemplateRouter from './routes/mensagens-template.js';
import metaRouter from './routes/meta.js';
import payLinkRouter from './routes/pay-link.js';
import publicRouter from './routes/public.js';
import searchRouter from './routes/search.js';
import veiculosRouter from './routes/veiculos.js';
import webhooksRouter from './routes/webhooks.js';
import whatsappRouter from './routes/whatsapp.js';

export function createApp() {
  const env = loadEnv();
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: env.nodeEnv === 'development' ? true : env.appPublicUrl,
      credentials: true,
    }),
  );

  // Captura rawBody para validar assinaturas HMAC-SHA256 de webhooks (Meta / Zernio)
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf.toString('utf8');
      },
    }),
  );

  app.use(express.urlencoded({ extended: true }));

  // Diretório público de uploads locais (substitui Supabase Storage bucket mensagens-midia)
  fs.mkdirSync(path.join(env.uploadDir, 'mensagens-midia'), { recursive: true });
  app.use('/uploads', express.static(env.uploadDir, { maxAge: '7d' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'painel-sga',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/account', accountRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/agendamentos', agendamentosRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/candidatos', candidatosRouter);
  app.use('/api/cobrancas', cobrancasRouter);
  app.use('/api/contratos', contratosRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/fechaduras', fechadurasRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/locatarios', locatariosRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/mensagens-template', mensagensTemplateRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/veiculos', veiculosRouter);
  app.use('/api/ativos', veiculosRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/whatsapp', whatsappRouter);
  app.use('/pagar', payLinkRouter);

  // Qualquer rota /api/* não mapeada devolve JSON 404 (nunca HTML do SPA)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint da API não encontrado.' });
  });

  // Em produção (ou quando dist/ existir), serve o build estático do frontend + fallback SPA
  const distDir = path.resolve(process.cwd(), 'dist');
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(indexHtml);
    });
  }

  // Tratador global de erros
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Erro interno do servidor.';
    const status = typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : 400;

    if (status >= 500) {
      console.error('[server] Erro inesperado:', err);
    }
    res.status(status).json({ error: message });
  });

  return app;
}
