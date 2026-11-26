import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { decryptSecret, timingSafeEqualStr } from '../utils/crypto.js';
import { handleLockOtp } from './lock-otp.js';
import {
  classifyMetaWebhookError,
  recordAndNotifyMetaAlert,
  resolveMetaAlerts,
} from './meta-alerts.js';
import { MetaApiError } from './meta-graph.js';
import { sendMetaTextMessage } from './meta-messages.js';

type JsonRecord = Record<string, any>;

const ZERNIO_API = 'https://api.zernio.com/v1';
const META_STATUSES = new Set(['accepted', 'sent', 'delivered', 'read', 'failed']);
const DELIVERY_TABLES = [
  'zernio_whatsapp_deliveries',
  'zernio_whatsapp_manual_deliveries',
  'zernio_whatsapp_scheduled_deliveries',
] as const;

function registerWhatsappWebhookEvent(
  eventId: string,
  ownerId: string | null,
  accountId: string,
  eventName: string,
): boolean {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO whatsapp_webhook_events (id, event_id, id_usuario, provider, account_id, event_name)
       VALUES (?, ?, ?, 'meta', ?, ?)
       ON CONFLICT (event_id) DO NOTHING`,
    )
    .run(crypto.randomUUID(), eventId, ownerId, accountId, eventName);
  return res.changes > 0;
}

function matchesHmacSha256Hex(rawBody: string, secret: string, signature: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqualStr(expected, signature);
}

export function verifyMetaWebhookChallenge(verifyToken: string, ownerId?: string): boolean {
  const env = loadEnv();
  const db = getDb();

  if (ownerId) {
    const row = db
      .prepare('SELECT meta_webhook_verify_token_ciphertext FROM zernio_integracoes WHERE id_usuario = ?')
      .get(ownerId) as { meta_webhook_verify_token_ciphertext?: string | null } | undefined;

    if (row?.meta_webhook_verify_token_ciphertext) {
      try {
        const expected = decryptSecret(String(row.meta_webhook_verify_token_ciphertext), ownerId);
        return timingSafeEqualStr(verifyToken, expected);
      } catch {
        return false;
      }
    }

    if (env.meta.webhookVerifyToken) {
      return timingSafeEqualStr(verifyToken, env.meta.webhookVerifyToken);
    }
    return false;
  }

  if (env.meta.webhookVerifyToken && timingSafeEqualStr(verifyToken, env.meta.webhookVerifyToken)) {
    return true;
  }

  const rows = db
    .prepare(
      `SELECT id_usuario, meta_webhook_verify_token_ciphertext
       FROM zernio_integracoes
       WHERE meta_webhook_verify_token_ciphertext IS NOT NULL`,
    )
    .all() as Array<{ id_usuario: string; meta_webhook_verify_token_ciphertext: string }>;

  for (const row of rows) {
    try {
      const expected = decryptSecret(String(row.meta_webhook_verify_token_ciphertext), row.id_usuario);
      if (timingSafeEqualStr(verifyToken, expected)) return true;
    } catch {
      // Ignora credencial inválida de outro locador
    }
  }
  return false;
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signature: string,
  ownerId?: string,
): { configured: boolean; valid: boolean; matchedOwnerId?: string } {
  const env = loadEnv();
  const db = getDb();

  if (ownerId) {
    const row = db
      .prepare('SELECT meta_app_secret_ciphertext FROM zernio_integracoes WHERE id_usuario = ?')
      .get(ownerId) as { meta_app_secret_ciphertext?: string | null } | undefined;

    if (row?.meta_app_secret_ciphertext) {
      try {
        const secret = decryptSecret(String(row.meta_app_secret_ciphertext), ownerId);
        return {
          configured: true,
          valid: matchesHmacSha256Hex(rawBody, secret, signature),
          matchedOwnerId: ownerId,
        };
      } catch {
        return { configured: true, valid: false };
      }
    }

    if (env.meta.appSecret) {
      return {
        configured: true,
        valid: matchesHmacSha256Hex(rawBody, env.meta.appSecret, signature),
        matchedOwnerId: ownerId,
      };
    }
    return { configured: false, valid: false };
  }

  if (env.meta.appSecret && matchesHmacSha256Hex(rawBody, env.meta.appSecret, signature)) {
    return { configured: true, valid: true };
  }

  const rows = db
    .prepare(
      `SELECT id_usuario, meta_app_secret_ciphertext
       FROM zernio_integracoes
       WHERE meta_app_secret_ciphertext IS NOT NULL`,
    )
    .all() as Array<{ id_usuario: string; meta_app_secret_ciphertext: string }>;

  for (const row of rows) {
    try {
      const secret = decryptSecret(String(row.meta_app_secret_ciphertext), row.id_usuario);
      if (matchesHmacSha256Hex(rawBody, secret, signature)) {
        return { configured: true, valid: true, matchedOwnerId: row.id_usuario };
      }
    } catch {
      // Ignora credencial inválida de outro locador
    }
  }

  return {
    configured: Boolean(env.meta.appSecret) || rows.length > 0,
    valid: false,
  };
}

function findDeliveryOwner(messageId: string, scopedOwnerId?: string): string | null {
  const db = getDb();
  for (const table of DELIVERY_TABLES) {
    const row = scopedOwnerId
      ? (db
          .prepare(`SELECT id_usuario FROM ${table} WHERE message_id = ? AND id_usuario = ? LIMIT 1`)
          .get(messageId, scopedOwnerId) as { id_usuario?: string } | undefined)
      : (db
          .prepare(`SELECT id_usuario FROM ${table} WHERE message_id = ? LIMIT 1`)
          .get(messageId) as { id_usuario?: string } | undefined);
    if (row?.id_usuario) return row.id_usuario;
  }
  return null;
}

async function updateDeliveryStatus(
  messageId: string,
  statusObj: JsonRecord,
  ownerId: string | null,
): Promise<boolean> {
  const name = String(statusObj.status ?? '').toLowerCase();
  if (!META_STATUSES.has(name)) return false;

  const firstError = Array.isArray(statusObj.errors) ? (statusObj.errors[0] as JsonRecord | undefined) : undefined;
  const safeError = firstError
    ? `Meta: ${String(firstError.title ?? firstError.message ?? 'falha na entrega').slice(0, 200)}`
    : null;

  const db = getDb();
  const now = new Date().toISOString();
  let updated = false;

  for (const table of DELIVERY_TABLES) {
    if (name === 'failed' && safeError) {
      const sql =
        table === 'zernio_whatsapp_scheduled_deliveries'
          ? `UPDATE ${table} SET meta_status = ?, status = 'failed', safe_error = ?, error_code = 'meta_delivery_failed' WHERE message_id = ?`
          : `UPDATE ${table} SET meta_status = ?, status = 'failed', safe_error = ?, error_code = 'meta_delivery_failed', updated_at = ? WHERE message_id = ?`;
      const res =
        table === 'zernio_whatsapp_scheduled_deliveries'
          ? db.prepare(sql).run(name, safeError, messageId)
          : db.prepare(sql).run(name, safeError, now, messageId);
      if (res.changes > 0) updated = true;
    } else {
      const sql =
        table === 'zernio_whatsapp_scheduled_deliveries'
          ? `UPDATE ${table} SET meta_status = ? WHERE message_id = ?`
          : `UPDATE ${table} SET meta_status = ?, updated_at = ? WHERE message_id = ?`;
      const res =
        table === 'zernio_whatsapp_scheduled_deliveries'
          ? db.prepare(sql).run(name, messageId)
          : db.prepare(sql).run(name, now, messageId);
      if (res.changes > 0) updated = true;
    }
  }

  if (ownerId) {
    if (name === 'failed' && firstError) {
      const meta = classifyMetaWebhookError(
        typeof firstError.code === 'number' ? 400 : 500,
        firstError,
      );
      if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
    } else if (name === 'sent' || name === 'delivered' || name === 'read') {
      try {
        resolveMetaAlerts(ownerId);
      } catch (resolveErr) {
        console.error(
          '[webhook:meta] Falha ao resolver alertas:',
          resolveErr instanceof Error ? resolveErr.message : resolveErr,
        );
      }
    }
  }

  return updated;
}

export async function handleMetaWebhookEvent(
  payload: JsonRecord,
  scopedOwnerId?: string,
): Promise<{ ok: true; inbound: number; statuses: number }> {
  const db = getDb();
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let inbound = 0;
  let statuses = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (String(change?.field ?? '') !== 'messages') continue;
      const value = (change?.value ?? {}) as JsonRecord;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      if (typeof phoneNumberId !== 'string') continue;

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const messageId = typeof status?.id === 'string' ? status.id : null;
        if (!messageId) continue;
        const ownerId = findDeliveryOwner(messageId, scopedOwnerId);
        if (scopedOwnerId && ownerId !== scopedOwnerId) continue;
        const fresh = registerWhatsappWebhookEvent(
          `status:${messageId}:${String(status.status ?? '')}`,
          ownerId,
          phoneNumberId,
          'message.status',
        );
        if (!fresh) continue;
        if (await updateDeliveryStatus(messageId, status, ownerId)) statuses += 1;
      }

      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (!messages.length) continue;

      const integrations = (scopedOwnerId
        ? db
            .prepare(
              `SELECT id_usuario, meta_access_token_ciphertext, meta_status, meta_phone_number_id
               FROM zernio_integracoes
               WHERE meta_phone_number_id = ? AND id_usuario = ?
               LIMIT 1`,
            )
            .all(phoneNumberId, scopedOwnerId)
        : db
            .prepare(
              `SELECT id_usuario, meta_access_token_ciphertext, meta_status, meta_phone_number_id
               FROM zernio_integracoes
               WHERE meta_phone_number_id = ?
               LIMIT 10`,
            )
            .all(phoneNumberId)) as Array<{
        id_usuario: string;
        meta_access_token_ciphertext: string | null;
        meta_status: string;
        meta_phone_number_id: string | null;
      }>;

      const candidates = integrations.filter(
        (item) => item.id_usuario && item.meta_access_token_ciphertext && item.meta_status !== 'invalid',
      );
      if (!candidates.length) continue;

      for (const message of messages) {
        const messageId = typeof message?.id === 'string' ? message.id : null;
        const from = typeof message?.from === 'string' ? message.from : '';
        const text = typeof message?.text?.body === 'string' ? message.text.body : '';
        if (!messageId || !from || !text.trim()) continue;

        const fresh = registerWhatsappWebhookEvent(
          messageId,
          candidates[0].id_usuario,
          phoneNumberId,
          'message.received',
        );
        if (!fresh) continue;

        let replied = false;
        let fallback: string | null = null;
        for (const integration of candidates) {
          const outcome = handleLockOtp(integration.id_usuario, from, text);
          if (!outcome.handled || !outcome.reply) continue;
          if (outcome.kind !== 'otp' && outcome.kind !== 'invalid_code') {
            fallback = fallback ?? outcome.reply;
            continue;
          }

          const token = decryptSecret(String(integration.meta_access_token_ciphertext), integration.id_usuario);
          try {
            await sendMetaTextMessage(phoneNumberId, token, from, outcome.reply);
          } catch (error) {
            if (error instanceof MetaApiError) {
              const meta = classifyMetaWebhookError(error.status, {
                code: error.code,
                message: error.message,
                error_data: { details: error.userMessage },
              });
              if (meta) await recordAndNotifyMetaAlert(integration.id_usuario, meta);
            }
            console.error(
              '[webhook:meta] Falha ao responder OTP:',
              error instanceof Error ? error.message : error,
            );
            continue;
          }

          try {
            resolveMetaAlerts(integration.id_usuario);
          } catch {
            // Não interrompe webhook se limpeza de alerta falhar
          }
          inbound += 1;
          replied = true;
          break;
        }

        if (!replied && fallback) {
          const token = decryptSecret(String(candidates[0].meta_access_token_ciphertext), candidates[0].id_usuario);
          try {
            await sendMetaTextMessage(phoneNumberId, token, from, fallback);
            resolveMetaAlerts(candidates[0].id_usuario);
          } catch (error) {
            if (error instanceof MetaApiError) {
              const meta = classifyMetaWebhookError(error.status, {
                code: error.code,
                message: error.message,
                error_data: { details: error.userMessage },
              });
              if (meta) await recordAndNotifyMetaAlert(candidates[0].id_usuario, meta);
            }
          }
          inbound += 1;
        }
      }
    }
  }

  return { ok: true, inbound, statuses };
}

function validZernioSignature(rawBody: string, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const signature = header.replace(/^sha256=/i, '').trim();
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const hex = digest.toString('hex');
  const b64 = digest.toString('base64');
  return timingSafeEqualStr(hex, signature) || timingSafeEqualStr(b64, signature);
}

async function replyZernioConversation(
  apiKey: string,
  accountId: string,
  conversationId: string,
  message: string,
): Promise<void> {
  const response = await fetch(`${ZERNIO_API}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ accountId, message }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    console.error('[webhook:fechadura] Falha na resposta Zernio:', response.status);
  }
}

export async function handleZernioLockWebhook(
  rawBody: string,
  headers: IncomingHttpHeaders,
  payload: JsonRecord,
): Promise<{ status: number; body: unknown }> {
  const accountId = payload.account?.accountId ?? payload.account?.id ?? payload.accountId;
  const zernioEventIdHeader = typeof headers['x-zernio-event-id'] === 'string' ? headers['x-zernio-event-id'] : undefined;
  const eventId = payload.id ?? zernioEventIdHeader;
  if (typeof accountId !== 'string' || typeof eventId !== 'string' || !eventId) {
    return { status: 400, body: { error: 'Invalid webhook payload' } };
  }

  const db = getDb();
  const integration = db
    .prepare(
      `SELECT id_usuario, api_key_ciphertext, webhook_secret_ciphertext, webhook_account_id, whatsapp_account_id
       FROM zernio_integracoes
       WHERE webhook_account_id = ?`,
    )
    .get(accountId) as
    | {
        id_usuario: string;
        api_key_ciphertext: string | null;
        webhook_secret_ciphertext: string | null;
        webhook_account_id: string | null;
        whatsapp_account_id: string | null;
      }
    | undefined;

  if (!integration?.webhook_secret_ciphertext || integration.whatsapp_account_id !== accountId) {
    return { status: 404, body: { error: 'Unknown account' } };
  }

  const webhookSecret = decryptSecret(integration.webhook_secret_ciphertext, integration.id_usuario);
  const sigHeader = typeof headers['x-zernio-signature'] === 'string' ? headers['x-zernio-signature'] : undefined;
  if (!validZernioSignature(rawBody, webhookSecret, sigHeader)) {
    return { status: 401, body: { error: 'Invalid signature' } };
  }

  const eventHeader = typeof headers['x-zernio-event'] === 'string' ? headers['x-zernio-event'] : undefined;
  const eventName = eventHeader ?? payload.event ?? payload.type;
  const message = payload.message ?? payload.data?.message ?? {};
  const conversation = payload.conversation ?? payload.data?.conversation ?? {};
  const direction = message.direction ?? payload.direction;

  if (
    eventName !== 'message.received' ||
    (direction && direction !== 'incoming') ||
    payload.metadata?.standby === true
  ) {
    return { status: 200, body: { status: 'ignored' } };
  }

  const dedupe = db
    .prepare(
      `INSERT INTO zernio_webhook_events (id, event_id, id_usuario, account_id, event_name)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (event_id) DO NOTHING`,
    )
    .run(crypto.randomUUID(), eventId, integration.id_usuario, accountId, String(eventName));

  if (dedupe.changes === 0) {
    return { status: 200, body: { status: 'duplicate' } };
  }

  const sender = message.sender ?? payload.sender ?? {};
  const phone = typeof sender === 'string' ? sender : sender.phoneNumber ?? sender.phone ?? sender.id ?? '';
  const messageContent = message.text ?? message.content ?? message.body ?? '';
  const conversationId = conversation.id ?? message.conversationId;

  if (
    typeof phone !== 'string' ||
    typeof messageContent !== 'string' ||
    !messageContent.trim() ||
    typeof conversationId !== 'string'
  ) {
    return { status: 200, body: { status: 'ignored', reason: 'incomplete_message' } };
  }

  const phoneDigits = phone.replace(/\D/g, '');
  const cleanMsg = messageContent.trim().toLowerCase();
  const outcome = handleLockOtp(integration.id_usuario, phoneDigits, cleanMsg);

  if (outcome.handled && outcome.reply && integration.api_key_ciphertext) {
    const apiKey = decryptSecret(integration.api_key_ciphertext, integration.id_usuario);
    await replyZernioConversation(apiKey, accountId, conversationId, outcome.reply);
  }

  return { status: 200, body: { ok: true, handled: outcome.handled, kind: outcome.kind } };
}
