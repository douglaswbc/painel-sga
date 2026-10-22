import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptSecret } from '../_shared/crypto.ts';
import { sendMetaTemplateMessage } from '../_shared/meta-messages.ts';
import {
  MetaApiError,
  createMessageTemplate,
  deleteMessageTemplate,
  describeMetaError,
  editMessageTemplate,
  getPhoneNumberDetails,
  listMessageTemplates,
  metaErrorDetail,
} from '../_shared/meta-graph.ts';
import { normalizeProvider, metaWebhookUrl, type WhatsappProvider } from '../_shared/whatsapp-provider.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ZERNIO_API = 'https://zernio.com/api/v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
type JsonRecord = Record<string, any>;

class PublicError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
class ZernioError extends Error {
  status: number;
  code: string | null;
  param: string | null;
  providerMessage: string | null;
  requestId: string | null;
  constructor(status: number, code: string | null = null, param: string | null = null, providerMessage: string | null = null, requestId: string | null = null) {
    super('Zernio request failed');
    this.status = status;
    this.code = code;
    this.param = param;
    this.providerMessage = providerMessage;
    this.requestId = requestId;
  }
}

function safeProviderMessage(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim()
    .replace(/Bearer\s+\S+/gi, 'Bearer [ocultado]')
    .replace(/\b(?:zrk|sk)_[A-Za-z0-9_-]{8,}/gi, '[chave ocultada]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 400);
}

function fromBase64(value: string): Uint8Array {
  const bytes = atob(value);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function decryptApiKey(ciphertext: string, ownerId: string): Promise<string> {
  const secret = Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('Missing encryption configuration');
  const [version, encodedIv, encodedCiphertext] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Invalid encrypted credential');
  const keyBytes = Uint8Array.from(secret.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encodedIv), additionalData: encoder.encode(ownerId) },
    key,
    fromBase64(encodedCiphertext),
  );
  return decoder.decode(clear);
}

async function zernioRequest(
  path: string,
  apiKey: string,
  options: { method?: string; body?: JsonRecord; idempotencyKey?: string } = {},
): Promise<JsonRecord> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new PublicError('Não foi possível conectar à Zernio agora. Tente novamente.', 503);
  }
  let payload: JsonRecord = {};
  try { payload = await response.json(); } catch { /* some successful responses have no body */ }
  if (!response.ok) {
    const rawCode = payload?.code ?? payload?.error?.code;
    const code = typeof rawCode === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : null;
    const rawParam = payload?.param;
    const param = typeof rawParam === 'string' && /^[A-Za-z0-9_.[\]-]{1,100}$/.test(rawParam) ? rawParam : null;
    const platformError = payload?.platformError;
    const providerMessage = safeProviderMessage(
      platformError?.error_user_msg
      ?? platformError?.error_user_title
      ?? platformError?.error?.message
      ?? platformError?.error?.error_user_msg
      ?? platformError?.details?.[0]?.message
      ?? payload?.details?.errors?.[0]?.message
      ?? platformError?.message
      ?? payload?.error,
    );
    const rawRequestId = response.headers.get('x-request-id');
    const requestId = rawRequestId && /^[A-Za-z0-9_-]{1,100}$/.test(rawRequestId) ? rawRequestId : null;
    throw new ZernioError(response.status, code, param, providerMessage, requestId);
  }
  return payload;
}

function listAt(payload: JsonRecord, key: string): JsonRecord[] {
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  return [];
}

type Channel = {
  provider: WhatsappProvider;
  accountId: string;
  wabaId: string | null;
  token: string;
  label: string;
  phoneNumber: string | null;
};

const TEMPLATE_STATUSES = new Set([
  'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL',
  'PENDING_DELETION', 'PENDING_DEPRECATION', 'LIMIT_EXCEEDED', 'DEPRECATED',
  'ARCHIVED', 'DELETED', 'EXPIRED',
]);

function publicChannel(channel: Channel) {
  return {
    provider: channel.provider,
    providerLabel: channel.provider === 'meta' ? 'Meta Cloud API' : 'Zernio',
    accountId: channel.accountId,
    phoneNumber: channel.phoneNumber,
    label: channel.label,
  };
}

function mapTemplate(template: JsonRecord, channel: Channel, ownerId: string, existing?: JsonRecord) {
  const remoteId = template.id ?? template._id;
  if (typeof remoteId !== 'string' || !template.name || !template.language) return null;
  const status = String(template.status ?? 'PENDING').toUpperCase();
  return {
    ...(existing?.id ? { id: existing.id } : {}),
    id_usuario: ownerId,
    provider: channel.provider,
    account_id: channel.accountId,
    meta_template_id: remoteId,
    name: String(template.name),
    language: String(template.language),
    category: ['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(String(template.category).toUpperCase())
      ? String(template.category).toUpperCase() : 'UTILITY',
    status: TEMPLATE_STATUSES.has(status) ? status : 'PENDING',
    rejection_reason: template.reason ?? template.rejected_reason ?? template.rejectionReason ?? template.rejection_reason ?? null,
    components: Array.isArray(template.components) ? template.components : [],
    variable_mapping: existing?.variable_mapping ?? [],
    purpose: existing?.purpose ?? 'general',
    is_default: existing?.is_default ?? false,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function listRemoteTemplates(channel: Channel): Promise<JsonRecord[]> {
  if (channel.provider === 'meta') {
    const templates = await listMessageTemplates(channel.wabaId as string, channel.token);
    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      components: template.components,
      rejected_reason: template.rejectionReason,
    }));
  }
  const query = new URLSearchParams({ accountId: channel.accountId });
  const payload = await zernioRequest(`/whatsapp/templates?${query.toString()}`, channel.token);
  return listAt(payload, 'templates');
}

async function syncTemplates(admin: any, channel: Channel, ownerId: string) {
  const remoteTemplates = await listRemoteTemplates(channel);
  const { data: existingRows, error: readError } = await admin.from('zernio_whatsapp_templates')
    .select('*').eq('id_usuario', ownerId).eq('provider', channel.provider).eq('account_id', channel.accountId);
  if (readError) throw new Error('Não foi possível ler os templates salvos.');
  const rows = remoteTemplates.map((template) => {
    const existing = existingRows?.find((row: JsonRecord) => row.name === template.name && row.language === template.language);
    return mapTemplate(template, channel, ownerId, existing);
  }).filter(Boolean);
  if (rows.length) {
    const { error } = await admin.from('zernio_whatsapp_templates')
      .upsert(rows, { onConflict: 'id_usuario,provider,account_id,name,language' });
    if (error) {
      // Uma linha invalida nao pode derrubar a listagem inteira: tenta uma a
      // uma e descarta apenas o registro que falhou.
      console.error('Template sync upsert failed, retrying row by row:', error.message, error.code);
      for (const row of rows) {
        const { error: rowError } = await admin.from('zernio_whatsapp_templates')
          .upsert([row], { onConflict: 'id_usuario,provider,account_id,name,language' });
        if (rowError) {
          console.error('Skipping template that could not be saved:', row.name, rowError.message, rowError.code);
        }
      }
    }
  }
  // Templates apagados na Meta deixam de existir no catalogo remoto. Marca as
  // linhas locais ausentes como DELETED e remove os usos, para que a sequencia
  // de lembretes nao tente enviar um template inexistente. A limpeza vale so
  // para a Meta, cuja listagem segue paginacao completa.
  if (channel.provider === 'meta' && remoteTemplates.length) {
    const remoteKeys = new Set(remoteTemplates.map((template) => `${template.name}\u0000${template.language}`));
    const stale = (existingRows ?? []).filter((row: JsonRecord) =>
      !remoteKeys.has(`${row.name}\u0000${row.language}`) && String(row.status ?? '').toUpperCase() !== 'DELETED');
    if (stale.length) {
      const staleIds = stale.map((row: JsonRecord) => row.id);
      const { error: usageCleanupError } = await admin.from('zernio_whatsapp_template_usages')
        .delete().in('template_id', staleIds).eq('id_usuario', ownerId);
      if (usageCleanupError) console.error('Could not remove usages of stale templates:', usageCleanupError.message);
      const { error: staleError } = await admin.from('zernio_whatsapp_templates')
        .update({ status: 'DELETED', updated_at: new Date().toISOString() }).in('id', staleIds).eq('id_usuario', ownerId);
      if (staleError) console.error('Could not mark stale templates as deleted:', staleError.message);
      else console.log(`Marked ${stale.length} template(s) as deleted: ${stale.map((row: JsonRecord) => row.name).join(', ')}`);
    }
  }
  const { data, error } = await admin.from('zernio_whatsapp_templates')
    .select('id,meta_template_id,name,language,category,status,rejection_reason,components,variable_mapping,purpose,is_default,last_synced_at,provider')
    .eq('id_usuario', ownerId).eq('provider', channel.provider).eq('account_id', channel.accountId).order('name').order('language');
  if (error) throw new Error('Não foi possível carregar os templates do SGA.');
  const { data: usages, error: usageError } = await admin.from('zernio_whatsapp_template_usages')
    .select('template_id,purpose,variable_mapping,is_default,reminder_order')
    .eq('id_usuario', ownerId).eq('provider', channel.provider).eq('account_id', channel.accountId);
  if (usageError) throw new Error('Não foi possível carregar os usos dos templates. Aplique as migrations 013 e 015.');
  return (data ?? []).map((template: JsonRecord) => ({
    ...template,
    usages: (usages ?? []).filter((usage: JsonRecord) => usage.template_id === template.id),
  }));
}

/**
 * Resolves the channel of the active provider for the authenticated landlord.
 * The landlord id always comes from the session, never from the request body.
 */
async function resolveChannel(integration: JsonRecord | null, ownerId: string): Promise<Channel> {
  const provider = normalizeProvider(integration?.provider);

  if (provider === 'meta') {
    if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id || !integration?.meta_waba_id) {
      throw new PublicError('Conecte um número da Meta nas Configurações antes de continuar.', 409);
    }
    if (integration.meta_status === 'invalid') {
      throw new PublicError('O token da Meta não foi aceito. Gere um novo token nas Configurações.', 409);
    }
    const token = await decryptSecret(integration.meta_access_token_ciphertext, ownerId);
    return {
      provider,
      accountId: integration.meta_phone_number_id,
      wabaId: integration.meta_waba_id,
      token,
      label: integration.meta_display_phone_number || integration.meta_verified_name || 'WhatsApp da Meta',
      phoneNumber: integration.meta_display_phone_number ?? null,
    };
  }

  if (!integration?.api_key_ciphertext || integration?.key_status !== 'valid') {
    throw new PublicError('Valide uma chave Zernio nas Configurações antes de continuar.', 409);
  }
  if (!integration.whatsapp_account_id || !integration.zernio_profile_id) {
    throw new PublicError('Conecte um canal WhatsApp da Zernio nas Configurações antes de continuar.', 409);
  }
  const accountId = integration.whatsapp_account_id as string;
  if (!/^[a-fA-F0-9]{24}$/.test(accountId)) {
    throw new PublicError('Atualize a conexão do canal WhatsApp nas Configurações.', 409);
  }
  const apiKey = await decryptSecret(integration.api_key_ciphertext, ownerId);
  const accountQuery = new URLSearchParams({ profileId: integration.zernio_profile_id });
  const accountsPayload = await zernioRequest(`/accounts?${accountQuery.toString()}`, apiKey);
  const remoteAccount = listAt(accountsPayload, 'accounts').find((item) => {
    if ((item._id ?? item.id) !== accountId || item.platform !== 'whatsapp' || item.isActive === false) return false;
    const profileId = typeof item.profileId === 'object' ? item.profileId?._id ?? item.profileId?.id : item.profileId;
    return !profileId || profileId === integration.zernio_profile_id;
  });
  if (!remoteAccount) {
    throw new PublicError('O canal não está ativo no perfil Zernio selecionado. Reconecte-o nas Configurações.', 409);
  }
  return {
    provider,
    accountId,
    wabaId: null,
    token: apiKey,
    label: [integration.zernio_profile_name, integration.whatsapp_account_name].filter(Boolean).join(' · ') || 'Canal Zernio',
    phoneNumber: integration.whatsapp_phone_number ?? null,
  };
}

function safeZernioError(error: ZernioError): PublicError {
  if (error.status === 401 || error.status === 403) return new PublicError('A chave Zernio não autorizou esta operação. Valide a chave nas Configurações.', 400);
  if (error.status === 402) return new PublicError('A conta Zernio precisa resolver uma pendência antes de continuar.', 402);
  if (error.status === 404) return new PublicError('A conta ou o template WhatsApp não foi encontrado na Zernio.', 404);
  if (error.status === 409) return new PublicError('A Meta encontrou um conflito para este template. Atualize a lista e confira nome e idioma.', 409);
  if (error.status === 429) return new PublicError('A Zernio limitou temporariamente as consultas. Aguarde e tente novamente.', 429);
  if (error.status >= 500) return new PublicError('A Zernio ou a Meta está temporariamente indisponível. Tente novamente.', 503);
  const details = [error.code && `código ${error.code}`, error.param && `campo ${error.param}`, error.providerMessage]
    .filter(Boolean).join(' · ');
  const requestRef = error.requestId ? ` Referência: ${error.requestId}.` : '';
  return new PublicError(
    details
      ? `A Zernio/Meta recusou a solicitacao: ${details}.${requestRef}`
      : `A Zernio ou a Meta recusou a operação (HTTP ${error.status}). Confira o conteúdo do template.${requestRef}`,
    error.status === 422 ? 400 : error.status,
  );
}

function phoneForWhatsApp(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  throw new PublicError('O WhatsApp do locatário precisa ter DDD e um número válido.', 400);
}

function dueDatePtBr(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new PublicError('A data de vencimento da cobrança está inválida.', 400);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function templateParameterCount(components: JsonRecord[] = []): number {
  const ordered = [
    ...components.filter((item) => String(item.type).toUpperCase() === 'HEADER'),
    ...components.filter((item) => String(item.type).toUpperCase() === 'BODY'),
    ...components.filter((item) => String(item.type).toUpperCase() === 'BUTTONS'),
  ];
  let count = 0;
  for (const component of ordered) {
    const texts = String(component.type).toUpperCase() === 'BUTTONS'
      ? (Array.isArray(component.buttons) ? component.buttons : []).map((button: JsonRecord) => button.url)
      : [component.text];
    for (const text of texts) {
      const variables = [...new Set([...String(text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
      if (variables.some((value, index) => value !== index + 1)) throw new PublicError('As variáveis do template precisam ser sequenciais em cada componente.', 409);
      count += variables.length;
    }
  }
  return count;
}

/**
 * The Meta template review rejects two shapes before the template is even
 * stored: variables at the beginning or the end of the body (2388299) and a
 * body with too few words for the number of variables (2388293).
 */
function assertMetaBodyRules(bodyText: string): void {
  const text = String(bodyText ?? '');
  const variableCount = [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].length;
  if (!variableCount) return;
  if (/^\s*\{\{\d+\}\}/.test(text) || /\{\{\d+\}\}\s*[.,;:!?…]*\s*$/.test(text)) {
    throw new PublicError('A Meta não aceita variáveis no início ou no fim do corpo da mensagem. Reescreva o texto.', 400);
  }
  const tokens = text.trim().split(/\s+/).filter(Boolean).length;
  const minimum = variableCount * 3 + 1;
  if (tokens < minimum) {
    throw new PublicError(
      `A Meta exige um corpo mais longo: ${variableCount} variável${variableCount > 1 ? 'e' : ''} precisa de ao menos ${minimum} palavras.`,
      400,
    );
  }
}

function billingTemplateParams(template: JsonRecord, mapping: JsonRecord[], tenantName: string, amount: number, dueDate: string, paymentLink: string, payToken: string): string[] {
  const values: Record<string, string> = {
    tenant_first_name: tenantName.trim().split(/\s+/)[0],
    amount: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount),
    due_date: dueDatePtBr(dueDate),
    payment_link: paymentLink,
    payment_token: payToken,
  };
  const orderedMapping = [...mapping].sort((a: JsonRecord, b: JsonRecord) => a.position - b.position);
  const expectedCount = templateParameterCount(Array.isArray(template.components) ? template.components : []);
  if (orderedMapping.length !== expectedCount || orderedMapping.some((item: JsonRecord, index: number) =>
    item.position !== index + 1 || !Object.hasOwn(values, item.field))) {
    throw new PublicError('O mapeamento das variáveis deste template de cobrança está incompleto. Configure novamente na aba Templates Meta.', 409);
  }
  return orderedMapping.map((item: JsonRecord) => {
    const value = values[item.field];
    if (item.field === 'payment_token' && !String(value ?? '').trim()) {
      throw new PublicError('Não foi possível montar o botão de pagamento: esta cobrança está sem o código público do link. Atualize a página e tente novamente.', 409);
    }
    return value;
  });
}

async function generatePaymentLink(admin: any, ownerId: string, charge: JsonRecord, tenant: JsonRecord): Promise<string> {
  const { data: token, error: tokenError } = await admin.rpc('get_user_mp_token', { p_user_id: ownerId });
  if (tokenError || typeof token !== 'string' || !token) throw new PublicError('Cadastre um Access Token válido do Mercado Pago antes de gerar o link PIX.', 409);
  const document = String(tenant.cpf ?? '').replace(/\D/g, '');
  const names = String(tenant.nome_completo ?? '').trim().split(/\s+/);
  const payer: JsonRecord = {
    email: tenant.email || 'financeiro@sga.com',
    first_name: names[0] || 'Locatário',
    last_name: names.slice(1).join(' ') || names[0],
  };
  if (document.length === 11 || document.length === 14) {
    payer.identification = { type: document.length === 14 ? 'CNPJ' : 'CPF', number: document };
  }
  const pixExpiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
  let response: Response;
  try {
    response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `sga-charge-${charge.id}`,
      },
      body: JSON.stringify({
        transaction_amount: Number(charge.valor),
        description: `Aluguel - ${tenant.nome_completo}`,
        payment_method_id: 'pix',
        date_of_expiration: pixExpiresAt.toISOString(),
        notification_url: Deno.env.get('MP_WEBHOOK_URL') || undefined,
        payer,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new PublicError('Não foi possível conectar ao Mercado Pago para gerar o PIX.', 503);
  }
  let result: JsonRecord = {};
  try { result = await response.json(); } catch { /* handled below */ }
  const paymentLink = result?.point_of_interaction?.transaction_data?.ticket_url;
  if (!response.ok || typeof paymentLink !== 'string' || !paymentLink) {
    throw new PublicError('O Mercado Pago não conseguiu gerar o link PIX. Confira a conta e os dados do locatário.', 502);
  }
  const { error } = await admin.from('cobrancas').update({
    mercado_pago_id: String(result.id), payment_link: paymentLink,
    pix_expires_at: pixExpiresAt.toISOString(), pix_expired_at: null,
  }).eq('id', charge.id).eq('id_usuario', ownerId);
  if (error) throw new Error('O link PIX foi criado, mas não foi possível salvá-lo na cobrança.');
  return paymentLink;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: JsonRecord, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  let admin: any = null;
  let claimedDeliveryId: string | null = null;
  let claimedManualDeliveryId: string | null = null;
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const body = await req.json();
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const serviceCall = Boolean(serviceRoleKey) && authHeader === `Bearer ${serviceRoleKey}`;
    let user: { id: string } | null = null;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    if (serviceCall) {
      const serviceActions = new Set(['send_charge', 'update_template_button']);
      if (!serviceActions.has(String(body?.action)) || !/^[0-9a-f-]{36}$/i.test(String(body?.ownerId || ''))) {
        return json({ error: 'Service credentials may only run automated maintenance actions for a specified owner.' }, 403);
      }
      user = { id: body.ownerId };
    } else {
      const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user: authenticatedUser }, error: authError } = await caller.auth.getUser();
      if (authError || !authenticatedUser) return json({ error: 'Invalid or expired session.' }, 401);
      user = { id: authenticatedUser.id };
    }
    admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });    const { data: owner, error: ownerError } = await admin.from('usuarios')
      .select('role,ativo').eq('id', user.id).maybeSingle();
    if (ownerError || owner?.role !== 'locador' || owner.ativo !== true) {
      return json({ error: 'A operação está disponível para contas ativas de locador.' }, 403);
    }
    const action = body?.action;
    if (action === 'health') {
      const { data: integration, error: integrationError } = await admin.from('zernio_integracoes')
        .select('*')
        .eq('id_usuario', user.id).maybeSingle();
      if (integrationError) {
        return json({ health: 'attention', message: 'Nao foi possivel carregar a integracao de WhatsApp.' });
      }
      const provider = normalizeProvider(integration?.provider);
      if (provider === 'meta') {
        if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id) {
          return json({ health: 'attention', message: 'Conecte um numero da Meta em Configuracoes.' });
        }
        if (integration.meta_status === 'invalid') {
          return json({ health: 'attention', message: 'O token da Meta nao foi aceito. Gere um novo token em Configuracoes.' });
        }
        try {
          const details = await getPhoneNumberDetails(integration.meta_phone_number_id, await decryptSecret(integration.meta_access_token_ciphertext, user.id));
          const connected = integration.meta_status === 'connected';
          return json({
            health: connected ? 'connected' : 'attention',
            message: connected
              ? `Canal WhatsApp conectado na Meta${details.displayPhoneNumber ? ` (${details.displayPhoneNumber})` : ''}.`
              : 'O numero da Meta ainda nao foi registrado para uso pela API.',
            callbackUrl: metaWebhookUrl(),
            provider: 'meta',
          });
        } catch (error) {
          const message = error instanceof MetaApiError ? describeMetaError(error) : 'Nao foi possivel consultar o canal da Meta agora.';
          return json({ health: 'unavailable', message });
        }
      }
      if (!integration?.api_key_ciphertext || integration.key_status !== 'valid'
        || !integration.whatsapp_account_id || !integration.zernio_profile_id) {
        return json({ health: 'attention', message: 'Configure e valide a integracao Zernio em Configuracoes.' });
      }
      try {
        const apiKey = await decryptApiKey(integration.api_key_ciphertext, user.id);
        const query = new URLSearchParams({ profileId: integration.zernio_profile_id });
        const payload = await zernioRequest(`/accounts?${query.toString()}`, apiKey);
        const connected = listAt(payload, 'accounts').some((item) => {
          if ((item._id ?? item.id) !== integration.whatsapp_account_id || item.platform !== 'whatsapp' || item.isActive === false) return false;
          const profileId = typeof item.profileId === 'object' ? item.profileId?._id ?? item.profileId?.id : item.profileId;
          return !profileId || profileId === integration.zernio_profile_id;
        });
        return json({ health: connected ? 'connected' : 'attention', message: connected ? 'Canal WhatsApp conectado e ativo na Zernio.' : 'O canal nao esta ativo no perfil Zernio configurado.', callbackUrl: metaWebhookUrl(), provider: 'zernio' });
      } catch (error) {
        const message = error instanceof ZernioError ? safeZernioError(error).message : 'Nao foi possivel consultar o canal Zernio agora.';
        return json({ health: 'unavailable', message });
      }
    }
    if (action === 'activity') {
      const page = Math.max(1, Math.min(1000, Number.parseInt(String(body.page || '1'), 10) || 1));
      const requestedPageSize = Number.parseInt(String(body.pageSize || ''), 10);
      const pageSize = body.pageSize == null ? 100 : Math.max(1, Math.min(50, requestedPageSize || 25));
      const offset = (page - 1) * pageSize;
      const hasDateFilter = typeof body.start === 'string' || typeof body.end === 'string';
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      if (hasDateFilter) {
        startDate = new Date(typeof body.start === 'string' ? body.start : '');
        endDate = new Date(typeof body.end === 'string' ? body.end : '');
        const rangeDays = (endDate.getTime() - startDate.getTime()) / 86400000;
        if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())
          || !Number.isFinite(rangeDays) || rangeDays < 0 || rangeDays > 366) {
          return json({ error: 'Selecione um periodo valido de ate 12 meses.' }, 400);
        }
      }
      const search = typeof body.search === 'string' ? body.search.trim().slice(0, 100) : '';
      let query = admin.from('zernio_whatsapp_activity_log')
        .select('type,source_id,status,template_name,template_language,category,recipient_name,recipient_phone,occurred_at,message_id,error,meta_status', { count: 'exact' })
        .eq('id_usuario', user.id)
        .order('occurred_at', { ascending: false });
      if (startDate && endDate) query = query.gte('occurred_at', startDate.toISOString()).lte('occurred_at', endDate.toISOString());
      if (search.length >= 3) query = query.ilike('recipient_name', `%${search}%`);
      const { data, count, error } = await query.range(offset, offset + pageSize - 1);
      if (error) throw new PublicError('Nao foi possivel carregar o historico de operacao. Aplique a migration 018.', 500);
      const activity = (data || []).map((row: JsonRecord) => ({
        id: `${row.type}-${row.source_id}`,
        type: row.type,
        label: row.template_name || ({ charge: 'Template de cobranca', scheduled: 'Template agendado', payment: 'Confirmacao de pagamento', manual: 'Template manual' }[row.type] || 'Template WhatsApp'),
        templateLanguage: row.template_language,
        category: row.category,
        recipientName: row.recipient_name || 'Destinatario nao identificado',
        recipientPhone: row.recipient_phone,
        status: row.status,
        occurredAt: row.occurred_at,
        messageId: row.message_id,
        error: row.error,
        metaStatus: row.meta_status ?? null,
      }));
      return json({ activity, page, pageSize, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)) });
    }
    if (action === 'pricing_analytics') {
      const startDate = new Date(typeof body.start === 'string' ? body.start : '');
      const endDate = new Date(typeof body.end === 'string' ? body.end : '');
      const rangeDays = (endDate.getTime() - startDate.getTime()) / 86400000;
      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())
        || !Number.isFinite(rangeDays) || rangeDays < 0 || rangeDays > 366) {
        return json({ error: 'Selecione um periodo valido de ate 12 meses.' }, 400);
      }
      const { data, error } = await admin.from('zernio_whatsapp_activity_log')
        .select('category,recipient_phone')
        .eq('id_usuario', user.id).eq('status', 'sent')
        .gte('occurred_at', startDate.toISOString()).lte('occurred_at', endDate.toISOString());
      if (error) throw new PublicError('Nao foi possivel calcular a estimativa local de uso. Aplique a migration 018.', 500);
      const rates: Record<string, number> = { MARKETING: 0.3217, UTILITY: 0.035, AUTHENTICATION: 0.035 };
      const grouped = new Map<string, JsonRecord>();
      for (const row of data || []) {
        const digits = String(row.recipient_phone || '').replace(/\D/g, '');
        const country = digits.startsWith('55') || digits.length === 10 || digits.length === 11 ? 'BR' : 'UNKNOWN';
        const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(String(row.category).toUpperCase())
          ? String(row.category).toUpperCase() : 'UNKNOWN';
        const key = `${category}:${country}`;
        const current = grouped.get(key) || { category, country, volume: 0, cost: 0, currency: country === 'BR' ? 'BRL' : null };
        current.volume += 1;
        if (country === 'BR' && rates[category]) current.cost += rates[category];
        grouped.set(key, current);
      }
      return json({ analytics: [...grouped.values()], approximate: true, costAvailable: true, source: 'local_delivery_logs',
        message: 'Estimativa baseada nos envios aceitos registrados no SGA, categorias dos templates e tarifas Meta do Brasil vigentes desde 01/10/2026. A fatura do parceiro pode variar.' });
    }
    const { data: integration, error: integrationError } = await admin.from('zernio_integracoes')
      .select('*').eq('id_usuario', user.id).maybeSingle();
    if (integrationError) return json({ error: 'Não foi possível carregar a integração de WhatsApp.' }, 500);

    let channel: Channel;
    try {
      channel = await resolveChannel(integration, user.id);
    } catch (error) {
      if (error instanceof PublicError) return json({ error: error.message }, error.status);
      return json({ error: 'Não foi possível resolver o canal de WhatsApp. Revise as Configurações.' }, 400);
    }
    const accountId = channel.accountId;
    const apiKey = channel.token;

    if (action === 'list') {
      return json({ templates: await syncTemplates(admin, channel, user.id), channel: publicChannel(channel) });
    }

    if (action === 'send_payment_confirmation') {
      const chargeId = typeof body.chargeId === 'string' ? body.chargeId : '';
      if (!/^[0-9a-f-]{36}$/i.test(chargeId)) return json({ error: 'Identificador da cobrança inválido.' }, 400);
      const { data: charge, error: chargeError } = await admin.from('cobrancas')
        .select('id,id_usuario,id_locatario,valor,data_vencimento,data_pagamento,status,tipo')
        .eq('id', chargeId).eq('id_usuario', user.id).maybeSingle();
      if (chargeError || !charge) return json({ error: 'Cobrança não encontrada para este locador.' }, 404);
      if (!charge.id_locatario) return json({ error: 'Esta cobrança não tem locatário vinculado.' }, 409);
      const { data: tenant, error: tenantError } = await admin.from('locatarios')
        .select('id,nome_completo,whatsapp').eq('id', charge.id_locatario).eq('id_usuario', user.id).maybeSingle();
      if (tenantError || !tenant || !tenant.whatsapp) return json({ error: 'O locatário não possui WhatsApp válido cadastrado.' }, 409);

      // Usa o template de confirmacao de pagamento configurado no canal ativo.
      const { data: usage, error: usageError } = await admin.from('zernio_whatsapp_template_usages')
        .select('template_id,variable_mapping')
        .eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId)
        .eq('purpose', 'payment_confirmation').eq('is_default', true).maybeSingle();
      if (usageError) throw new Error('Não foi possível consultar o template de confirmação de pagamento.');
      if (!usage) {
        return json({
          error: 'Nenhum template de confirmação de pagamento está configurado para este canal.',
          needsTemplate: true,
          channel: publicChannel(channel),
        }, 409);
      }
      const { data: template, error: templateError } = await admin.from('zernio_whatsapp_templates')
        .select('id,meta_template_id,name,language,status,components,account_id')
        .eq('id', usage.template_id).eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId)
        .maybeSingle();
      if (templateError || !template) return json({ error: 'O template de confirmação de pagamento não foi encontrado neste canal.' }, 404);
      if (template.status !== 'APPROVED') return json({ error: 'O template de confirmação de pagamento não está aprovado pela Meta.' }, 409);

      const paidAt = charge.data_pagamento || new Date().toISOString();
      const values: Record<string, string> = {
        tenant_first_name: String(tenant.nome_completo ?? '').trim().split(/\s+/)[0] || 'Olá',
        amount: Number(charge.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        paid_at: new Date(paidAt).toLocaleDateString('pt-BR'),
      };
      const mapping = [...(usage.variable_mapping || [])].sort((a: JsonRecord, b: JsonRecord) => a.position - b.position);
      const expectedCount = templateParameterCount(Array.isArray(template.components) ? template.components : []);
      if (!mapping.length || mapping.length !== expectedCount || mapping.some((item: JsonRecord, index: number) =>
        item.position !== index + 1 || !Object.hasOwn(values, item.field) || !values[item.field])) {
        return json({ error: 'O mapeamento das variáveis do template de confirmação está incompleto. Reconfigure em Templates Meta.' }, 409);
      }
      const params = mapping.map((item: JsonRecord) => values[item.field]);

      const idempotencyKey = `sga-payment-confirm-${charge.id}`;
      const { data: delivery, error: deliveryError } = await admin.from('zernio_whatsapp_manual_deliveries').insert({
        id_usuario: user.id, id_locatario: tenant.id, template_id: template.id, account_id: accountId,
        provider: channel.provider,
        idempotency_key: idempotencyKey, template_name: template.name, template_language: template.language,
        status: 'sending',
      }).select('id').single();
      if (deliveryError) {
        if (deliveryError.code === '23505') {
          const { data: previous } = await admin.from('zernio_whatsapp_manual_deliveries')
            .select('status,message_id').eq('idempotency_key', idempotencyKey).maybeSingle();
          if (previous?.status === 'sent') {
            return json({ success: true, alreadySent: true, messageId: previous.message_id, channel: publicChannel(channel) });
          }
        }
        throw new Error('Não foi possível registrar a tentativa de envio.');
      }

      let messageId: string;
      try {
        if (channel.provider === 'meta') {
          const sent = await sendMetaTemplateMessage({
            phoneNumberId: channel.accountId,
            token: apiKey,
            to: phoneForWhatsApp(tenant.whatsapp),
            templateName: template.name,
            templateLanguage: template.language,
            templateParams: params,
            components: template.components || [],
          });
          messageId = sent.messageId;
        } else {
          const sentPayload = await zernioRequest('/inbox/conversations', apiKey, {
            method: 'POST', idempotencyKey,
            body: {
              accountId,
              participantId: phoneForWhatsApp(tenant.whatsapp),
              templateName: template.name,
              templateLanguage: template.language,
              ...(params.length ? { templateParams: params } : {}),
            },
          });
          const sentData = sentPayload.data ?? sentPayload;
          const sentMessageId = sentData.messageId ?? sentData.message?.id;
          if (typeof sentMessageId !== 'string' || !sentMessageId) {
            throw new PublicError('A Zernio não retornou a identificação da mensagem enviada.', 502);
          }
          messageId = sentMessageId;
        }
      } catch (error) {
        await admin.from('zernio_whatsapp_manual_deliveries')
          .update({ status: 'failed', safe_error: error instanceof Error ? error.message.slice(0, 160) : 'send_failed', updated_at: new Date().toISOString() })
          .eq('id', delivery.id).eq('status', 'sending');
        throw error;
      }

      const sentAt = new Date().toISOString();
      await admin.from('zernio_whatsapp_manual_deliveries')
        .update({ status: 'sent', message_id: messageId, sent_at: sentAt, updated_at: sentAt, safe_error: null, error_code: null })
        .eq('id', delivery.id).eq('status', 'sending');

      return json({
        success: true,
        messageId,
        templateName: template.name,
        channel: publicChannel(channel),
      });
    }

    if (action === 'send_template') {
      const templateId = typeof body.templateId === 'string' ? body.templateId : '';
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
      const params = Array.isArray(body.templateParams) ? body.templateParams : [];
      if (!/^[0-9a-f-]{36}$/i.test(templateId) || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
        return json({ error: 'Selecione um template e um locatário válidos.' }, 400);
      }
      const { data: tenant, error: tenantError } = await admin.from('locatarios')
        .select('id,nome_completo,whatsapp').eq('id', tenantId).eq('id_usuario', user.id).eq('ativo', true).maybeSingle();
      if (tenantError || !tenant || !tenant.whatsapp) return json({ error: 'O locatário precisa estar ativo e ter WhatsApp cadastrado.' }, 409);
      const { data: template, error: templateError } = await admin.from('zernio_whatsapp_templates')
        .select('id,meta_template_id,account_id,name,language,status,components,purpose')
        .eq('id', templateId).eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).maybeSingle();
      if (templateError || !template) return json({ error: 'O template não pertence a este locador ou canal.' }, 404);
      if (template.purpose !== 'general') return json({ error: 'Este template é reservado para o fluxo de cobrança.' }, 409);
      const liveTemplates = await syncTemplates(admin, channel, user.id);
      const liveTemplate = liveTemplates.find((item: JsonRecord) => item.id === template.id);
      if (!liveTemplate || liveTemplate.status !== 'APPROVED' || liveTemplate.meta_template_id !== template.meta_template_id) {
        return json({ error: 'Este template não está aprovado pela Meta. Atualize a lista de templates.' }, 409);
      }
      const components = template.components || [];
      const header = components.find((item: JsonRecord) => String(item.type).toUpperCase() === 'HEADER');
      if (header && !['TEXT'].includes(String(header.format).toUpperCase())) {
        return json({ error: 'Envio manual nesta tela aceita apenas templates de texto. Cabeçalhos de mídia/localização precisam ser configurados na tela de cobrança ou em uma próxima etapa.' }, 409);
      }
      const variablesIn = (text: string) => [...new Set([...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a: number, b: number) => a - b);
      let expectedParams = 0;
      for (const component of components) {
        const type = String(component.type).toUpperCase();
        if (type === 'HEADER' || type === 'BODY') {
          const variables = variablesIn(component.text);
          if (variables.some((value: number, index: number) => value !== index + 1)) {
            return json({ error: 'O template contém variáveis fora de sequência e não pode ser enviado por esta tela.' }, 409);
          }
          expectedParams += variables.length;
        } else if (type === 'BUTTONS') {
          const dynamicButtons = (component.buttons || []).filter((button: JsonRecord) =>
            String(button.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(button.url || '')));
          if (dynamicButtons.length > 1) return json({ error: 'Só é possível preencher um botão de URL dinâmica por envio.' }, 409);
          expectedParams += dynamicButtons.length;
        }
      }
      if (params.length !== expectedParams || params.some((value: unknown) => typeof value !== 'string' || !value.trim())) {
        return json({ error: `Preencha os ${expectedParams} valores de variável do template.` }, 400);
      }
      const idempotencyKey = `sga-manual-${crypto.randomUUID()}`;
      const { data: manualDelivery, error: manualDeliveryError } = await admin.from('zernio_whatsapp_manual_deliveries').insert({
        id_usuario: user.id, id_locatario: tenant.id, template_id: template.id, account_id: accountId,
        provider: channel.provider,
        idempotency_key: idempotencyKey, template_name: template.name, template_language: template.language,
        status: 'sending',
      }).select('id').single();
      if (manualDeliveryError || !manualDelivery) throw new PublicError('Nao foi possivel registrar a tentativa de envio. A mensagem nao foi enviada.', 500);
      claimedManualDeliveryId = manualDelivery.id;
      let messageId: string;
      let conversationId: string | null = null;
      if (channel.provider === 'meta') {
        const sent = await sendMetaTemplateMessage({
          phoneNumberId: channel.accountId,
          token: apiKey,
          to: phoneForWhatsApp(tenant.whatsapp),
          templateName: template.name,
          templateLanguage: template.language,
          templateParams: params,
          components: template.components || [],
        });
        messageId = sent.messageId;
      } else {
        let sentPayload: JsonRecord;
        try {
          sentPayload = await zernioRequest('/inbox/conversations', apiKey, {
            method: 'POST', idempotencyKey,
            body: {
              accountId,
              participantId: phoneForWhatsApp(tenant.whatsapp),
              templateName: template.name,
              templateLanguage: template.language,
              ...(params.length ? { templateParams: params } : {}),
            },
          });
        } catch (error) {
          if (error instanceof ZernioError) throw safeZernioError(error);
          throw error;
        }
        const result = sentPayload.data ?? sentPayload;
        const sentMessageId = result.messageId ?? result.message?.id;
        if (typeof sentMessageId !== 'string' || !sentMessageId) {
          throw new PublicError('A Zernio não retornou a identificação da mensagem enviada.', 502);
        }
        messageId = sentMessageId;
        conversationId = result.conversationId ?? result.conversation?.id ?? null;
      }
      const sentAt = new Date().toISOString();
      const { error: auditError } = await admin.from('zernio_whatsapp_manual_deliveries').update({
        status: 'sent', message_id: messageId,
        conversation_id: conversationId,
        sent_at: sentAt, updated_at: sentAt, safe_error: null, error_code: null,
      }).eq('id', manualDelivery.id).eq('status', 'sending');
      if (auditError) throw new Error('A mensagem foi enviada, mas o registro de operacao nao foi concluido.');
      claimedManualDeliveryId = null;
      return json({ success: true, messageId });
    }

    if (action === 'create_template') {
      const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
      const language = typeof body.language === 'string' ? body.language.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim().toUpperCase() : '';
      const components = Array.isArray(body.components) ? body.components : [];
      // Templates only become transactional defaults after the Meta approves them
      // and the owner explicitly maps their variables in set_default.
      const purpose = 'general';
      if (!/^[a-z][a-z0-9_]{0,511}$/.test(name)) {
        return json({ error: 'O nome precisa começar com letra e conter somente letras minúsculas, números e sublinhado.' }, 400);
      }
      if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) {
        return json({ error: 'Informe um código de idioma válido, como pt_BR.' }, 400);
      }
      if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) {
        return json({ error: 'Selecione uma categoria válida para o template.' }, 400);
      }
      if (components.some((item: JsonRecord) => !['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(String(item?.type).toUpperCase()))) {
        return json({ error: 'O template contém um componente não suportado.' }, 400);
      }
      const bodyComponents = components.filter((item: JsonRecord) => String(item?.type).toUpperCase() === 'BODY');
      if (bodyComponents.length !== 1 || typeof bodyComponents[0]?.text !== 'string' || !bodyComponents[0].text.trim() || bodyComponents[0].text.length > 1024) {
        return json({ error: 'O template precisa ter um corpo de mensagem válido com até 1.024 caracteres.' }, 400);
      }
      const bodyText = bodyComponents[0].text as string;
      assertMetaBodyRules(bodyText);
      const unparsedVariableText = bodyText.replace(/\{\{\d+\}\}/g, '');
      if (unparsedVariableText.includes('{{') || unparsedVariableText.includes('}}')) {
        return json({ error: 'Use somente variáveis no formato {{1}}, {{2}}, {{3}}...' }, 400);
      }
      const bodyVariables = [...new Set([...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match: RegExpMatchArray) => Number(match[1])))].sort((a: number, b: number) => a - b);
      if (bodyVariables.some((value: number, index: number) => value !== index + 1)) {
        return json({ error: 'As variáveis do corpo precisam ser sequenciais: {{1}}, {{2}}, {{3}}...' }, 400);
      }
      if (bodyVariables.length && (!Array.isArray(bodyComponents[0]?.example?.body_text?.[0])
        || bodyComponents[0].example.body_text[0].length !== bodyVariables.length
        || bodyComponents[0].example.body_text[0].some((value: unknown) => typeof value !== 'string' || !value.trim() || value.length > 60))) {
        return json({ error: 'Informe um exemplo de até 60 caracteres para cada variável do corpo.' }, 400);
      }
      if (components.length > 4) return json({ error: 'O template contém componentes duplicados ou não suportados.' }, 400);
      const header = components.find((item: JsonRecord) => String(item?.type).toUpperCase() === 'HEADER');
      if (components.filter((item: JsonRecord) => String(item?.type).toUpperCase() === 'HEADER').length > 1
        || components.filter((item: JsonRecord) => String(item?.type).toUpperCase() === 'FOOTER').length > 1
        || components.filter((item: JsonRecord) => String(item?.type).toUpperCase() === 'BUTTONS').length > 1) {
        return json({ error: 'O template aceita somente um cabeçalho, rodapé e grupo de botões.' }, 400);
      }
      if (header && !['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(String(header.format).toUpperCase())) {
        return json({ error: 'Selecione um formato válido para o cabeçalho.' }, 400);
      }
      if (String(header?.format).toUpperCase() === 'TEXT' && (typeof header.text !== 'string' || header.text.length > 60 || /\{\{|\}\}/.test(header.text))) {
        return json({ error: 'O cabeçalho de texto aceita até 60 caracteres e não permite variáveis.' }, 400);
      }
      if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header.format).toUpperCase())
        && (typeof header.example?.header_handle?.[0] !== 'string' || !header.example.header_handle[0].trim())) {
        return json({ error: 'Informe o handle de mídia de exemplo exigido pela Meta.' }, 400);
      }
      if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header.format).toUpperCase())) {
        try {
          if (new URL(header.example.header_handle[0]).protocol !== 'https:') throw new Error('invalid header media URL');
        } catch { return json({ error: 'A mídia de exemplo precisa ser uma URL pública HTTPS.' }, 400); }
      }
      const footer = components.find((item: JsonRecord) => String(item?.type).toUpperCase() === 'FOOTER');
      if (footer && (typeof footer.text !== 'string' || footer.text.length > 60 || /\{\{|\}\}/.test(footer.text))) {
        return json({ error: 'O rodapé pode ter no máximo 60 caracteres.' }, 400);
      }
      const buttonComponent = components.find((item: JsonRecord) => String(item?.type).toUpperCase() === 'BUTTONS');
      const buttons = Array.isArray(buttonComponent?.buttons) ? buttonComponent.buttons : [];
      if (buttons.some((item: JsonRecord) => typeof item.text !== 'string' || !item.text.trim() || item.text.length > 25)) {
        return json({ error: 'Cada botão precisa ter um texto de até 25 caracteres.' }, 400);
      }
      if (buttons.some((item: JsonRecord) => !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(String(item.type).toUpperCase()))) {
        return json({ error: 'Tipo de botão não suportado neste formulário.' }, 400);
      }
      if (buttons.filter((item: JsonRecord) => String(item.type).toUpperCase() === 'QUICK_REPLY').length > 3) {
        return json({ error: 'São permitidas no máximo 3 respostas rápidas.' }, 400);
      }
      if (buttons.length > 2 && buttons.some((item: JsonRecord) => ['URL', 'PHONE_NUMBER'].includes(String(item.type).toUpperCase()))) {
        return json({ error: 'São permitidos no máximo 2 botões de chamada para ação.' }, 400);
      }
      const ctaButtons = buttons.filter((item: JsonRecord) => ['URL', 'PHONE_NUMBER'].includes(String(item.type).toUpperCase()));
      const quickReplyButtons = buttons.filter((item: JsonRecord) => String(item.type).toUpperCase() === 'QUICK_REPLY');
      if (ctaButtons.length && quickReplyButtons.length) {
        return json({ error: 'Escolha respostas rápidas ou botões CTA, sem misturar os dois tipos.' }, 400);
      }
      if (ctaButtons.length === 2 && new Set(ctaButtons.map((item: JsonRecord) => String(item.type).toUpperCase())).size !== 2) {
        return json({ error: 'Os botões CTA precisam ser um de telefone e um de site.' }, 400);
      }
      const invalidCta = ctaButtons.some((item: JsonRecord) => {
        const type = String(item.type).toUpperCase();
        if (type === 'PHONE_NUMBER') return !/^\d{8,15}$/.test(String(item.phone_number ?? ''));
        if (typeof item.url !== 'string' || item.url.length > 2000) return true;
        try {
          const url = new URL(item.url.replace(/\{\{1\}\}/g, 'example'));
          if (url.protocol !== 'https:') return true;
        } catch { return true; }
        if (/\{\{\d+\}\}/.test(item.url)) {
          if (!item.url.endsWith('{{1}}') || !Array.isArray(item.example) || typeof item.example[0] !== 'string') return true;
          return !item.example[0].trim();
        }
        return false;
      });
      if (invalidCta) {
        return json({ error: 'Confira o número de telefone ou informe uma URL HTTPS válida com exemplo quando dinâmica.' }, 400);
      }
      let remoteTemplate: JsonRecord | null = null;
      if (channel.provider === 'meta') {
        try {
          const created = await createMessageTemplate(channel.wabaId as string, apiKey, {
            name,
            category,
            language,
            parameter_format: 'POSITIONAL',
            components,
          });
          remoteTemplate = {
            id: created.id,
            name,
            language,
            category: created.category,
            status: created.status,
            components,
          };
        } catch (error) {
          if (error instanceof MetaApiError) {
            throw new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400);
          }
          throw error;
        }
      } else {
        const createPayload = await zernioRequest('/whatsapp/templates', apiKey, {
          method: 'POST',
          body: { accountId, name, category, language, components },
        });
        remoteTemplate = createPayload.template ?? createPayload.data?.template ?? null;
        if (!remoteTemplate || typeof remoteTemplate.id !== 'string') {
          throw new PublicError('A Meta recebeu o pedido, mas a Zernio não retornou os dados do template. Atualize a lista.', 502);
        }
      }
      const mapping: JsonRecord[] = [];
      const row = mapTemplate(remoteTemplate, channel, user.id, {
        purpose, variable_mapping: mapping, is_default: false,
      });
      if (!row) throw new PublicError('A Zernio não retornou uma identificação válida para o template.', 502);
      row.purpose = purpose;
      row.variable_mapping = mapping;
      const { data: saved, error: saveError } = await admin.from('zernio_whatsapp_templates')
        .upsert(row, { onConflict: 'id_usuario,provider,account_id,name,language' })
        .select('id,meta_template_id,name,language,category,status,rejection_reason,components,variable_mapping,purpose,is_default,last_synced_at,provider')
        .single();
      if (saveError || !saved) throw new Error('O template foi enviado à Meta, mas não foi possível salvá-lo no SGA. Atualize a lista.');
      return json({ template: saved, channel: publicChannel(channel) });
    }

    if (action === 'delete_template') {
      const templateId = typeof body.templateId === 'string' ? body.templateId : '';
      if (!/^[0-9a-f-]{36}$/i.test(templateId)) return json({ error: 'Selecione um template válido.' }, 400);
      const { data: template, error: templateError } = await admin.from('zernio_whatsapp_templates')
        .select('id,meta_template_id,name,language,status')
        .eq('id', templateId).eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).maybeSingle();
      if (templateError || !template) return json({ error: 'O template não pertence a este locador ou canal.' }, 404);
      if (['DELETED', 'PENDING_DELETION'].includes(String(template.status ?? '').toUpperCase())) {
        return json({ error: 'Este template já foi excluído.' }, 409);
      }

      // Remove o template da sequencia de lembretes e das confirmacoes.
      const { error: usageError } = await admin.from('zernio_whatsapp_template_usages')
        .delete().eq('template_id', template.id).eq('id_usuario', user.id);
      if (usageError) throw new Error('Não foi possível remover o template da sequência de lembretes.');

      if (channel.provider === 'meta') {
        try {
          await deleteMessageTemplate(channel.wabaId as string, apiKey, template.name, template.meta_template_id ?? null);
        } catch (error) {
          if (error instanceof MetaApiError) {
            throw new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400);
          }
          throw error;
        }
      } else {
        try {
          const query = new URLSearchParams({ accountId, language: template.language });
          await zernioRequest(`/whatsapp/templates/${encodeURIComponent(template.name)}?${query.toString()}`, apiKey, { method: 'DELETE' });
        } catch (error) {
          if (error instanceof ZernioError) throw safeZernioError(error);
          throw error;
        }
      }

      // Entregas antigas referenciam o template, entao a linha local e
      // preservada apenas como registro do historico.
      const { data: deliveries } = await admin.from('zernio_whatsapp_deliveries')
        .select('id').eq('template_id', template.id).eq('id_usuario', user.id).limit(1);
      if (deliveries?.length) {
        await admin.from('zernio_whatsapp_templates')
          .update({ status: 'DELETED', updated_at: new Date().toISOString() })
          .eq('id', template.id).eq('id_usuario', user.id);
        return json({
          success: true,
          archived: true,
          message: 'Template excluído na Meta. O histórico de envios foi preservado.',
          templates: await syncTemplates(admin, channel, user.id),
          channel: publicChannel(channel),
        });
      }

      const { error: deleteError } = await admin.from('zernio_whatsapp_templates')
        .delete().eq('id', template.id).eq('id_usuario', user.id);
      if (deleteError) throw new Error('O template foi excluído na Meta, mas não foi possível removê-lo do SGA.');
      return json({
        success: true,
        archived: false,
        message: 'Template excluído.',
        templates: await syncTemplates(admin, channel, user.id),
        channel: publicChannel(channel),
      });
    }

    if (action === 'update_template_button') {
      const templateId = typeof body.templateId === 'string' ? body.templateId : '';
      if (!/^[0-9a-f-]{36}$/i.test(templateId)) return json({ error: 'Selecione um template válido.' }, 400);
      if (channel.provider !== 'meta') {
        return json({ error: 'A edição de templates pela interface está disponível para contas Meta Cloud API.' }, 409);
      }
      const { data: template, error: templateError } = await admin.from('zernio_whatsapp_templates')
        .select('id,meta_template_id,name,language,status,components')
        .eq('id', templateId).eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).maybeSingle();
      if (templateError || !template) return json({ error: 'O template não pertence a este locador ou canal.' }, 404);
      if (!template.meta_template_id) return json({ error: 'Este template não tem identificação na Meta. Atualize a lista.' }, 409);
      if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(String(template.status ?? '').toUpperCase())) {
        return json({ error: 'A Meta só permite editar templates aprovados, rejeitados ou pausados.' }, 409);
      }

      const components: JsonRecord[] = Array.isArray(template.components)
        ? JSON.parse(JSON.stringify(template.components)) : [];
      const buttonsComponent = components.find((item) => String(item?.type).toUpperCase() === 'BUTTONS');
      const buttons: JsonRecord[] = buttonsComponent && Array.isArray(buttonsComponent.buttons)
        ? buttonsComponent.buttons : [];
      const urlIndexes = buttons
        .map((button, index) => (String(button?.type).toUpperCase() === 'URL' ? index : -1))
        .filter((index) => index >= 0);
      if (!buttonsComponent || !urlIndexes.length) {
        return json({ error: 'Este template não tem botão de URL para editar.' }, 409);
      }
      const requestedIndex = Number.isInteger(Number(body.buttonIndex)) ? Number(body.buttonIndex) : 0;
      if (requestedIndex < 0 || requestedIndex >= urlIndexes.length) {
        return json({ error: 'Botão de URL inválido para este template.' }, 400);
      }
      const button = buttons[urlIndexes[requestedIndex]];
      const currentLabel = typeof button.text === 'string' ? button.text : '';
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : currentLabel;
      if (!label || label.length > 25) {
        return json({ error: 'O texto do botão precisa ter de 1 a 25 caracteres.' }, 400);
      }
      const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
      if (!rawUrl || rawUrl.length > 2000) {
        return json({ error: 'Informe a URL do botão com até 2.000 caracteres.' }, 400);
      }
      const variables = [...rawUrl.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1]);
      const isDynamic = variables.length > 0;
      if (isDynamic && (variables.length !== 1 || variables[0] !== '1' || !rawUrl.endsWith('{{1}}'))) {
        return json({ error: 'O botão dinâmico aceita uma única variável {{1}}, sempre no final da URL.' }, 400);
      }
      const staticPart = isDynamic ? rawUrl.slice(0, rawUrl.lastIndexOf('{{1}}')) : rawUrl;
      if (/%7B|%7D/i.test(rawUrl)) {
        return json({ error: 'A URL contém a variável codificada (%7B%7B1%7D%7D). Use literalmente {{1}}, uma única vez, no final.' }, 400);
      }
      if (staticPart.includes('{{') || staticPart.includes('}}') || staticPart.includes('{') || staticPart.includes('}')) {
        return json({ error: 'Use somente a variável {{1}} no endereço do botão.' }, 400);
      }
      try {
        if (new URL(isDynamic ? `${staticPart}example` : rawUrl).protocol !== 'https:') {
          return json({ error: 'A URL do botão precisa ser HTTPS.' }, 400);
        }
      } catch {
        return json({ error: 'Informe uma URL HTTPS válida.' }, 400);
      }
      let example = '';
      if (isDynamic) {
        example = typeof body.example === 'string' ? body.example.trim() : '';
        // Aceita tambem o exemplo antigo no formato de URL completa.
        if (staticPart && example.startsWith(staticPart)) example = example.slice(staticPart.length);
        if (!example || example.length > 200 || /\s/.test(example)) {
          return json({ error: 'Informe um exemplo de até 200 caracteres, sem espaços, para a variável do botão.' }, 400);
        }
      }

      button.text = label;
      button.url = rawUrl;
      if (isDynamic) button.example = [example];
      else delete button.example;

      try {
        await editMessageTemplate(template.meta_template_id, apiKey, components);
      } catch (error) {
        if (error instanceof MetaApiError) {
          throw new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400);
        }
        throw error;
      }

      // A Meta nao devolve o template editado: guarda os componentes enviados
      // e sincroniza em seguida para refletir o novo status de revisao.
      const { error: saveError } = await admin.from('zernio_whatsapp_templates')
        .update({ components, updated_at: new Date().toISOString() })
        .eq('id', template.id).eq('id_usuario', user.id);
      if (saveError) throw new Error('A Meta aceitou a edição, mas não foi possível salvá-la no SGA. Atualize a lista.');

      return json({
        success: true,
        message: 'Botão atualizado. A Meta reavalia o template automaticamente.',
        templates: await syncTemplates(admin, channel, user.id),
        channel: publicChannel(channel),
      });
    }

    if (action === 'set_default') {
      const templates = await syncTemplates(admin, channel, user.id);
      const purpose = body.purpose === 'payment_confirmation' ? 'payment_confirmation' : body.purpose === 'charge' ? 'charge' : '';
      if (!purpose) return json({ error: 'Informe se o template será usado em lembretes ou confirmações de pagamento.' }, 400);
      const selected = templates.find((item: JsonRecord) => item.id === body.templateId);
      if (!selected) return json({ error: 'Selecione um template deste canal.' }, 404);
      if (selected.status !== 'APPROVED') return json({ error: 'A Meta só permite usar templates com status APPROVED.' }, 409);
      const expectedCount = templateParameterCount(Array.isArray(selected.components) ? selected.components : []);
      const allowedFields = purpose === 'charge'
        ? new Set(['tenant_first_name', 'amount', 'due_date', 'payment_link', 'payment_token'])
        : new Set(['tenant_first_name', 'amount', 'paid_at']);
      const requestedMapping = Array.isArray(body.variableMapping) ? body.variableMapping : [];
      const variableMapping = requestedMapping.map((item: JsonRecord, index: number) => ({
        position: Number(item.position), field: String(item.field ?? ''), index,
      }));
      if (variableMapping.length !== expectedCount || variableMapping.some((item: JsonRecord, index: number) =>
        item.position !== index + 1 || item.index !== index || !allowedFields.has(item.field))) {
        return json({ error: 'Associe cada variável do template a um campo válido do SGA.' }, 400);
      }
      const { data: currentUsage } = await admin.from('zernio_whatsapp_template_usages')
        .select('reminder_order,is_default').eq('template_id', selected.id).eq('purpose', purpose).maybeSingle();
      let reminderOrder = 1;
      if (purpose === 'charge') {
        if (Number.isInteger(Number(body.reminderOrder)) && Number(body.reminderOrder) > 0) {
          reminderOrder = Number(body.reminderOrder);
        } else if (currentUsage?.is_default) {
          reminderOrder = Number(currentUsage.reminder_order) || 1;
        } else {
          const { data: currentReminders } = await admin.from('zernio_whatsapp_template_usages')
            .select('reminder_order').eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId)
            .eq('purpose', 'charge').eq('is_default', true).order('reminder_order', { ascending: false }).limit(1);
          reminderOrder = Number(currentReminders?.[0]?.reminder_order || 0) + 1;
        }
      } else {
        const { error: clearError } = await admin.from('zernio_whatsapp_template_usages')
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).eq('purpose', purpose).eq('is_default', true);
        if (clearError) throw new Error('Não foi possível atualizar o template padrão.');
      }
      const { data: saved, error: saveError } = await admin.from('zernio_whatsapp_template_usages')
        .upsert({
          template_id: selected.id, id_usuario: user.id, provider: channel.provider, account_id: accountId, purpose,
          variable_mapping: variableMapping.map(({ position, field }: JsonRecord) => ({ position, field })),
          is_default: true, reminder_order: reminderOrder, updated_at: new Date().toISOString(),
        }, { onConflict: 'template_id,purpose' }).select('id').maybeSingle();
      if (saveError || !saved) throw new Error('Não foi possível selecionar o template padrão.');
      return json({ success: true, templates: await syncTemplates(admin, channel, user.id), channel: publicChannel(channel) });
    }

    if (action === 'save_charge_order') {
      const templateIds = Array.isArray(body.templateIds) ? body.templateIds.map(String) : [];
      if (new Set(templateIds).size !== templateIds.length) return json({ error: 'A sequência contém templates duplicados.' }, 400);
      const templates = await syncTemplates(admin, channel, user.id);
      const selected = templateIds.map((templateId: string) => templates.find((item: JsonRecord) => item.id === templateId));
      if (selected.some((template: JsonRecord | undefined) => !template || template.status !== 'APPROVED')) {
        return json({ error: 'Todos os templates da sequência precisam estar aprovados neste canal.' }, 409);
      }
      const { data: selectedUsages, error: usageReadError } = templateIds.length
        ? await admin.from('zernio_whatsapp_template_usages').select('template_id,purpose')
          .eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).eq('purpose', 'charge').in('template_id', templateIds)
        : { data: [], error: null };
      if (usageReadError || (selectedUsages || []).length !== templateIds.length) {
        return json({ error: 'Configure primeiro as variáveis de cada template de lembrete.' }, 409);
      }
      const { error: clearError } = await admin.from('zernio_whatsapp_template_usages')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).eq('purpose', 'charge').eq('is_default', true);
      if (clearError) throw new Error('Não foi possível atualizar a sequência de lembretes.');
      for (const [index, templateId] of templateIds.entries()) {
        const { error: orderError } = await admin.from('zernio_whatsapp_template_usages')
          .update({ is_default: true, reminder_order: index + 1, updated_at: new Date().toISOString() })
          .eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).eq('purpose', 'charge').eq('template_id', templateId);
        if (orderError) throw new Error('Não foi possível salvar a ordem dos templates de lembrete.');
      }
      return json({ success: true, templates: await syncTemplates(admin, channel, user.id), channel: publicChannel(channel) });
    }

    if (action === 'create_schedule') {
      const templateId = typeof body.templateId === 'string' ? body.templateId : '';
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
      const frequency = typeof body.frequency === 'string' ? body.frequency : '';
      const scheduledDate = typeof body.scheduledDate === 'string' ? body.scheduledDate : '';
      const scheduledTime = typeof body.scheduledTime === 'string' ? body.scheduledTime : '';
      const frequencyDays = Number(body.frequencyDays);
      const params = Array.isArray(body.templateParams) ? body.templateParams : [];
      if (!/^[0-9a-f-]{36}$/i.test(templateId) || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
        return json({ error: 'Selecione um template e um locatário válidos.' }, 400);
      }
      if (!['diario', 'semanal', 'quinzenal', 'mensal', 'personalizado'].includes(frequency)) {
        return json({ error: 'Selecione uma frequência válida.' }, 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) {
        return json({ error: 'Informe uma data e horário válidos para o primeiro envio.' }, 400);
      }
      const parsedDate = new Date(`${scheduledDate}T12:00:00Z`);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== scheduledDate) {
        return json({ error: 'A data do primeiro envio nao existe no calendario.' }, 400);
      }
      const currentParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date()).reduce((parts: JsonRecord, part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
        return parts;
      }, {});
      const currentDate = `${currentParts.year}-${currentParts.month}-${currentParts.day}`;
      const currentTime = `${currentParts.hour}:${currentParts.minute}`;
      if (scheduledDate < currentDate || (scheduledDate === currentDate && scheduledTime <= currentTime)) {
        return json({ error: 'O primeiro envio precisa estar no futuro, considerando o horario de Brasilia.' }, 400);
      }
      if (frequency === 'personalizado' && (!Number.isInteger(frequencyDays) || frequencyDays < 1 || frequencyDays > 365)) {
        return json({ error: 'A frequência personalizada deve estar entre 1 e 365 dias.' }, 400);
      }
      const { data: tenant, error: tenantError } = await admin.from('locatarios')
        .select('id,whatsapp').eq('id', tenantId).eq('id_usuario', user.id).eq('ativo', true).maybeSingle();
      if (tenantError || !tenant || !tenant.whatsapp) return json({ error: 'Selecione um locatário ativo com WhatsApp cadastrado.' }, 409);
      const { data: selectedTemplate, error: selectedTemplateError } = await admin.from('zernio_whatsapp_templates')
        .select('id,account_id,name,language,category,status,components')
        .eq('id', templateId).eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).maybeSingle();
      if (selectedTemplateError || !selectedTemplate) return json({ error: 'Template Meta não encontrado neste canal.' }, 404);
      if (selectedTemplate.status !== 'APPROVED') return json({ error: 'Somente templates aprovados pela Meta podem receber agendamentos.' }, 409);
      if ((selectedTemplate.components || []).some((component: JsonRecord) => String(component.type).toUpperCase() === 'HEADER' && String(component.format).toUpperCase() === 'LOCATION')) {
        return json({ error: 'Templates com cabeçalho de localização precisam de coordenadas por envio e não podem ser agendados nesta tela.' }, 400);
      }
      const components = selectedTemplate.components || [];
      const templateVariables = (text: string) => [...new Set([...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a: number, b: number) => a - b);
      const orderedComponents = [
        ...components.filter((component: JsonRecord) => String(component.type).toUpperCase() === 'HEADER'),
        ...components.filter((component: JsonRecord) => String(component.type).toUpperCase() === 'BODY'),
        ...components.filter((component: JsonRecord) => String(component.type).toUpperCase() === 'BUTTONS'),
      ];
      let requiredParams = 0;
      for (const component of orderedComponents) {
        if (['HEADER', 'BODY'].includes(String(component.type).toUpperCase())) {
          const variables = templateVariables(component.text);
          if (variables.some((value: number, index: number) => value !== index + 1)) {
            return json({ error: 'O template tem variáveis não sequenciais e não pode ser agendado.' }, 409);
          }
          requiredParams += variables.length;
        } else if (String(component.type).toUpperCase() === 'BUTTONS') {
          requiredParams += (component.buttons || []).filter((button: JsonRecord) =>
            String(button.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(button.url || ''))).length;
        }
      }
      if (params.length !== requiredParams || params.some((value: unknown) => typeof value !== 'string' || !value.trim())) {
        return json({ error: `Informe ${requiredParams} valor(es) de variável para este template.` }, 400);
      }
      const { data: schedule, error: scheduleError } = await admin.from('agendamentos_mensagens').insert({
        id_usuario: user.id,
        id_locatario: tenant.id,
        id_template: null,
        zernio_template_id: selectedTemplate.id,
        template_params: params,
        frequencia: frequency,
        frequencia_dias: frequency === 'personalizado' ? frequencyDays : null,
        proximo_envio: scheduledDate,
        horario_envio: `${scheduledTime}:00`,
        ativo: true,
      }).select('id').single();
      if (scheduleError || !schedule) throw new Error('Não foi possível salvar o agendamento Meta.');
      return json({ success: true, scheduleId: schedule.id });
    }

    if (action === 'send_charge') {
      const chargeId = body.chargeId;
      if (typeof chargeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(chargeId)) return json({ error: 'Identificador da cobrança inválido.' }, 400);
      const { data: charge, error: chargeError } = await admin.from('cobrancas')
        .select('id,id_usuario,id_locatario,id_contrato,valor,data_vencimento,status,tipo,payment_link,pay_token,mercado_pago_id,tentativas_envio,created_at,pix_expires_at,pix_expired_at,reminder_interval_minutes')
        .eq('id', chargeId).eq('id_usuario', user.id).maybeSingle();
      if (chargeError || !charge) return json({ error: 'Cobrança não encontrada para este locador.' }, 404);
      if (!['pendente', 'atrasado'].includes(charge.status) || charge.tipo === 'despesa') {
        return json({ error: 'Somente cobranças de receita pendentes ou atrasadas podem ser enviadas.' }, 409);
      }
      const storedPixExpiry = charge.pix_expires_at || new Date(new Date(charge.created_at).getTime() + 4 * 60 * 60 * 1000).toISOString();
      if (charge.pix_expired_at || new Date(storedPixExpiry).getTime() <= Date.now()) {
        return json({ error: 'O PIX desta cobrança expirou. Gere um novo PIX antes de enviar outro lembrete.' }, 409);
      }
      if (!Number.isFinite(Number(charge.valor)) || Number(charge.valor) <= 0) {
        return json({ error: 'O valor desta cobrança precisa ser maior que zero.' }, 409);
      }
      if (charge.mercado_pago_id && charge.payment_link) {
        const { data: mpToken } = await admin.rpc('get_user_mp_token', { p_user_id: user.id });
        if (typeof mpToken === 'string' && mpToken) {
          try {
            const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(charge.mercado_pago_id)}`, {
              headers: { Authorization: `Bearer ${mpToken}` },
              signal: AbortSignal.timeout(12000),
            });
            if (paymentResponse.ok) {
              const payment = await paymentResponse.json();
              if (payment.status === 'approved') {
                await admin.from('cobrancas').update({ status: 'pago', data_pagamento: new Date().toISOString(), next_reminder_at: null })
                  .eq('id', charge.id).eq('id_usuario', user.id);
                return json({ error: 'O Mercado Pago já confirmou esta cobrança como paga.' }, 409);
              }
              if (!['pending', 'in_process'].includes(payment.status)) {
                return json({ error: 'O pagamento PIX não está pendente no Mercado Pago. Atualize ou recrie a cobrança antes do envio.' }, 409);
              }
            }
          } catch (error) {
            if (error instanceof PublicError) throw error;
          }
        }
      }
      if (!charge.id_locatario) return json({ error: 'Esta cobrança não tem locatário vinculado. Atualize o cadastro da cobrança.' }, 409);
      const { data: tenant, error: tenantError } = await admin.from('locatarios')
        .select('id,nome_completo,whatsapp,email,cpf').eq('id', charge.id_locatario).eq('id_usuario', user.id).maybeSingle();
      if (tenantError || !tenant || !tenant.whatsapp) return json({ error: 'O locatário não possui WhatsApp válido cadastrado.' }, 409);
      const requestedSequence = serviceCall && Number.isInteger(Number(body.reminderSequence)) && Number(body.reminderSequence) > 0
        ? Number(body.reminderSequence) : Number(charge.tentativas_envio || 0) + 1;
      const { data: lastSentReminder, error: sentSequenceError } = await admin.from('zernio_whatsapp_deliveries')
        .select('sequence_no').eq('id_usuario', user.id).eq('id_cobranca', charge.id)
        .eq('status', 'sent').order('sequence_no', { ascending: false }).limit(1).maybeSingle();
      if (sentSequenceError) throw new Error('Não foi possível determinar a ordem do próximo lembrete.');
      const reminderSequence = Math.max(requestedSequence, Number(lastSentReminder?.sequence_no || 0) + 1);
      const { data: reminderUsages, error: usageError } = await admin.from('zernio_whatsapp_template_usages')
        .select('template_id,variable_mapping,reminder_order').eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId)
        .eq('is_default', true).eq('purpose', 'charge').order('reminder_order');
      if (usageError || !reminderUsages?.length) return json({ error: 'Selecione um ou mais templates aprovados para lembretes na aba Templates Meta de /mensagens.' }, 409);
      const selectedUsage = reminderUsages[(reminderSequence - 1) % reminderUsages.length];
      const { data: selectedTemplate, error: templateError } = await admin.from('zernio_whatsapp_templates')
        .select('*').eq('id', selectedUsage.template_id).eq('id_usuario', user.id).eq('provider', channel.provider).eq('account_id', accountId).maybeSingle();
      if (templateError || !selectedTemplate) return json({ error: 'O template padrão de cobrança não foi encontrado neste canal.' }, 409);

      const liveTemplates = await syncTemplates(admin, channel, user.id);
      const liveTemplate = liveTemplates.find((item: JsonRecord) => item.name === selectedTemplate.name && item.language === selectedTemplate.language);
      if (!liveTemplate || liveTemplate.status !== 'APPROVED' || liveTemplate.meta_template_id !== selectedTemplate.meta_template_id) {
        return json({ error: 'O template padrão não está aprovado pela Meta. Atualize a lista e escolha um template APPROVED.' }, 409);
      }

      const paymentLink = charge.payment_link || await generatePaymentLink(admin, user.id, charge, tenant);
      const pixExpiresAt = charge.pix_expires_at || storedPixExpiry;
      const participantId = phoneForWhatsApp(tenant.whatsapp);
      const params = billingTemplateParams(selectedTemplate, selectedUsage.variable_mapping || [], tenant.nome_completo, Number(charge.valor), charge.data_vencimento, paymentLink, String(charge.pay_token ?? ''));
      const { data: existing, error: existingError } = await admin.from('zernio_whatsapp_deliveries')
        .select('*').eq('id_usuario', user.id).eq('id_cobranca', charge.id).eq('sequence_no', reminderSequence).maybeSingle();
      if (existingError) throw new Error('Não foi possível verificar o histórico de envio desta cobrança.');
      if (existing?.status === 'sent') return json({ success: true, alreadySent: true, messageId: existing.message_id });
      if (existing?.status === 'sending' && new Date(existing.updated_at).getTime() > Date.now() - 120000) {
        return json({ error: 'O envio deste lembrete já está em processamento. Aguarde alguns instantes.' }, 409);
      }
      let delivery: JsonRecord | null = null;
      if (existing) {
        const claimQuery = admin.from('zernio_whatsapp_deliveries').update({
          status: 'sending', template_id: selectedTemplate.id, account_id: accountId,
          meta_template_id: selectedTemplate.meta_template_id, template_name: selectedTemplate.name,
          template_language: selectedTemplate.language, safe_error: null, error_code: null,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id).eq('status', existing.status);
        if (existing.status === 'sending') claimQuery.lt('updated_at', new Date(Date.now() - 120000).toISOString());
        const { data: claimed, error: claimError } = await claimQuery.select('*').maybeSingle();
        if (claimError || !claimed) return json({ error: 'O envio está sendo processado por outra solicitação. Aguarde e atualize a tela.' }, 409);
        delivery = claimed;
      } else {
        const { data: inserted, error: insertError } = await admin.from('zernio_whatsapp_deliveries').insert({
          id_usuario: user.id, id_cobranca: charge.id, template_id: selectedTemplate.id, account_id: accountId,
          provider: channel.provider,
          idempotency_key: `sga-charge-${charge.id}-${reminderSequence}`, sequence_no: reminderSequence,
          status: 'sending', meta_template_id: selectedTemplate.meta_template_id,
          template_name: selectedTemplate.name, template_language: selectedTemplate.language,
        }).select('*').maybeSingle();
        if (insertError || !inserted) return json({ error: 'Não foi possível reservar este lembrete. Atualize e tente novamente.' }, 409);
        delivery = inserted;
      }
      if (!delivery) throw new Error('Não foi possível registrar a tentativa de envio.');
      claimedDeliveryId = delivery.id;
      let messageId: string;
      let conversationId: string | null = null;
      if (channel.provider === 'meta') {
        const sent = await sendMetaTemplateMessage({
          phoneNumberId: channel.accountId,
          token: apiKey,
          to: participantId,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language,
          templateParams: params,
          components: selectedTemplate.components || [],
        });
        messageId = sent.messageId;
      } else {
        let sendPayload: JsonRecord;
        try {
          sendPayload = await zernioRequest('/inbox/conversations', apiKey, {
            method: 'POST', idempotencyKey: delivery.idempotency_key,
            body: { accountId, participantId, templateName: selectedTemplate.name, templateLanguage: selectedTemplate.language, templateParams: params },
          });
        } catch (error) {
          if (error instanceof ZernioError) throw safeZernioError(error);
          throw error;
        }
        const sentData = sendPayload.data ?? sendPayload;
        const sentMessageId = sentData.messageId ?? sentData.message?.id;
        const sentConversationId = sentData.conversationId ?? sentData.conversation?.id;
        if (typeof sentMessageId !== 'string' || !sentMessageId) {
          throw new PublicError('A Zernio aceitou o envio, mas não retornou o identificador da mensagem. O SGA manterá a tentativa protegida contra duplicidade.', 502);
        }
        messageId = sentMessageId;
        conversationId = typeof sentConversationId === 'string' ? sentConversationId : null;
      }
      const sentAt = new Date().toISOString();
      const { error: finishError } = await admin.from('zernio_whatsapp_deliveries').update({
        status: 'sent', message_id: messageId, conversation_id: conversationId,
        safe_error: null, error_code: null, sent_at: sentAt, updated_at: sentAt,
      }).eq('id', delivery.id).eq('status', 'sending');
      if (finishError) throw new Error('A Zernio enviou a mensagem, mas o SGA não conseguiu concluir a auditoria. Atualize a tela antes de tentar novamente.');
      claimedDeliveryId = null;
      const nextReminderAt = new Date(new Date(sentAt).getTime() + Number(charge.reminder_interval_minutes || 30) * 60000);
      const nextReminder = nextReminderAt.getTime() < new Date(pixExpiresAt).getTime()
        ? nextReminderAt.toISOString() : null;
      const { error: scheduleError } = await admin.from('cobrancas').update({
        tentativas_envio: reminderSequence, ultimo_lembrete_at: sentAt, next_reminder_at: nextReminder,
        pix_expires_at: pixExpiresAt,
      }).eq('id', charge.id).eq('id_usuario', user.id).in('status', ['pendente', 'atrasado']);
      if (scheduleError) {
        console.error('WhatsApp reminder was sent, but its next reminder schedule could not be saved:', scheduleError.message);
      } else {
        console.log(`WhatsApp reminder sequence ${reminderSequence} saved; next reminder: ${nextReminder ?? 'none before PIX expiry'}.`);
      }
      return json({ success: true, message: 'Link PIX enviado por um template aprovado da Meta.', messageId, paymentLink });
    }

    return json({ error: 'Ação não reconhecida.' }, 400);
  } catch (error) {
    let safeError: PublicError;
    let detail: string | null = null;
    if (error instanceof PublicError) safeError = error;
    else if (error instanceof ZernioError) safeError = safeZernioError(error);
    else if (error instanceof MetaApiError) {
      safeError = new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400);
      detail = metaErrorDetail(error);
    } else {
      console.error('Unexpected WhatsApp error:', error);
      detail = error instanceof Error ? error.message.slice(0, 200) : 'erro interno';
      safeError = new PublicError('Não foi possível concluir a operação. Confira as Configurações e tente novamente.', 500);
    }
    if (claimedDeliveryId && admin) {
      const code = error instanceof ZernioError && error.code ? error.code : 'send_failed';
      await admin.from('zernio_whatsapp_deliveries').update({
        status: 'failed', error_code: code, safe_error: safeError.message, updated_at: new Date().toISOString(),
      }).eq('id', claimedDeliveryId).eq('status', 'sending');
    }
    if (claimedManualDeliveryId && admin) {
      const code = error instanceof ZernioError && error.code ? error.code : 'send_failed';
      await admin.from('zernio_whatsapp_manual_deliveries').update({
        status: 'failed', error_code: code, safe_error: safeError.message, updated_at: new Date().toISOString(),
      }).eq('id', claimedManualDeliveryId).eq('status', 'sending');
    }
    return json(detail ? { error: safeError.message, detail } : { error: safeError.message }, safeError.status);
  }
});
