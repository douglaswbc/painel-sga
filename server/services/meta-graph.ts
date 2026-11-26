import { loadEnv } from '../config/env.js';

const GRAPH_BASE = 'https://graph.facebook.com';
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export function graphVersion(): string {
  const raw = (loadEnv().meta.graphVersion || 'v23.0').trim();
  const normalized = raw.startsWith('v') ? raw : `v${raw}`;
  return /\.\d+$/.test(normalized) ? normalized : `${normalized}.0`;
}

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  type: string | null;
  userMessage: string | null;
  userTitle: string | null;
  target: string | null;

  constructor(
    status: number,
    message: string,
    code: number | null = null,
    subcode: number | null = null,
    type: string | null = null,
    userMessage: string | null = null,
    userTitle: string | null = null,
    target: string | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.type = type;
    this.userMessage = userMessage;
    this.userTitle = userTitle;
    this.target = target;
  }
}

export function describeGraphTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const version = segments.shift() ?? '';
    const object = segments[0] ?? '';
    const resource = segments[1] ?? '';
    const name = parsed.searchParams.get('name');
    return [version, object, resource].filter(Boolean).join('/') + (name ? ` (${name})` : '');
  } catch {
    return 'requisição à Meta';
  }
}

export function sanitizeProviderMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [ocultado]')
    .replace(/\bEA[A-Za-z0-9]{10,}/g, '[token ocultado]')
    .replace(/\|[A-Za-z0-9]{10,}/g, '|[segredo ocultado]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 300);
}

function appSecret(): string {
  const value = loadEnv().meta.appSecret;
  if (!value) throw new Error('META_APP_SECRET não está configurado no .env.');
  return value;
}

function appId(): string {
  const value = loadEnv().meta.appId;
  if (!value) throw new Error('META_APP_ID não está configurado no .env.');
  return value;
}

function parseError(status: number, payload: unknown, target: string | null = null): MetaApiError {
  const error = (payload as { error?: Record<string, unknown> } | null)?.error ?? {};
  const message = sanitizeProviderMessage(error.message) || `A Meta recusou a solicitação (HTTP ${status}).`;
  const code = typeof error.code === 'number' ? error.code : null;
  const subcode = typeof error.error_subcode === 'number' ? error.error_subcode : null;
  const type = typeof error.type === 'string' ? error.type.slice(0, 60) : null;
  const userMessage = sanitizeProviderMessage(error.error_user_msg) || null;
  const userTitle = sanitizeProviderMessage(error.error_user_title) || null;
  return new MetaApiError(status, message, code, subcode, type, userMessage, userTitle, target);
}

async function graphFetchUrl(
  url: string,
  options: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
  attempt = 0,
): Promise<{ payload: unknown; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const method = options.method ?? 'GET';
  const retryable = attempt < 2 && (method === 'GET' || method === 'DELETE');

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    });
  } catch {
    if (retryable) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      return graphFetchUrl(url, options, attempt + 1);
    }
    throw new MetaApiError(503, 'Não foi possível conectar à Meta agora. Tente novamente.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    if (retryable && TRANSIENT_STATUSES.has(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      return graphFetchUrl(url, options, attempt + 1);
    }
    throw parseError(response.status, payload, describeGraphTarget(url));
  }
  return { payload, text };
}

async function graphFetch(
  path: string,
  options: { method?: string; token?: string; body?: unknown; query?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ payload: unknown; text: string }> {
  const query = new URLSearchParams(options.query ?? {});
  const url = `${GRAPH_BASE}/${graphVersion()}/${path.replace(/^\//, '')}${query.toString() ? `?${query.toString()}` : ''}`;
  return graphFetchUrl(url, options);
}

export async function graphJson<T = Record<string, unknown>>(
  path: string,
  options: Parameters<typeof graphFetch>[1] = {},
): Promise<T> {
  const { payload } = await graphFetch(path, options);
  return (payload ?? {}) as T;
}

export type MetaTokenInfo = {
  isValid: boolean;
  appId: string | null;
  userId: string | null;
  expiresAt: number | null;
  scopes: string[];
  wabaIds: string[];
};

export type MetaPhoneNumber = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
};

export type MetaPhoneNumberDetails = MetaPhoneNumber & {
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  messagingLimitTier: string | null;
};

export type MetaTemplateRecord = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  rejectionReason: string | null;
};

export async function debugToken(inputToken: string): Promise<MetaTokenInfo> {
  const payload = await graphJson<{ data?: Record<string, unknown> }>('debug_token', {
    token: inputToken,
    query: { input_token: inputToken, access_token: `${appId()}|${appSecret()}` },
  });
  const data = payload.data ?? {};
  const scopes = Array.isArray(data.scopes) ? data.scopes.filter((item): item is string => typeof item === 'string') : [];
  const wabaIds = new Set<string>();
  const granular = Array.isArray(data.granular_scopes) ? data.granular_scopes : [];
  for (const entry of granular) {
    const targets = Array.isArray((entry as { target_ids?: unknown }).target_ids)
      ? (entry as { target_ids: unknown[] }).target_ids
      : [];
    for (const target of targets) {
      if (typeof target === 'string' && /^[0-9]{10,20}$/.test(target)) wabaIds.add(target);
    }
  }
  return {
    isValid: data.is_valid !== false,
    appId: typeof data.app_id === 'string' ? data.app_id : null,
    userId: typeof data.user_id === 'string' ? data.user_id : null,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : null,
    scopes,
    wabaIds: [...wabaIds],
  };
}

export async function getWaba(wabaId: string, token: string): Promise<Record<string, unknown>> {
  return graphJson<Record<string, unknown>>(`${wabaId}`, {
    token,
    query: { fields: 'id,name,message_template_namespace,owner_business_info' },
  });
}

export async function listPhoneNumbers(wabaId: string, token: string): Promise<MetaPhoneNumber[]> {
  const payload = await graphJson<{ data?: Record<string, unknown>[] }>(`${wabaId}/phone_numbers`, {
    token,
    query: { fields: 'id,display_phone_number,verified_name,quality_rating' },
  });
  return (payload.data ?? [])
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: String(item.id),
      displayPhoneNumber: typeof item.display_phone_number === 'string' ? item.display_phone_number : null,
      verifiedName: typeof item.verified_name === 'string' ? item.verified_name : null,
      qualityRating: typeof item.quality_rating === 'string' ? item.quality_rating : null,
    }));
}

export async function getPhoneNumberDetails(phoneNumberId: string, token: string): Promise<MetaPhoneNumberDetails> {
  const payload = await graphJson<Record<string, unknown>>(phoneNumberId, {
    token,
    query: { fields: 'id,display_phone_number,verified_name,quality_rating,name_status,code_verification_status,messaging_limit_tier' },
  });
  return {
    id: String(payload.id ?? phoneNumberId),
    displayPhoneNumber: typeof payload.display_phone_number === 'string' ? payload.display_phone_number : null,
    verifiedName: typeof payload.verified_name === 'string' ? payload.verified_name : null,
    qualityRating: typeof payload.quality_rating === 'string' ? payload.quality_rating : null,
    nameStatus: typeof payload.name_status === 'string' ? payload.name_status : null,
    codeVerificationStatus: typeof payload.code_verification_status === 'string' ? payload.code_verification_status : null,
    messagingLimitTier: typeof payload.messaging_limit_tier === 'string' ? payload.messaging_limit_tier : null,
  };
}

export async function registerPhoneNumber(phoneNumberId: string, pin: string, token: string): Promise<boolean> {
  const payload = await graphJson<{ success?: boolean }>(`${phoneNumberId}/register`, {
    method: 'POST',
    token,
    body: { messaging_product: 'whatsapp', pin },
  });
  return payload.success !== false;
}

export async function listMessageTemplates(wabaId: string, token: string): Promise<MetaTemplateRecord[]> {
  const all: MetaTemplateRecord[] = [];
  let nextUrl: string | null = null;
  let pages = 0;

  while (pages < 25) {
    pages += 1;
    const payload: Record<string, unknown> = nextUrl
      ? (((await graphFetchUrl(nextUrl, { token })).payload as Record<string, unknown>) ?? {})
      : await graphJson<Record<string, unknown>>(`${wabaId}/message_templates`, {
          token,
          query: { fields: 'id,name,language,category,status,components,rejected_reason', limit: '100' },
        });
    const rows = Array.isArray(payload.data) ? (payload.data as Record<string, unknown>[]) : [];
    for (const item of rows) {
      if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.language !== 'string') continue;
      all.push({
        id: item.id,
        name: item.name,
        language: item.language,
        category: String(item.category ?? 'UTILITY').toUpperCase(),
        status: String(item.status ?? 'PENDING').toUpperCase(),
        components: Array.isArray(item.components) ? item.components : [],
        rejectionReason: typeof item.rejected_reason === 'string' ? item.rejected_reason : null,
      });
    }
    const nextUrlValue = (payload.paging as { next?: unknown } | undefined)?.next;
    if (typeof nextUrlValue !== 'string' || !nextUrlValue.startsWith(GRAPH_BASE)) break;
    nextUrl = nextUrlValue;
  }

  return all;
}

export async function createMessageTemplate(
  wabaId: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; status: string; category: string }> {
  const result = await graphJson<Record<string, unknown>>(`${wabaId}/message_templates`, {
    method: 'POST',
    token,
    body: payload,
  });
  const id = typeof result.id === 'string' ? result.id : null;
  if (!id) throw new MetaApiError(502, 'A Meta não retornou a identificação do template criado.');
  return {
    id,
    status: typeof result.status === 'string' ? result.status.toUpperCase() : 'PENDING',
    category: typeof result.category === 'string' ? result.category.toUpperCase() : 'UTILITY',
  };
}

export async function editMessageTemplate(
  templateId: string,
  token: string,
  components: unknown[],
  category?: string,
): Promise<boolean> {
  const payload: Record<string, unknown> = { components };
  if (category) payload.category = category;
  const result = await graphJson<{ success?: boolean }>(templateId, {
    method: 'POST',
    token,
    body: payload,
  });
  return result.success !== false;
}

export async function deleteMessageTemplate(
  wabaId: string,
  token: string,
  name: string,
  hsmId: string | null,
): Promise<boolean> {
  const query: Record<string, string> = { name };
  if (hsmId) query.hsm_id = hsmId;
  const result = await graphJson<{ success?: boolean }>(`${wabaId}/message_templates`, {
    method: 'DELETE',
    token,
    query,
  });
  return result.success !== false;
}

export function describeMetaError(error: unknown): string {
  if (!(error instanceof MetaApiError)) {
    return error instanceof Error ? error.message : 'Não foi possível concluir a operação na Meta.';
  }
  const where = error.target ? ` em ${error.target}` : '';
  if (error.code === 131042) {
    return 'A Meta recusou o envio por problema no método de pagamento da conta WhatsApp Business. Regularize no Meta Business Suite para voltar a enviar mensagens.';
  }
  if (error.code === 131044 || error.code === 368 || error.code === 131031 || error.code === 130497) {
    return 'A conta WhatsApp Business está bloqueada ou restrita pela Meta. Confira a saúde da conta no WhatsApp Manager e regularize para retomar os envios.';
  }
  if (error.code === 190 || error.code === 102 || error.status === 401) {
    return 'O token da Meta expirou ou foi invalidado. Gere um novo token e salve novamente em Configurações.';
  }
  if (error.status === 400 && error.subcode === 2388024) {
    return 'Já existe um template com esse nome e idioma nesta conta. Escolha outro nome ou apague o template existente.';
  }
  if (error.status === 400 && error.subcode === 2388299) {
    return 'A Meta não aceita variáveis no início ou no fim do corpo da mensagem. Reescreva o texto.';
  }
  if (error.status === 400 && error.subcode === 2388293) {
    return 'A Meta achou o corpo curto demais para o número de variáveis. Reduza as variáveis ou amplie a mensagem.';
  }
  if (/uma vez a cada 24 horas|once every 24 hours/i.test(`${error.message} ${error.userMessage ?? ''}`)) {
    return 'A Meta permite editar cada template aprovado apenas uma vez a cada 24 horas. Tente novamente depois desse prazo.';
  }
  if (/(10|dez)\s*(vezes|times).*(30|trinta)/i.test(`${error.message} ${error.userMessage ?? ''}`)) {
    return 'A Meta limita a 10 edições de template em 30 dias. Aguarde para editar este template novamente.';
  }
  if (error.subcode === 2593002 || /modelo de mensagem n[ãa]o encontrado|message template .*not found/i.test(error.userMessage ?? '')) {
    return `${error.userMessage || 'A Meta não encontrou este template na conta.'} Atualize a lista em Templates Meta e escolha outro template aprovado.`;
  }
  if (error.status === 400 && error.subcode === 33) {
    return `A Meta não encontrou o objeto${where}. Confira o Phone Number ID e o WABA ID.`;
  }
  if (error.status === 400 && error.code === 2500) {
    return `A Meta não reconheceu o caminho da chamada${where}. Confira o identificador usado e a versão da API.`;
  }
  if (error.status === 400 && /unsupported (get|post) request/i.test(error.message)) {
    return `A Meta não encontrou o objeto${where}. Confira o Phone Number ID, o WABA ID e as permissões do token.`;
  }
  if (error.status === 400 && error.code === 100) {
    return error.userMessage
      ? `A Meta recusou a solicitação${where}: ${error.userMessage}`
      : `A Meta recusou os dados enviados${where}. Revise o template, o número de destino e os parâmetros.`;
  }
  if (error.status === 401 || error.status === 403) {
    return 'O token da Meta não autorizou esta operação. Gere um token com as permissões whatsapp_business_management e whatsapp_business_messaging.';
  }
  if (error.status === 404) {
    return `A Meta não encontrou o recurso${where}. Confira o Phone Number ID, o WABA ID e se o template ainda existe na conta.`;
  }
  if (error.status === 429) {
    return 'A Meta limitou temporariamente as chamadas. Aguarde e tente novamente.';
  }
  if (error.status >= 500) {
    return 'A Meta está temporariamente indisponível. Tente novamente em alguns instantes.';
  }
  return error.message;
}

export function metaErrorDetail(error: unknown): string | null {
  if (!(error instanceof MetaApiError)) return null;
  const parts = [`HTTP ${error.status}`];
  if (error.code !== null) parts.push(`code ${error.code}`);
  if (error.subcode !== null) parts.push(`subcode ${error.subcode}`);
  if (error.target) parts.push(error.target);
  const provider = sanitizeProviderMessage(error.userMessage || error.message);
  if (provider) parts.push(provider);
  return parts.join(' · ').slice(0, 300);
}
