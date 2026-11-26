import cron, { type ScheduledTask } from 'node-cron';
import { loadEnv } from '../config/env.js';

export type CronHandler = () => Promise<void>;

export type CronHandlers = {
  faturamento?: CronHandler;
  lembretes?: CronHandler;
  agendamentos?: CronHandler;
  resumoDiario?: CronHandler;
};

const activeTasks: ScheduledTask[] = [];
const runningLocks = new Set<string>();
let registeredHandlers: CronHandlers = {};

export function registerCronHandlers(handlers: CronHandlers): void {
  registeredHandlers = { ...registeredHandlers, ...handlers };
}

async function runWithLock(name: string, handler?: CronHandler): Promise<void> {
  if (!handler) return;
  if (runningLocks.has(name)) {
    console.warn(`[cron] Ignorando execução concorrente de "${name}".`);
    return;
  }
  runningLocks.add(name);
  try {
    await handler();
  } catch (error) {
    console.error(`[cron] Falha na rotina "${name}":`, error);
  } finally {
    runningLocks.delete(name);
  }
}

export function startScheduler(): void {
  const env = loadEnv();
  if (!env.enableCron) {
    console.log('[cron] Agendador interno desabilitado via ENABLE_CRON=false.');
    return;
  }

  if (activeTasks.length > 0) return;

  const fiveMinTask = cron.schedule('*/5 * * * *', async () => {
    await runWithLock('faturamento', registeredHandlers.faturamento);
    await runWithLock('lembretes', registeredHandlers.lembretes);
    await runWithLock('agendamentos', registeredHandlers.agendamentos);
  });

  const dailyTask = cron.schedule(
    '0 8 * * *',
    async () => {
      await runWithLock('resumoDiario', registeredHandlers.resumoDiario);
    },
    { timezone: 'America/Sao_Paulo' },
  );

  activeTasks.push(fiveMinTask, dailyTask);
  console.log('[cron] Agendador interno iniciado (ciclo 5min + resumo diário 08:00 BRT).');
}

export function stopScheduler(): void {
  for (const task of activeTasks) {
    task.stop();
  }
  activeTasks.length = 0;
}
