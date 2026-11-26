import crypto from 'node:crypto';
import { getDb } from '../db/database.js';
import { decryptSecret } from '../utils/crypto.js';
import {
  blockingAlertOwners,
  classifyMetaError,
  recordAndNotifyMetaAlert,
  resolveMetaAlerts,
} from './meta-alerts.js';
import { MetaApiError } from './meta-graph.js';
import { sendMetaTemplateMessage } from './meta-messages.js';
import { normalizeProvider, zernioRequest } from './whatsapp-sender.js';

type JsonRecord = Record<string, any>;

function localDateTimeBrt() {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date())
    .reduce((result: Record<string, string>, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:00`,
  };
}

function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthClamped(dateValue: string): string {
  const [year, month, day] = dateValue.split('-').map(Number);
  const targetFirst = new Date(Date.UTC(year, month, 1, 12));
  const targetYear = targetFirst.getUTCFullYear();
  const targetMonth = targetFirst.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 12)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function nextOccurrence(schedule: JsonRecord, today: string): string {
  let next = String(schedule.proximo_envio);
  let guard = 0;
  do {
    if (schedule.frequencia === 'diario') next = addDays(next, 1);
    else if (schedule.frequencia === 'semanal') next = addDays(next, 7);
    else if (schedule.frequencia === 'quinzenal') next = addDays(next, 15);
    else if (schedule.frequencia === 'mensal') next = addMonthClamped(next);
    else if (schedule.frequencia === 'personalizado' && Number(schedule.frequencia_dias) > 0) {
      next = addDays(next, Number(schedule.frequencia_dias));
    } else {
      throw new Error('Frequência do agendamento inválida.');
    }
    guard += 1;
    if (guard > 1000) throw new Error('Não foi possível calcular a próxima data do agendamento.');
  } while (next <= today);
  return next;
}

function formatScheduledPhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  throw new Error('O WhatsApp do locatário não tem DDD e um número válido.');
}

export async function runScheduledMessages(): Promise<void> {
  const db = getDb();
  const { date: today, time: currentTime } = localDateTimeBrt();

  const dueSchedules = db
    .prepare(
      `SELECT
        a.id, a.id_usuario, a.id_locatario, a.zernio_template_id, a.template_params,
        a.frequencia, a.frequencia_dias, a.proximo_envio, a.horario_envio,
        t.account_id AS tmpl_account_id, t.name AS tmpl_name, t.language AS tmpl_language,
        t.status AS tmpl_status, t.components AS tmpl_components,
        l.nome_completo AS loc_nome, l.whatsapp AS loc_whatsapp
       FROM agendamentos_mensagens a
       LEFT JOIN zernio_whatsapp_templates t ON t.id = a.zernio_template_id AND t.id_usuario = a.id_usuario
       LEFT JOIN locatarios l ON l.id = a.id_locatario AND l.id_usuario = a.id_usuario
       WHERE a.ativo = 1 AND a.zernio_template_id IS NOT NULL AND a.proximo_envio <= ?
       ORDER BY a.proximo_envio ASC`,
    )
    .all(today) as JsonRecord[];

  const schedules = dueSchedules.filter(
    (s) => s.proximo_envio !== today || String(s.horario_envio).slice(0, 8) <= currentTime,
  );
  if (!schedules.length) return;

  const ownerIds = [...new Set(schedules.map((s) => String(s.id_usuario)))];
  const placeholders = ownerIds.map(() => '?').join(', ');
  const integrations = db
    .prepare(`SELECT * FROM zernio_integracoes WHERE id_usuario IN (${placeholders})`)
    .all(...ownerIds) as JsonRecord[];

  const integrationByOwner = new Map(integrations.map((item) => [String(item.id_usuario), item]));
  const metaOwners = integrations.filter((r) => normalizeProvider(r.provider) === 'meta').map((r) => String(r.id_usuario));
  const blockedOwners = blockingAlertOwners(metaOwners);

  for (const schedule of schedules) {
    const ownerId = String(schedule.id_usuario);
    const integration = integrationByOwner.get(ownerId);
    const provider = normalizeProvider(integration?.provider);

    if (provider === 'meta' && blockedOwners.has(ownerId)) {
      continue;
    }

    const scheduledTime = String(schedule.horario_envio).slice(0, 8);
    const idempotencyKey = `sga-schedule-${schedule.id}-${schedule.proximo_envio}-${scheduledTime}`;

    try {
      if (!schedule.tmpl_name || schedule.tmpl_status !== 'APPROVED') {
        const message = 'O template Meta não está aprovado. O agendamento foi pausado.';
        db.prepare('UPDATE agendamentos_mensagens SET ativo = 0, ultimo_erro = ? WHERE id = ? AND id_usuario = ?').run(
          message,
          schedule.id,
          ownerId,
        );
        continue;
      }

      if (!schedule.loc_whatsapp) throw new Error('O locatário não possui WhatsApp cadastrado.');

      const channelId = provider === 'meta' ? integration?.meta_phone_number_id : integration?.whatsapp_account_id;
      if (provider === 'meta') {
        if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id || integration?.meta_status === 'invalid') {
          throw new Error('A integração da Meta ou o canal associado ao template está indisponível.');
        }
      } else if (!integration?.api_key_ciphertext || integration.key_status !== 'valid') {
        throw new Error('A integração Zernio ou o canal associado ao template está indisponível.');
      }

      if (channelId !== schedule.tmpl_account_id) {
        throw new Error('O canal do template não é o canal ativo deste locador.');
      }

      const credential =
        provider === 'meta' ? integration.meta_access_token_ciphertext : integration.api_key_ciphertext;
      const apiKey = decryptSecret(String(credential), ownerId);

      let templateParams: string[] = [];
      try {
        const parsed = JSON.parse(String(schedule.template_params || '[]'));
        if (Array.isArray(parsed)) templateParams = parsed.map(String);
      } catch {
        templateParams = [];
      }

      let deliveryId: string = crypto.randomUUID();
      try {
        db.prepare(
          `INSERT INTO zernio_whatsapp_scheduled_deliveries (
            id, id_agendamento, id_usuario, scheduled_date, scheduled_time, idempotency_key, status, attempted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'sending', ?)`,
        ).run(deliveryId, schedule.id, ownerId, schedule.proximo_envio, scheduledTime, idempotencyKey, new Date().toISOString());
      } catch {
        const existing = db
          .prepare(
            `SELECT id, status, attempted_at FROM zernio_whatsapp_scheduled_deliveries
             WHERE id_agendamento = ? AND scheduled_date = ? AND scheduled_time = ?`,
          )
          .get(schedule.id, schedule.proximo_envio, scheduledTime) as JsonRecord | undefined;

        if (!existing) throw new Error('Não foi possível consultar a tentativa de envio recorrente.');
        if (existing.status === 'sent') {
          db.prepare(
            'UPDATE agendamentos_mensagens SET proximo_envio = ?, ultimo_erro = NULL, ultima_execucao = ? WHERE id = ? AND id_usuario = ?',
          ).run(nextOccurrence(schedule, today), new Date().toISOString(), schedule.id, ownerId);
          continue;
        }
        const attemptedAt = new Date(String(existing.attempted_at)).getTime();
        if (existing.status === 'sending' && attemptedAt > Date.now() - 120000) continue;
        if (existing.status === 'failed' && attemptedAt > Date.now() - 300000) continue;

        const upd = db
          .prepare(
            `UPDATE zernio_whatsapp_scheduled_deliveries
             SET status = 'sending', safe_error = NULL, error_code = NULL, attempted_at = ?
             WHERE id = ? AND status = ?`,
          )
          .run(new Date().toISOString(), existing.id, existing.status);
        if (upd.changes === 0) continue;
        deliveryId = String(existing.id);
      }

      let messageId: string;
      let conversationId: string | null = null;
      let components: unknown[] = [];
      try {
        components = JSON.parse(String(schedule.tmpl_components || '[]'));
      } catch {
        components = [];
      }

      if (provider === 'meta') {
        const result = await sendMetaTemplateMessage({
          phoneNumberId: String(schedule.tmpl_account_id),
          token: apiKey,
          to: formatScheduledPhone(String(schedule.loc_whatsapp)),
          templateName: String(schedule.tmpl_name),
          templateLanguage: String(schedule.tmpl_language),
          templateParams,
          components,
        });
        messageId = result.messageId;
      } else {
        const sentPayload = await zernioRequest('/inbox/conversations', apiKey, {
          method: 'POST',
          idempotencyKey,
          body: {
            accountId: schedule.tmpl_account_id,
            participantId: formatScheduledPhone(String(schedule.loc_whatsapp)),
            templateName: schedule.tmpl_name,
            templateLanguage: schedule.tmpl_language,
            ...(templateParams.length ? { templateParams } : {}),
          },
        });
        const sentData = sentPayload.data ?? sentPayload;
        if (typeof sentData.messageId !== 'string' || !sentData.messageId) {
          throw new Error('A Zernio não retornou o identificador da mensagem.');
        }
        messageId = sentData.messageId;
        conversationId = typeof sentData.conversationId === 'string' ? sentData.conversationId : null;
      }

      const sentAt = new Date().toISOString();
      db.prepare(
        `UPDATE zernio_whatsapp_scheduled_deliveries
         SET status = 'sent', message_id = ?, conversation_id = ?, safe_error = NULL, error_code = NULL, sent_at = ?
         WHERE id = ? AND status = 'sending'`,
      ).run(messageId, conversationId, sentAt, deliveryId);

      const nextDate = nextOccurrence(schedule, today);
      db.prepare(
        'UPDATE agendamentos_mensagens SET proximo_envio = ?, ultimo_erro = NULL, ultima_execucao = ? WHERE id = ? AND id_usuario = ?',
      ).run(nextDate, sentAt, schedule.id, ownerId);

      if (provider === 'meta') resolveMetaAlerts(ownerId);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 350);
      if (error instanceof MetaApiError) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
      }

      db.prepare(
        `UPDATE zernio_whatsapp_scheduled_deliveries
         SET status = 'failed', safe_error = ?, error_code = 'scheduled_send_failed', attempted_at = ?
         WHERE id_agendamento = ? AND scheduled_date = ? AND scheduled_time = ? AND status = 'sending'`,
      ).run(message, new Date().toISOString(), schedule.id, schedule.proximo_envio, scheduledTime);

      db.prepare('UPDATE agendamentos_mensagens SET ultimo_erro = ? WHERE id = ? AND id_usuario = ?').run(
        message,
        schedule.id,
        ownerId,
      );
    }
  }
}
