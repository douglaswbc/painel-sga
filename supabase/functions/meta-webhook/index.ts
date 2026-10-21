import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptSecret } from '../_shared/crypto.ts';
import { handleLockOtp } from '../_shared/lock-otp.ts';
import { sendMetaTextMessage } from '../_shared/meta-messages.ts';

type JsonRecord = Record<string, any>;

const encoder = new TextEncoder();

const json = (body: JsonRecord, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates the `X-Hub-Signature-256` header sent by Meta. The signature is
 * the HMAC-SHA256 of the raw body using the app secret.
 */
async function validSignature(rawBody: string, secret: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const signature = header.replace(/^sha256=/i, '').trim();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = toHex(digest);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

const META_STATUSES = ['accepted', 'sent', 'delivered', 'read', 'failed'];

async function registerEvent(
  admin: any,
  eventId: string,
  ownerId: string | null,
  accountId: string,
  eventName: string,
): Promise<boolean> {
  const { error } = await admin.from('whatsapp_webhook_events').insert({
    event_id: eventId,
    id_usuario: ownerId,
    provider: 'meta',
    account_id: accountId,
    event_name: eventName,
  });
  if (error?.code === '23505') return false;
  if (error) throw error;
  return true;
}

const DELIVERY_TABLES = [
  'zernio_whatsapp_deliveries',
  'zernio_whatsapp_manual_deliveries',
  'zernio_whatsapp_scheduled_deliveries',
];

/** Finds the landlord that owns the delivery referenced by the message id. */
async function findDeliveryOwner(admin: any, messageId: string): Promise<string | null> {
  for (const table of DELIVERY_TABLES) {
    const { data } = await admin.from(table).select('id_usuario').eq('message_id', messageId).limit(1);
    const owner = (data ?? [])[0]?.id_usuario;
    if (owner) return owner;
  }
  return null;
}

/** Updates the delivery status reported by Meta. */
async function updateDeliveryStatus(admin: any, messageId: string, status: JsonRecord): Promise<boolean> {
  const name = String(status.status ?? '').toLowerCase();
  if (!META_STATUSES.includes(name)) return false;
  const error = Array.isArray(status.errors) ? status.errors[0] : null;
  const safeError = error
    ? `Meta: ${String(error.title ?? error.message ?? 'falha na entrega').slice(0, 200)}`
    : null;

  let updated = false;
  for (const table of DELIVERY_TABLES) {
    const patch: JsonRecord = { meta_status: name };
    if (name === 'failed' && safeError) {
      patch.status = 'failed';
      patch.safe_error = safeError;
      patch.error_code = 'meta_delivery_failed';
    }
    const { error: updateError } = await admin.from(table).update(patch).eq('message_id', messageId);
    if (!updateError) updated = true;
  }
  return updated;
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verificacao do endpoint de webhook feita pela Meta.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expected = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';
    if (mode === 'subscribe' && expected && token === expected && challenge) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const rawBody = await req.text();
    const appSecret = Deno.env.get('META_APP_SECRET') ?? '';
    if (!appSecret) return json({ error: 'META_APP_SECRET não configurado.' }, 500);
    const signature = req.headers.get('x-hub-signature-256');
    if (!await validSignature(rawBody, appSecret, signature)) {
      return json({ error: 'Assinatura inválida.' }, 401);
    }

    let payload: JsonRecord;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Payload inválido.' }, 400);
    }

    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    let inbound = 0;
    let statuses = 0;

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        if (String(change?.field ?? '') !== 'messages') continue;
        const value = (change?.value ?? {}) as JsonRecord;
        const phoneNumberId = value.metadata?.phone_number_id ?? null;
        if (typeof phoneNumberId !== 'string') continue;

        // Atualizacoes de status de entrega.
        for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
          const messageId = typeof status.id === 'string' ? status.id : null;
          if (!messageId) continue;
          const ownerId = await findDeliveryOwner(admin, messageId);
          const fresh = await registerEvent(
            admin, `status:${messageId}:${String(status.status ?? '')}`, ownerId, phoneNumberId, 'message.status',
          );
          if (!fresh) continue;
          if (await updateDeliveryStatus(admin, messageId, status)) statuses += 1;
        }

        // Mensagens recebidas.
        const messages = Array.isArray(value.messages) ? value.messages : [];
        if (!messages.length) continue;

        // O mesmo numero pode estar conectado em mais de uma conta do SGA,
        // entao todos os donos conectados sao considerados.
        const { data: integrations, error: integrationsError } = await admin.from('zernio_integracoes')
          .select('id_usuario,meta_access_token_ciphertext,meta_status,meta_phone_number_id')
          .eq('meta_phone_number_id', phoneNumberId)
          .limit(10);
        if (integrationsError) throw integrationsError;
        const candidates = (integrations ?? []).filter((item: JsonRecord) =>
          item.id_usuario && item.meta_access_token_ciphertext && item.meta_status !== 'invalid');
        if (!candidates.length) continue;

        for (const message of messages) {
          const messageId = typeof message.id === 'string' ? message.id : null;
          const from = typeof message.from === 'string' ? message.from : '';
          const text = typeof message.text?.body === 'string' ? message.text.body : '';
          if (!messageId || !from || !text.trim()) continue;

          const fresh = await registerEvent(
            admin, messageId, candidates[0].id_usuario, phoneNumberId, 'message.received',
          );
          if (!fresh) continue;

          let replied = false;
          let fallback: string | null = null;
          for (const integration of candidates) {
            const outcome = await handleLockOtp(admin, integration.id_usuario, from, text);
            if (!outcome.handled || !outcome.reply) continue;
            // O dono que tem a porta e o locatario autorizado tem prioridade;
            // as respostas negativas so sao enviadas se ninguem atender.
            if (outcome.kind !== 'otp' && outcome.kind !== 'invalid_code') {
              fallback = fallback ?? outcome.reply;
              continue;
            }
            const token = await decryptSecret(integration.meta_access_token_ciphertext, integration.id_usuario);
            await sendMetaTextMessage(phoneNumberId, token, from, outcome.reply);
            inbound += 1;
            replied = true;
            break;
          }
          if (!replied && fallback) {
            const token = await decryptSecret(candidates[0].meta_access_token_ciphertext, candidates[0].id_usuario);
            await sendMetaTextMessage(phoneNumberId, token, from, fallback);
            inbound += 1;
          }
        }
      }
    }

    return json({ ok: true, inbound, statuses });
  } catch (error) {
    console.error('Meta webhook error:', error);
    return json({ error: 'Falha ao processar o webhook.' }, 500);
  }
});
