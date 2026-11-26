import { loadEnv } from './config/env.js';
import { bootstrapAdmin, closeDb, getDb } from './db/database.js';
import { registerCronHandlers, startScheduler, stopScheduler } from './cron/scheduler.js';
import { runAutoBilling, runChargeReminders } from './services/billing-service.js';
import { runDailySummaryCron } from './services/daily-summary.js';
import { runScheduledMessages } from './services/scheduled-messages-service.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // Inicializa SQLite, aplica migrations e cria admin inicial se necessário
  getDb();
  await bootstrapAdmin();

  registerCronHandlers({
    faturamento: async () => {
      await runAutoBilling();
    },
    lembretes: runChargeReminders,
    agendamentos: runScheduledMessages,
    resumoDiario: async () => {
      await runDailySummaryCron();
    },
  });

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    console.log(`[server] Painel SGA ouvindo em http://${env.host}:${env.port}`);
    console.log(`[server] URL pública configurada: ${env.appPublicUrl}`);
  });

  startScheduler();

  const shutdown = (signal: string) => {
    console.log(`[server] Recebido ${signal}, encerrando...`);
    stopScheduler();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] Falha fatal na inicialização:', error);
  process.exit(1);
});
