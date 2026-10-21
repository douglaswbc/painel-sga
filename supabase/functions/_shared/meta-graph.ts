/**
 * Minimal WhatsApp Cloud API (Meta Graph API) client used by the
 * `meta-integration` Edge Function.
 *
 * Only the calls needed to connect and validate a landlord channel are
 * implemented here. Every response is sanitized before it reaches the
 * browser so access tokens never leak through error messages.
 */

const GRAPH_BASE = 'https://graph.facebook.com';

export const graphVersion = (): string => Deno.env.get('META_GRAPH_VERSION') || 'v23.0';

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  type: string | null;

  constructor(status: number, message: string, code: number | null = null, subcode: number | null = null, type: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.type = type;
  }
}

/** Removes tokens and authorization headers from provider messages. */
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
  const value = Deno.env.get('META_APP_SECRET') ?? '';
  if (!value) throw new Error('META_APP_SECRET não está configurado nos secrets do Supabase.');
  return value;
}

function appId(): string {
  const value = Deno.env.get('META_APP_ID') ?? '';
  if (!value) throw new Error('META_APP_ID não está configurado nos secrets do Supabase.');
  return value;
}

function parseError(status: number, payload: unknown): MetaApiError {
  const error = (payload as { error?: Record<string, unknown> } | null)?.error ?? {};
  const message = sanitizeProviderMessage(error.message) || `A Meta recusou a solicitação (HTTP ${status}).`;
  const code = typeof error.code === 'number' ? error.code : null;
  const subcode = typeof error.error_subcode === 'number' ? error.error_subcode : null;
  const type = typeof error.type === 'string' ? error.type.slice(0, 60) : null;
  return new MetaApiError(status, message, code, subcode, type);
}

async function graphFetch(
  path: string,
  options: { method?: string; token?: string; body?: unknown; query?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ payload: unknown; text: string }> {
  const query = new URLSearchParams(options.query ?? {});
  const url = `${GRAPH_BASE}/${graphVersion()}/${path.replace(/^\//, '')}${query.toString() ? `?${query.toString()}` : ''}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    });
  } catch {
    throw new MetaApiError(503, 'Não foi possível conectar à Meta agora. Tente novamente.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) throw parseError(response.status, payload);
  return { payload, text };
}

async function graphJson<T = Record<string, unknown>>(
  path: string,
  options: Parameters<typeof graphFetch>[1] = {},
): Promise<T> {
  const { payload } = await graphFetch(path, options);
  return (payload ?? {}) as T;
}

/** Endpoint returns the raw token as plain text, not JSON. */
async function graphToken(path: string, query: Record<string, string>): Promise<string> {
  const { text, payload } = await graphFetch(path, { query });
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  return text.trim();
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

/** Exchanges the Embedded Signup code for a business integration token. */
export async function exchangeCodeForBusinessToken(code: string): Promise<string> {
  const token = await graphToken('oauth/access_token', {
    client_id: appId(),
    client_secret: appSecret(),
    code,
  });
  if (!token) throw new MetaApiError(502, 'A Meta não retornou um token para este código de conexão.');
  return token;
}

/**
 * Tries to exchange the short-lived business token for a long-lived one.
 * Falls back to the original token when the exchange is not available.
 */
export async function exchangeForLongLivedToken(businessToken: string): Promise<string> {
  try {
    const token = await graphToken('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId(),
      client_secret: appSecret(),
      fb_exchange_token: businessToken,
    });
    return token || businessToken;
  } catch {
    return businessToken;
  }
}

/** Reads token metadata and the WABA ids that granted the app access. */
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
    const targets = Array.isArray((entry as { target_ids?: unknown }).target_ids) ? (entry as { target_ids: unknown[] }).target_ids : [];
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
  const payload = await graphJson<Record<string, unknown>>(`${wabaId}`, { token, query: { fields: 'id,name,message_template_namespace,owner_business_info' } });
  return payload;
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
    query: {
      fields: 'id,display_phone_number,verified_name,quality_rating,name_status,code_verification_status,whatsapp_business_manager_messaging_limit',
    },
  });
  return {
    id: String(payload.id ?? phoneNumberId),
    displayPhoneNumber: typeof payload.display_phone_number === 'string' ? payload.display_phone_number : null,
    verifiedName: typeof payload.verified_name === 'string' ? payload.verified_name : null,
    qualityRating: typeof payload.quality_rating === 'string' ? payload.quality_rating : null,
    nameStatus: typeof payload.name_status === 'string' ? payload.name_status : null,
    codeVerificationStatus: typeof payload.code_verification_status === 'string' ? payload.code_verification_status : null,
    messagingLimitTier: typeof payload.whatsapp_business_manager_messaging_limit === 'string'
      ? payload.whatsapp_business_manager_messaging_limit
      : null,
  };
}

/** Registers the number for Cloud API use and sets the two-step verification PIN. */
export async function registerPhoneNumber(phoneNumberId: string, pin: string, token: string): Promise<boolean> {
  const payload = await graphJson<{ success?: boolean }>(`${phoneNumberId}/register`, {
    method: 'POST',
    token,
    body: { messaging_product: 'whatsapp', pin },
  });
  return payload.success === true;
}

/** Subscribes the app to the WABA webhooks. */
export async function subscribeWaba(wabaId: string, token: string): Promise<boolean> {
  const payload = await graphJson<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { method: 'POST', token });
  return payload.success === true;
}

/** Friendly, non technical message for a Meta API failure. */
export function describeMetaError(error: unknown): string {
  if (!(error instanceof MetaApiError)) {
    return error instanceof Error ? error.message : 'Não foi possível concluir a operação na Meta.';
  }
  if (error.status === 400 && error.subcode === 33) {
    return 'A Meta não encontrou o objeto informado. Confira o Phone Number ID e o WABA ID.';
  }
  if (error.status === 400 && error.code === 100) {
    return 'A Meta recusou os dados informados. Revise o identificador e tente novamente.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'O token da Meta não autorizou esta operação. Gere um token com as permissões whatsapp_business_management e whatsapp_business_messaging.';
  }
  if (error.status === 404) {
    return 'A Meta não encontrou a conta do WhatsApp. Confira o ID do WABA e o Phone Number ID.';
  }
  if (error.status === 429) {
    return 'A Meta limitou temporariamente as chamadas. Aguarde e tente novamente.';
  }
  if (error.status >= 500) {
    return 'A Meta está temporariamente indisponível. Tente novamente em alguns instantes.';
  }
  return error.message;
}
