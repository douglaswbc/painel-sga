import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isServiceRequest } from '../_shared/cron-auth.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import { sendMetaTemplateMessage } from '../_shared/meta-messages.ts';
import { normalizeProvider } from '../_shared/whatsapp-provider.ts';

type JsonRecord = Record<string, any>;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZERNIO_API = 'https://zernio.com/api/v1';

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fromBase64(value: string): Uint8Array {
  const bytes = atob(value);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function decryptApiKey(ciphertext: string, ownerId: string): Promise<string> {
  const secret = Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('Configuração de criptografia Zernio indisponível.');
  const [version, encodedIv, encodedCiphertext] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Credencial Zernio criptografada inválida.');
  const keyBytes = Uint8Array.from(secret.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encodedIv), additionalData: encoder.encode(ownerId) },
    key,
    fromBase64(encodedCiphertext),
  );
  return decoder.decode(clear);
}

function localDateTime() {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).reduce((result: JsonRecord, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}:00` };
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
    } else throw new Error('Frequência do agendamento inválida.');
    guard += 1;
    if (guard > 1000) throw new Error('Não foi possível calcular a próxima data do agendamento.');
  } while (next <= today);
  return next;
}

function phoneForWhatsApp(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  throw new Error('O WhatsApp do locatário não tem DDD e um número válido.');
}

async function zernioSend(apiKey: string, body: JsonRecord, idempotencyKey: string) {
  const response = await fetch(`${ZERNIO_API}/inbox/conversations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  let result: JsonRecord = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    const safeMessage = result?.error?.message ?? result?.platformError?.error?.message ?? result?.platformError?.message ?? result?.error;
    const safeCode = result?.code;
    throw new Error([safeCode, typeof safeMessage === 'string' ? safeMessage : `Zernio HTTP ${response.status}`].filter(Boolean).join(': ').slice(0, 350));
  }
  const sent = result.data ?? result;
  if (typeof sent.messageId !== 'string' || !sent.messageId) throw new Error('A Zernio não retornou o identificador da mensagem.');
  return { messageId: sent.messageId, conversationId: typeof sent.conversationId === 'string' ? sent.conversationId : null };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!isServiceRequest(req, serviceRoleKey)) {
    return json({ error: 'Autorização de cron inválida.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { date: today, time: currentTime } = localDateTime();
  const { data: dueSchedules, error: readError } = await admin.from('agendamentos_mensagens')
    .select(`
      id,id_usuario,id_locatario,zernio_template_id,template_params,frequencia,frequencia_dias,
      proximo_envio,horario_envio,
      zernio_whatsapp_templates!agendamentos_meta_template_mesmo_usuario_fkey(id,account_id,name,language,status,components),
      locatarios!agendamentos_locatario_mesmo_usuario_fkey(id,nome_completo,whatsapp)
    `)
    .eq('ativo', true).not('zernio_template_id', 'is', null).lte('proximo_envio', today).order('proximo_envio');
  if (readError) return json({ error: 'Não foi possível carregar os agendamentos Zernio.' }, 500);

  const schedules = (dueSchedules || []).filter((schedule: JsonRecord) =>
    schedule.proximo_envio !== today || String(schedule.horario_envio).slice(0, 8) <= currentTime);
  if (!schedules.length) return json({ processed: 0, message: 'Nenhum agendamento Zernio vencido.' });

  const ownerIds = [...new Set(schedules.map((schedule: JsonRecord) => schedule.id_usuario))];
  const { data: integrations, error: integrationError } = await admin.from('zernio_integracoes')
    .select('id_usuario,provider,api_key_ciphertext,key_status,whatsapp_account_id,meta_access_token_ciphertext,meta_status,meta_phone_number_id,meta_waba_id')
    .in('id_usuario', ownerIds);
  if (integrationError) return json({ error: 'Não foi possível carregar as integrações de WhatsApp.' }, 500);
  const integrationByOwner = new Map((integrations || []).map((item: JsonRecord) => [item.id_usuario, item]));
  const apiKeys = new Map<string, string>();
  const results: JsonRecord[] = [];

  for (const schedule of schedules) {
    const template = schedule.zernio_whatsapp_templates;
    const tenant = schedule.locatarios;
    const integration = integrationByOwner.get(schedule.id_usuario) as JsonRecord | undefined;
    try {
      if (!template || template.status !== 'APPROVED') {
        const message = 'O template Meta não está aprovado. O agendamento foi pausado.';
        await admin.from('agendamentos_mensagens').update({ ativo: false, ultimo_erro: message }).eq('id', schedule.id).eq('id_usuario', schedule.id_usuario);
        results.push({ id: schedule.id, status: 'paused', error: message });
        continue;
      }
      if (!tenant?.whatsapp) throw new Error('O locatário não possui WhatsApp cadastrado.');
      const provider = normalizeProvider(integration?.provider);
      const channelId = provider === 'meta' ? integration?.meta_phone_number_id : integration?.whatsapp_account_id;
      if (provider === 'meta') {
        if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id || integration?.meta_status === 'invalid') {
          throw new Error('A integração da Meta ou o canal associado ao template está indisponível.');
        }
      } else if (!integration?.api_key_ciphertext || integration.key_status !== 'valid') {
        throw new Error('A integração Zernio ou o canal associado ao template está indisponível.');
      }
      if (channelId !== template.account_id) {
        throw new Error('O canal do template não é o canal ativo deste locador.');
      }
      const credential = provider === 'meta'
        ? integration.meta_access_token_ciphertext
        : integration.api_key_ciphertext;
      let apiKey = apiKeys.get(`${provider}:${schedule.id_usuario}`);
      if (!apiKey) {
        apiKey = provider === 'meta'
          ? await decryptSecret(credential, schedule.id_usuario)
          : await decryptApiKey(credential, schedule.id_usuario);
        apiKeys.set(`${provider}:${schedule.id_usuario}`, apiKey);
      }
      const templateParams = Array.isArray(schedule.template_params) ? schedule.template_params : [];
      const scheduledTime = String(schedule.horario_envio).slice(0, 8);
      const idempotencyKey = `sga-schedule-${schedule.id}-${schedule.proximo_envio}-${scheduledTime}`;
      let delivery: JsonRecord | null = null;
      const { data: inserted, error: insertError } = await admin.from('zernio_whatsapp_scheduled_deliveries').insert({
        id_agendamento: schedule.id, id_usuario: schedule.id_usuario,
        scheduled_date: schedule.proximo_envio, scheduled_time: scheduledTime,
        idempotency_key: idempotencyKey, status: 'sending', attempted_at: new Date().toISOString(),
      }).select('id,status').maybeSingle();
      if (!insertError && inserted) delivery = inserted;
      else {
        const { data: existing, error: existingError } = await admin.from('zernio_whatsapp_scheduled_deliveries')
          .select('id,status,attempted_at').eq('id_agendamento', schedule.id)
          .eq('scheduled_date', schedule.proximo_envio).eq('scheduled_time', scheduledTime).maybeSingle();
        if (existingError || !existing) throw new Error('Não foi possível consultar a tentativa de envio recorrente.');
        if (existing.status === 'sent') {
          await admin.from('agendamentos_mensagens').update({
            proximo_envio: nextOccurrence(schedule, today), ultimo_erro: null, ultima_execucao: new Date().toISOString(),
          }).eq('id', schedule.id).eq('id_usuario', schedule.id_usuario);
          results.push({ id: schedule.id, status: 'already_sent' });
          continue;
        }
        const attemptedAt = new Date(existing.attempted_at).getTime();
        if (existing.status === 'sending' && attemptedAt > Date.now() - 120000) {
          results.push({ id: schedule.id, status: 'in_progress' });
          continue;
        }
        if (existing.status === 'failed' && attemptedAt > Date.now() - 300000) {
          results.push({ id: schedule.id, status: 'retry_wait' });
          continue;
        }
        const claim = await admin.from('zernio_whatsapp_scheduled_deliveries').update({
          status: 'sending', safe_error: null, error_code: null, attempted_at: new Date().toISOString(),
        }).eq('id', existing.id).eq('status', existing.status).select('id,status').maybeSingle();
        if (claim.error || !claim.data) {
          results.push({ id: schedule.id, status: 'in_progress' });
          continue;
        }
        delivery = claim.data;
      }

      let sent: { messageId: string; conversationId: string | null };
      if (provider === 'meta') {
        const result = await sendMetaTemplateMessage({
          phoneNumberId: template.account_id,
          token: apiKey,
          to: phoneForWhatsApp(tenant.whatsapp),
          templateName: template.name,
          templateLanguage: template.language,
          templateParams,
          components: template.components || [],
        });
        sent = { messageId: result.messageId, conversationId: null };
      } else {
        const sendBody: JsonRecord = {
          accountId: template.account_id,
          participantId: phoneForWhatsApp(tenant.whatsapp),
          templateName: template.name,
          templateLanguage: template.language,
          ...(templateParams.length ? { templateParams } : {}),
        };
        sent = await zernioSend(apiKey, sendBody, idempotencyKey);
      }
      const sentAt = new Date().toISOString();
      const { error: completeError } = await admin.from('zernio_whatsapp_scheduled_deliveries').update({
        status: 'sent', message_id: sent.messageId, conversation_id: sent.conversationId,
        safe_error: null, error_code: null, sent_at: sentAt,
      }).eq('id', delivery.id).eq('status', 'sending');
      if (completeError) throw new Error('A mensagem foi enviada, mas a auditoria do envio não foi concluída.');
      const nextDate = nextOccurrence(schedule, today);
      const { error: scheduleUpdateError } = await admin.from('agendamentos_mensagens').update({
        proximo_envio: nextDate, ultimo_erro: null, ultima_execucao: sentAt,
      }).eq('id', schedule.id).eq('id_usuario', schedule.id_usuario);
      if (scheduleUpdateError) throw new Error('A mensagem foi enviada, mas a próxima data não foi atualizada.');
      results.push({ id: schedule.id, status: 'sent', messageId: sent.messageId, nextDate });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 350);
      const scheduledTime = String(schedule.horario_envio).slice(0, 8);
      const { data: delivery } = await admin.from('zernio_whatsapp_scheduled_deliveries')
        .select('id').eq('id_agendamento', schedule.id).eq('scheduled_date', schedule.proximo_envio)
        .eq('scheduled_time', scheduledTime).maybeSingle();
      if (delivery?.id) {
        await admin.from('zernio_whatsapp_scheduled_deliveries').update({
          status: 'failed', safe_error: message, error_code: 'scheduled_send_failed', attempted_at: new Date().toISOString(),
        }).eq('id', delivery.id).eq('status', 'sending');
      }
      await admin.from('agendamentos_mensagens').update({ ultimo_erro: message })
        .eq('id', schedule.id).eq('id_usuario', schedule.id_usuario);
      results.push({ id: schedule.id, status: 'failed', error: message });
    }
  }

  return json({ processed: results.length, results });
});
