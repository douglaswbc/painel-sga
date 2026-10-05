import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const param = typeof rawParam === 'string' && /^[A-Za-z0-9_.\[\]-]{1,100}$/.test(rawParam) ? rawParam : null;
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

function mapTemplate(template: JsonRecord, accountId: string, ownerId: string, existing?: JsonRecord) {
  const remoteId = template.id ?? template._id;
  if (typeof remoteId !== 'string' || !template.name || !template.language) return null;
  const status = String(template.status ?? 'PENDING').toUpperCase();
  const allowed = new Set(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION']);
  return {
    ...(existing?.id ? { id: existing.id } : {}),
    id_usuario: ownerId,
    account_id: accountId,
    meta_template_id: remoteId,
    name: String(template.name),
    language: String(template.language),
    category: ['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(String(template.category).toUpperCase())
      ? String(template.category).toUpperCase() : 'UTILITY',
    status: allowed.has(status) ? status : 'PENDING',
    rejection_reason: template.reason ?? template.rejectionReason ?? template.rejection_reason ?? null,
    components: Array.isArray(template.components) ? template.components : [],
    variable_mapping: existing?.variable_mapping ?? [],
    purpose: existing?.purpose ?? 'general',
    is_default: existing?.is_default ?? false,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function syncTemplates(admin: any, apiKey: string, ownerId: string, accountId: string) {
  const query = new URLSearchParams({ accountId });
  const payload = await zernioRequest(`/whatsapp/templates?${query.toString()}`, apiKey);
  const remoteTemplates = listAt(payload, 'templates');
  const { data: existingRows, error: readError } = await admin.from('zernio_whatsapp_templates')
    .select('*').eq('id_usuario', ownerId).eq('account_id', accountId);
  if (readError) throw new Error('Não foi possível ler os templates salvos.');
  const rows = remoteTemplates.map((template) => {
    const existing = existingRows?.find((row: JsonRecord) => row.name === template.name && row.language === template.language);
    return mapTemplate(template, accountId, ownerId, existing);
  }).filter(Boolean);
  if (rows.length) {
    const { error } = await admin.from('zernio_whatsapp_templates')
      .upsert(rows, { onConflict: 'id_usuario,account_id,name,language' });
    if (error) throw new Error('Os templates foram consultados, mas não foi possível atualizar o catálogo do SGA.');
  }
  const { data, error } = await admin.from('zernio_whatsapp_templates')
    .select('id,meta_template_id,name,language,category,status,rejection_reason,components,variable_mapping,purpose,is_default,last_synced_at')
    .eq('id_usuario', ownerId).eq('account_id', accountId).order('name').order('language');
  if (error) throw new Error('Não foi possível carregar os templates do SGA.');
  return data ?? [];
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
      ? `A Zernio/Meta recusou o template: ${details}.${requestRef}`
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

function billingTemplateParams(template: JsonRecord, tenantName: string, amount: number, dueDate: string, paymentLink: string): string[] {
  if (template.purpose !== 'charge' || !Array.isArray(template.variable_mapping)) {
    throw new PublicError('Este template não está configurado para cobrança no SGA.', 400);
  }
  const values: Record<string, string> = {
    tenant_first_name: tenantName.trim().split(/\s+/)[0],
    amount: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount),
    due_date: dueDatePtBr(dueDate),
    payment_link: paymentLink,
  };
  const mapping = [...template.variable_mapping].sort((a: JsonRecord, b: JsonRecord) => a.position - b.position);
  if (mapping.length !== 4 || mapping.some((item: JsonRecord, index: number) => item.position !== index + 1 || !values[item.field])) {
    throw new PublicError('O mapeamento deste template de cobrança está incompleto. Sincronize ou recrie o template.', 409);
  }
  return mapping.map((item: JsonRecord) => values[item.field]);
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
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const body = await req.json();
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const serviceCall = Boolean(serviceRoleKey) && authHeader === `Bearer ${serviceRoleKey}`;
    let user: { id: string } | null = null;
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    if (serviceCall) {
      if (body?.action !== 'send_charge' || !/^[0-9a-f-]{36}$/i.test(String(body?.ownerId || ''))) {
        return json({ error: 'Service credentials may only send an automatic charge for a specified owner.' }, 403);
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
    const { data: integration, error: integrationError } = await admin.from('zernio_integracoes')
      .select('*').eq('id_usuario', user.id).maybeSingle();
    if (integrationError || !integration?.api_key_ciphertext || integration.key_status !== 'valid') {
      return json({ error: 'Valide uma chave Zernio nas Configurações antes de continuar.' }, 409);
    }
    if (!integration.whatsapp_account_id || !integration.zernio_profile_id) {
      return json({ error: 'Conecte um canal WhatsApp da Zernio nas Configurações antes de continuar.' }, 409);
    }
    const accountId = integration.whatsapp_account_id as string;
    const apiKey = await decryptApiKey(integration.api_key_ciphertext, user.id);
    if (!/^[a-fA-F0-9]{24}$/.test(accountId)) return json({ error: 'Atualize a conexão do canal WhatsApp nas Configurações.' }, 409);
    const accountQuery = new URLSearchParams({ profileId: integration.zernio_profile_id });
    const accountsPayload = await zernioRequest(`/accounts?${accountQuery.toString()}`, apiKey);
    const remoteAccount = listAt(accountsPayload, 'accounts').find((item) => {
      if ((item._id ?? item.id) !== accountId || item.platform !== 'whatsapp' || item.isActive === false) return false;
      const profileId = typeof item.profileId === 'object' ? item.profileId?._id ?? item.profileId?.id : item.profileId;
      return !profileId || profileId === integration.zernio_profile_id;
    });
    if (!remoteAccount) return json({ error: 'O canal não está ativo no perfil Zernio selecionado. Reconecte-o nas Configurações.' }, 409);

    if (action === 'list') {
      return json({ templates: await syncTemplates(admin, apiKey, user.id, accountId) });
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
        .eq('id', templateId).eq('id_usuario', user.id).eq('account_id', accountId).maybeSingle();
      if (templateError || !template) return json({ error: 'O template não pertence a este locador ou canal.' }, 404);
      if (template.purpose !== 'general') return json({ error: 'Este template é reservado para o fluxo de cobrança.' }, 409);
      const liveTemplates = await syncTemplates(admin, apiKey, user.id, accountId);
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
      const messageId = result.messageId ?? result.message?.id;
      if (typeof messageId !== 'string' || !messageId) throw new PublicError('A Zernio não retornou a identificação da mensagem enviada.', 502);
      return json({ success: true, messageId });
    }

    if (action === 'create_template') {
      const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
      const language = typeof body.language === 'string' ? body.language.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim().toUpperCase() : '';
      const components = Array.isArray(body.components) ? body.components : [];
      const purpose = ['charge', 'payment_confirmation'].includes(body.purpose) ? body.purpose : 'general';
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
      if (purpose === 'charge' && (category !== 'UTILITY' || bodyVariables.length !== 4
        || bodyVariables.some((value: number, index: number) => value !== index + 1)
        || (String(header?.format).toUpperCase() === 'TEXT' && /\{\{\d+\}\}/.test(header.text))
        || buttons.some((item: JsonRecord) => String(item.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(item.url))))) {
        return json({ error: 'Para cobrança, use categoria UTILITY, as quatro variáveis do SGA no corpo e URL estática.' }, 400);
      }
      if (purpose === 'payment_confirmation' && (category !== 'UTILITY' || bodyVariables.length !== 3
        || bodyVariables.some((value: number, index: number) => value !== index + 1)
        || (String(header?.format).toUpperCase() === 'TEXT' && /\{\{\d+\}\}/.test(header.text))
        || buttons.some((item: JsonRecord) => String(item.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(item.url))))) {
        return json({ error: 'Para confirmação, use categoria UTILITY, {{1}}, {{2}} e {{3}} nessa ordem no corpo, sem variáveis fora dele.' }, 400);
      }
      const createPayload = await zernioRequest('/whatsapp/templates', apiKey, {
        method: 'POST',
        body: { accountId, name, category, language, components },
      });
      const remoteTemplate = createPayload.template ?? createPayload.data?.template;
      if (!remoteTemplate || typeof remoteTemplate.id !== 'string') {
        throw new PublicError('A Meta recebeu o pedido, mas a Zernio não retornou os dados do template. Atualize a lista.', 502);
      }
      const mapping = purpose === 'charge' ? [
        { position: 1, field: 'tenant_first_name' },
        { position: 2, field: 'amount' },
        { position: 3, field: 'due_date' },
        { position: 4, field: 'payment_link' },
      ] : purpose === 'payment_confirmation' ? [
        { position: 1, field: 'tenant_first_name' },
        { position: 2, field: 'amount' },
        { position: 3, field: 'paid_at' },
      ] : [];
      const row = mapTemplate(remoteTemplate, accountId, user.id, {
        purpose, variable_mapping: mapping, is_default: false,
      });
      if (!row) throw new PublicError('A Zernio não retornou uma identificação válida para o template.', 502);
      row.purpose = purpose;
      row.variable_mapping = mapping;
      const { data: saved, error: saveError } = await admin.from('zernio_whatsapp_templates')
        .upsert(row, { onConflict: 'id_usuario,account_id,name,language' })
        .select('id,meta_template_id,name,language,category,status,rejection_reason,components,variable_mapping,purpose,is_default,last_synced_at')
        .single();
      if (saveError || !saved) throw new Error('O template foi enviado à Meta, mas não foi possível salvá-lo no SGA. Atualize a lista.');
      return json({ template: saved });
    }

    if (action === 'set_default') {
      const templates = await syncTemplates(admin, apiKey, user.id, accountId);
      const selected = templates.find((item: JsonRecord) => item.id === body.templateId && ['charge', 'payment_confirmation'].includes(item.purpose));
      if (!selected) return json({ error: 'Selecione um template transacional deste canal.' }, 404);
      if (selected.status !== 'APPROVED') return json({ error: 'A Meta só permite usar templates com status APPROVED.' }, 409);
      const { error: clearError } = await admin.from('zernio_whatsapp_templates')
        .update({ is_default: false, updated_at: new Date().toISOString() }).eq('id_usuario', user.id).eq('purpose', selected.purpose).eq('is_default', true);
      if (clearError) throw new Error('Não foi possível atualizar o template padrão.');
      const { data: saved, error: saveError } = await admin.from('zernio_whatsapp_templates')
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq('id', selected.id).eq('id_usuario', user.id).eq('account_id', accountId).select('id').maybeSingle();
      if (saveError || !saved) throw new Error('Não foi possível selecionar o template padrão.');
      return json({ success: true, templates: await syncTemplates(admin, apiKey, user.id, accountId) });
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
        .eq('id', templateId).eq('id_usuario', user.id).eq('account_id', accountId).maybeSingle();
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
        .select('id,id_usuario,id_locatario,id_contrato,valor,data_vencimento,status,tipo,payment_link,mercado_pago_id,tentativas_envio')
        .eq('id', chargeId).eq('id_usuario', user.id).maybeSingle();
      if (chargeError || !charge) return json({ error: 'Cobrança não encontrada para este locador.' }, 404);
      if (!['pendente', 'atrasado'].includes(charge.status) || charge.tipo === 'despesa') {
        return json({ error: 'Somente cobranças de receita pendentes ou atrasadas podem ser enviadas.' }, 409);
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
                await admin.from('cobrancas').update({ status: 'pago', data_pagamento: new Date().toISOString() })
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
      const { data: selectedTemplate, error: templateError } = await admin.from('zernio_whatsapp_templates')
        .select('*').eq('id_usuario', user.id).eq('account_id', accountId).eq('is_default', true).eq('purpose', 'charge').maybeSingle();
      if (templateError || !selectedTemplate) return json({ error: 'Crie e aprove um template de cobrança na aba Templates Meta de /mensagens e selecione-o como padrão.' }, 409);

      const liveTemplates = await syncTemplates(admin, apiKey, user.id, accountId);
      const liveTemplate = liveTemplates.find((item: JsonRecord) => item.name === selectedTemplate.name && item.language === selectedTemplate.language);
      if (!liveTemplate || liveTemplate.status !== 'APPROVED' || liveTemplate.meta_template_id !== selectedTemplate.meta_template_id) {
        return json({ error: 'O template padrão não está aprovado pela Meta. Atualize a lista e escolha um template APPROVED.' }, 409);
      }

      const paymentLink = charge.payment_link || await generatePaymentLink(admin, user.id, charge, tenant);
      const participantId = phoneForWhatsApp(tenant.whatsapp);
      const params = billingTemplateParams(selectedTemplate, tenant.nome_completo, Number(charge.valor), charge.data_vencimento, paymentLink);
      const { data: priorDeliveries, error: priorError } = await admin.from('zernio_whatsapp_deliveries')
        .select('id,status,message_id,updated_at').eq('id_usuario', user.id).eq('id_cobranca', charge.id)
        .in('status', ['sending', 'sent']).order('created_at', { ascending: false }).limit(1);
      if (priorError) throw new Error('Não foi possível verificar o histórico de envio desta cobrança.');
      const priorDelivery = priorDeliveries?.[0];
      if (priorDelivery?.status === 'sent') {
        return json({ success: true, alreadySent: true, message: 'Esta cobrança já foi enviada pelo WhatsApp.', messageId: priorDelivery.message_id });
      }
      if (priorDelivery?.status === 'sending' && new Date(priorDelivery.updated_at).getTime() > Date.now() - 120000) {
        return json({ error: 'O envio desta cobrança já está em processamento. Aguarde alguns instantes.' }, 409);
      }
      let delivery: JsonRecord | null = null;
      const { data: inserted, error: insertError } = await admin.from('zernio_whatsapp_deliveries').insert({
        id_usuario: user.id, id_cobranca: charge.id, template_id: selectedTemplate.id, account_id: accountId,
        idempotency_key: crypto.randomUUID(), status: 'sending', meta_template_id: selectedTemplate.meta_template_id,
        template_name: selectedTemplate.name, template_language: selectedTemplate.language,
      }).select('*').maybeSingle();
      if (!insertError && inserted) delivery = inserted;
      else {
        const { data: existing, error: existingError } = await admin.from('zernio_whatsapp_deliveries')
          .select('*').eq('id_usuario', user.id).eq('id_cobranca', charge.id).eq('template_id', selectedTemplate.id).maybeSingle();
        if (existingError) throw new Error('Não foi possível consultar o histórico de envio.');
        if (!existing) {
          const { data: activeLog } = await admin.from('zernio_whatsapp_deliveries')
            .select('status').eq('id_usuario', user.id).eq('id_cobranca', charge.id)
            .in('status', ['sending', 'sent']).maybeSingle();
          if (activeLog?.status === 'sent') return json({ success: true, alreadySent: true, message: 'Esta cobrança já foi enviada pelo WhatsApp.' });
          if (activeLog?.status === 'sending') return json({ error: 'O envio desta cobrança já está em processamento. Aguarde alguns instantes.' }, 409);
          throw new Error('Não foi possível registrar a tentativa de envio.');
        }
        if (existing.status === 'sent') return json({ success: true, alreadySent: true, message: 'Este template já foi enviado para esta cobrança.', messageId: existing.message_id });
        if (existing.status === 'sending' && new Date(existing.updated_at).getTime() > Date.now() - 120000) {
          return json({ error: 'O envio desta cobrança já está em processamento. Aguarde alguns instantes.' }, 409);
        }
        const claimQuery = admin.from('zernio_whatsapp_deliveries').update({
          status: 'sending', safe_error: null, error_code: null, updated_at: new Date().toISOString(),
        }).eq('id', existing.id).eq('status', existing.status);
        if (existing.status === 'sending') claimQuery.lt('updated_at', new Date(Date.now() - 120000).toISOString());
        const { data: claimed, error: claimError } = await claimQuery.select('*').maybeSingle();
        if (claimError || !claimed) return json({ error: 'O envio está sendo processado por outra solicitação. Aguarde e atualize a tela.' }, 409);
        delivery = claimed;
      }
      if (!delivery) throw new Error('Não foi possível registrar a tentativa de envio.');
      claimedDeliveryId = delivery.id;
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
      const messageId = sentData.messageId ?? sentData.message?.id;
      const conversationId = sentData.conversationId ?? sentData.conversation?.id;
      if (typeof messageId !== 'string' || !messageId) {
        throw new PublicError('A Zernio aceitou o envio, mas não retornou o identificador da mensagem. O SGA manterá a tentativa protegida contra duplicidade.', 502);
      }
      const sentAt = new Date().toISOString();
      const { error: finishError } = await admin.from('zernio_whatsapp_deliveries').update({
        status: 'sent', message_id: messageId, conversation_id: typeof conversationId === 'string' ? conversationId : null,
        safe_error: null, error_code: null, sent_at: sentAt, updated_at: sentAt,
      }).eq('id', delivery.id).eq('status', 'sending');
      if (finishError) throw new Error('A Zernio enviou a mensagem, mas o SGA não conseguiu concluir a auditoria. Atualize a tela antes de tentar novamente.');
      claimedDeliveryId = null;
      await admin.from('cobrancas').update({
        tentativas_envio: Number(charge.tentativas_envio || 0) + 1, ultimo_lembrete_at: sentAt,
      }).eq('id', charge.id).eq('id_usuario', user.id);
      return json({ success: true, message: 'Link PIX enviado por um template aprovado da Meta.', messageId, paymentLink });
    }

    return json({ error: 'Ação não reconhecida.' }, 400);
  } catch (error) {
    let safeError: PublicError;
    if (error instanceof PublicError) safeError = error;
    else if (error instanceof ZernioError) safeError = safeZernioError(error);
    else safeError = new PublicError('Não foi possível concluir a operação. Confira as Configurações e tente novamente.', 500);
    if (claimedDeliveryId && admin) {
      const code = error instanceof ZernioError && error.code ? error.code : 'send_failed';
      await admin.from('zernio_whatsapp_deliveries').update({
        status: 'failed', error_code: code, safe_error: safeError.message, updated_at: new Date().toISOString(),
      }).eq('id', claimedDeliveryId).eq('status', 'sending');
    }
    return json({ error: safeError.message }, safeError.status);
  }
});
