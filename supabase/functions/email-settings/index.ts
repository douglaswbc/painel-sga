/**
 * Per-landlord Resend configuration used by the Meta alert notifications.
 *
 * The API key is write-only: it is validated against Resend, encrypted with
 * AES-256-GCM and never returned to the browser. The recipient is always the
 * account e-mail in public.usuarios, so this endpoint cannot be used as a
 * generic e-mail relay.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import { isValidEmail, sendResendEmail, validateResendKey } from '../_shared/resend.ts';
import { META_ALERT_DEFINITIONS, type MetaAlertType } from '../_shared/meta-alerts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type JsonRecord = Record<string, any>;

const PREFERENCE_KEYS = Object.values(META_ALERT_DEFINITIONS)
  .map((definition) => definition.preference);

// O schema desativa apenas `notificar_limite_envio` por padrão. Sem essa
// tabela de defaults, uma conta nova herdaria `true` para todos os tipos.
const PREFERENCE_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  Object.values(META_ALERT_DEFINITIONS).map((definition) => [
    definition.preference,
    definition.type !== 'limite_envio',
  ]),
);

const json = (body: JsonRecord, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function publicConfig(config: JsonRecord | null, recipientEmail: string | null) {
  return {
    enabled: config?.enabled !== false,
    fromEmail: config?.from_email ?? '',
    fromName: config?.from_name ?? '',
    hasKey: Boolean(config?.api_key_ciphertext),
    keyLast4: config?.api_key_last4?.trim() || null,
    keyStatus: config?.key_status ?? null,
    recipientEmail,
    lastTestAt: config?.last_test_at ?? null,
    lastSentAt: config?.last_sent_at ?? null,
    lastError: config?.last_error ?? null,
    preferences: Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, config?.[key] ?? PREFERENCE_DEFAULTS[key] ?? true])),
  };
}

function readPreferences(value: unknown, current: JsonRecord | null): JsonRecord {
  const source = value && typeof value === 'object' ? value as JsonRecord : {};
  const patch: JsonRecord = {};
  for (const key of PREFERENCE_KEYS) {
    if (typeof source[key] === 'boolean') patch[key] = source[key];
    else if (current && typeof current[key] === 'boolean') patch[key] = current[key];
    else patch[key] = PREFERENCE_DEFAULTS[key] ?? true;
  }
  return patch;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Autenticação obrigatória.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Sessão inválida ou expirada.' }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: owner, error: ownerError } = await admin
      .from('usuarios').select('email,role,ativo').eq('id', user.id).maybeSingle();
    if (ownerError || owner?.role !== 'locador' || owner.ativo !== true) {
      return json({ error: 'Esta configuração está disponível para contas ativas de locador.' }, 403);
    }

    const body = await req.json().catch(() => ({} as JsonRecord));
    const action = typeof body?.action === 'string' ? body.action : 'status';

    const { data: current } = await admin.from('email_notificacoes_config')
      .select('*').eq('id_usuario', user.id).maybeSingle();

    if (action === 'status') {
      return json({ success: true, config: publicConfig(current, owner.email ?? null) });
    }

    if (action === 'save') {
      const fromEmail = typeof body?.fromEmail === 'string' ? body.fromEmail.trim().toLowerCase() : '';
      const fromName = typeof body?.fromName === 'string' ? body.fromName.trim().slice(0, 80) : '';
      if (fromEmail && !isValidEmail(fromEmail)) {
        return json({ error: 'Informe um e-mail de remetente válido.' }, 400);
      }
      const enabled = body?.enabled !== false;
      if (enabled && !fromEmail) {
        return json({ error: 'Informe o e-mail remetente verificado no Resend.' }, 400);
      }

      let ciphertext = current?.api_key_ciphertext ?? null;
      let last4 = current?.api_key_last4 ?? null;
      let keyStatus = current?.key_status ?? null;
      const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
      if (apiKey) {
        if (apiKey.length < 16 || apiKey.length > 512) {
          return json({ error: 'Informe uma API Key válida do Resend.' }, 400);
        }
        const validation = await validateResendKey(apiKey);
        if (!validation.valid) {
          return json({ error: validation.error || 'A API Key do Resend não foi aceita.' }, 400);
        }
        ciphertext = await encryptSecret(apiKey, user.id, 'resend');
        last4 = apiKey.slice(-4);
        keyStatus = 'valid';
      }
      if (enabled && !ciphertext) {
        return json({ error: 'Cadastre a API Key do Resend antes de ativar as notificações.' }, 400);
      }

      const preferences = readPreferences(body?.preferences, current);
      const now = new Date().toISOString();
      const { data: saved, error: saveError } = await admin.from('email_notificacoes_config')
        .upsert({
          id_usuario: user.id,
          provider: 'resend',
          api_key_ciphertext: ciphertext,
          api_key_last4: last4,
          key_status: keyStatus,
          from_email: fromEmail || null,
          from_name: fromName || null,
          enabled,
          ...preferences,
          updated_at: now,
        }, { onConflict: 'id_usuario' })
        .select('*')
        .maybeSingle();
      if (saveError || !saved) {
        return json({ error: 'Não foi possível salvar a configuração de e-mail.' }, 500);
      }
      return json({ success: true, config: publicConfig(saved, owner.email ?? null) });
    }

    if (action === 'disable') {
      const { data: saved } = await admin.from('email_notificacoes_config')
        .upsert({ id_usuario: user.id, enabled: false, updated_at: new Date().toISOString() }, { onConflict: 'id_usuario' })
        .select('*')
        .maybeSingle();
      return json({ success: true, config: publicConfig(saved, owner.email ?? null) });
    }

    if (action === 'test') {
      if (!current?.api_key_ciphertext || !current?.from_email) {
        return json({ error: 'Salve a API Key e o remetente do Resend antes de enviar o teste.' }, 409);
      }
      const lastTest = current.last_test_at ? new Date(current.last_test_at).getTime() : 0;
      if (lastTest && Date.now() - lastTest < 60_000) {
        return json({ error: 'Aguarde um minuto antes de enviar outro e-mail de teste.' }, 429);
      }
      let apiKey: string;
      try {
        apiKey = await decryptSecret(current.api_key_ciphertext, user.id);
      } catch {
        return json({ error: 'Não foi possível ler a API Key salva. Cadastre a chave novamente.' }, 409);
      }
      const now = new Date().toISOString();
      try {
        await sendResendEmail({
          apiKey,
          from: current.from_email,
          fromName: current.from_name,
          to: owner.email,
          subject: 'Teste de notificação do Painel SGA',
          html: `<p>Este é um e-mail de teste do Painel SGA.</p><p>Se você recebeu esta mensagem, as notificações da Meta estão configuradas para <strong>${owner.email}</strong>.</p>`,
          text: `Este é um e-mail de teste do Painel SGA.\n\nSe você recebeu esta mensagem, as notificações da Meta estão configuradas para ${owner.email}.`,
          idempotencyKey: `sga-test-${user.id}-${Date.now()}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : 'Falha ao enviar e-mail pelo Resend.';
        await admin.from('email_notificacoes_config').update({
          last_test_at: now,
          last_error: message,
          updated_at: now,
        }).eq('id_usuario', user.id);
        return json({ error: `O Resend recusou o envio: ${message}` }, 400);
      }
      const { data: saved } = await admin.from('email_notificacoes_config').update({
        last_test_at: now,
        last_sent_at: now,
        last_error: null,
        key_status: 'valid',
        updated_at: now,
      }).eq('id_usuario', user.id).select('*').maybeSingle();
      return json({ success: true, config: publicConfig(saved, owner.email ?? null) });
    }

    return json({ error: 'Ação não reconhecida.' }, 400);
  } catch (error) {
    console.error('Email settings error:', error instanceof Error ? error.message : error);
    return json({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 500);
  }
});
