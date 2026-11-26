import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { decryptSecret, encryptSecret, sha256Hex } from '../utils/crypto.js';
import { PublicError, ZERNIO_API } from './whatsapp-sender.js';
import {
  activateProvider,
  assertActiveLandlord,
  getIntegrationRow,
  lockWebhookUrl,
  publicIntegration,
} from './whatsapp-provider.js';

type JsonRecord = Record<string, any>;

export type ZernioAccount = {
  id: string;
  name: string;
  phoneNumber: string | null;
  active: boolean;
};

export type ZernioProfile = {
  id: string;
  name: string;
  accounts: ZernioAccount[];
};

class ZernioRequestError extends Error {
  status: number;
  constructor(status: number) {
    super('Não foi possível concluir a solicitação na Zernio.');
    this.status = status;
  }
}

async function zernioGet(path: string, apiKey: string, allow404 = false): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new PublicError('Não foi possível conectar à Zernio agora. Tente novamente.', 503);
  }

  if (allow404 && response.status === 404) return { __notFound: true };
  if (!response.ok) throw new ZernioRequestError(response.status);

  try {
    return (await response.json()) as JsonRecord;
  } catch {
    throw new PublicError('A Zernio retornou uma resposta inesperada.', 502);
  }
}

async function zernioWrite(
  path: string,
  apiKey: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: JsonRecord,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new PublicError(
      method === 'DELETE'
        ? 'Não foi possível conectar à Zernio. Tente novamente.'
        : 'Não foi possível configurar o webhook Zernio agora.',
      503,
    );
  }

  if (method === 'DELETE' && response.status === 404) return {};
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) throw new ZernioRequestError(response.status);
  return payload;
}

function mapZernioError(error: unknown, context: 'integration' | 'onboarding'): PublicError {
  if (error instanceof PublicError) return error;
  if (error instanceof ZernioRequestError) {
    if (context === 'onboarding') {
      if (error.status === 401 || error.status === 403) {
        return new PublicError('A chave Zernio não autorizou esta operação. Valide-a nas Configurações.', 400);
      }
      if (error.status === 402) {
        return new PublicError('A conta Zernio precisa resolver uma pendência de cobrança antes de continuar.', 400);
      }
      if (error.status === 409) {
        return new PublicError(
          'A Zernio encontrou um conflito com este perfil ou número. Confira a mensagem e tente novamente.',
          400,
        );
      }
      if (error.status === 429) {
        return new PublicError('A Zernio limitou temporariamente as consultas. Aguarde e tente novamente.', 429);
      }
      if (error.status >= 500) {
        return new PublicError('A Zernio está temporariamente indisponível. Tente novamente.', 503);
      }
      return new PublicError('A Zernio recusou a solicitação de conexão.', 400);
    }

    if (error.status === 401 || error.status === 403) {
      return new PublicError(
        'A chave Zernio é inválida ou não tem permissão para listar perfis e canais.',
        error.status === 401 ? 401 : 400,
      );
    }
    if (error.status === 429) {
      return new PublicError('A Zernio limitou temporariamente as consultas. Aguarde e tente novamente.', 429);
    }
    if (error.status >= 500) {
      return new PublicError('A Zernio está temporariamente indisponível. Tente novamente.', 503);
    }
    return new PublicError('Não foi possível consultar perfis e canais na Zernio.', 400);
  }
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
  return new PublicError(message, 400);
}

function arrayAt(payload: JsonRecord, key: string): JsonRecord[] {
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  return [];
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as JsonRecord;
    return typeof obj._id === 'string' ? obj._id : typeof obj.id === 'string' ? obj.id : null;
  }
  return null;
}

function normalizeProfile(profile: JsonRecord): Omit<ZernioProfile, 'accounts'> | null {
  const id = profile?._id ?? profile?.id;
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) return null;
  return { id, name: String(profile.name ?? profile.displayName ?? 'Perfil Zernio') };
}

function normalizeAccount(account: JsonRecord): ZernioAccount | null {
  const id = account?._id ?? account?.id;
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) return null;
  const meta = account.metadata ?? account.platformSpecificData?.whatsapp ?? {};
  return {
    id,
    name: String(account.displayName ?? account.name ?? account.username ?? 'Canal WhatsApp'),
    phoneNumber: account.phoneNumber ?? meta.phoneNumber ?? account.username ?? null,
    active: account.isActive !== false,
  };
}

async function getProfilesAndWhatsAppAccounts(apiKey: string): Promise<ZernioProfile[]> {
  const profilePayload = await zernioGet('/profiles', apiKey);
  const profiles = arrayAt(profilePayload, 'profiles')
    .map(normalizeProfile)
    .filter((profile): profile is Omit<ZernioProfile, 'accounts'> => Boolean(profile));

  return Promise.all(
    profiles.map(async (profile) => {
      const query = new URLSearchParams({ profileId: profile.id });
      const accountsPayload = await zernioGet(`/accounts?${query.toString()}`, apiKey);
      const accounts = arrayAt(accountsPayload, 'accounts')
        .filter((account) => account.platform === 'whatsapp')
        .map(normalizeAccount)
        .filter((account): account is ZernioAccount => Boolean(account));
      return { ...profile, accounts };
    }),
  );
}

function newWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function provisionLockWebhookInternal(
  integration: JsonRecord,
  apiKey: string,
  ownerId: string,
  accountId: string,
): Promise<string> {
  const secret = newWebhookSecret();
  const url = lockWebhookUrl();
  const body: JsonRecord = {
    name: `SGA lock access ${ownerId}`,
    url,
    secret,
    events: ['message.received'],
    accountIds: [accountId],
  };
  const method = integration?.webhook_id ? 'PUT' : 'POST';
  if (integration?.webhook_id) body.webhookId = integration.webhook_id;

  const payload = await zernioWrite('/webhooks/settings', apiKey, method, body);
  const webhook = payload.webhook ?? payload.data?.webhook;
  const webhookId = webhook?._id ?? webhook?.id ?? integration?.webhook_id;
  if (typeof webhookId !== 'string' || !webhookId) {
    throw new PublicError('A Zernio não retornou a identificação do webhook.', 502);
  }

  const ciphertext = encryptSecret(secret, ownerId, 'zernio');
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE zernio_integracoes
       SET webhook_id = ?, webhook_secret_ciphertext = ?, webhook_account_id = ?, updated_at = ?
       WHERE id_usuario = ?`,
    )
    .run(webhookId, ciphertext, accountId, new Date().toISOString(), ownerId);

  if (result.changes === 0) {
    throw new PublicError(
      'O webhook foi criado na Zernio, mas não foi possível salvar sua configuração no SGA.',
      500,
    );
  }
  return webhookId;
}

function callbackMessage(errorCode: string): { status: 'cancelled' | 'failed'; message: string } {
  switch (errorCode) {
    case 'connection_cancelled':
    case 'oauth_denied':
      return { status: 'cancelled', message: 'A conexão foi cancelada. Nenhum canal foi alterado.' };
    case 'one_whatsapp_per_profile':
      return {
        status: 'failed',
        message: 'Este perfil já possui um canal WhatsApp. Reconecte o canal existente ou escolha outro perfil.',
      };
    case 'whatsapp_number_already_connected':
      return { status: 'failed', message: 'Este número já está conectado a outra conta ou equipe Zernio.' };
    case 'whatsapp_number_pinned_to_profile':
      return {
        status: 'failed',
        message: 'Este número pertence a outro perfil Zernio. Selecione o perfil ao qual ele está vinculado.',
      };
    case 'payment_required':
      return {
        status: 'failed',
        message: 'A Zernio solicitou uma configuração de cobrança antes de conectar o WhatsApp.',
      };
    case 'session_expired':
    case 'invalid_state':
      return { status: 'failed', message: 'A sessão de conexão expirou. Inicie o onboarding novamente.' };
    default:
      return {
        status: 'failed',
        message: 'A Meta ou a Zernio não concluiu a conexão. Revise os dados e tente novamente.',
      };
  }
}

export function getZernioStatus(ownerId: string) {
  assertActiveLandlord(ownerId);
  const integration = getIntegrationRow(ownerId);
  return { integration: publicIntegration(integration) };
}

export function activateZernioProvider(ownerId: string) {
  assertActiveLandlord(ownerId);
  const integration = getIntegrationRow(ownerId);
  if (
    !integration?.api_key_ciphertext ||
    integration?.key_status !== 'valid' ||
    !integration?.whatsapp_account_id
  ) {
    throw new PublicError('Conecte um canal da Zernio antes de usá-lo como canal principal.', 409);
  }
  activateProvider(ownerId, 'zernio');
  return { integration: publicIntegration(getIntegrationRow(ownerId)) };
}

export function removeZernioKey(ownerId: string) {
  assertActiveLandlord(ownerId);
  const integration = getIntegrationRow(ownerId);
  const keepMeta = Boolean(integration?.meta_access_token_ciphertext) && Boolean(integration?.meta_phone_number_id);
  const now = new Date().toISOString();

  if (integration) {
    const nextProvider =
      integration.provider === 'zernio' && keepMeta ? 'meta' : (integration.provider ?? 'zernio');
    const nextConnectedAt =
      integration.provider === 'zernio' ? (keepMeta ? now : null) : (integration.provider_connected_at ?? null);

    getDb()
      .prepare(
        `UPDATE zernio_integracoes
         SET api_key_ciphertext = NULL,
             api_key_last4 = NULL,
             key_status = NULL,
             zernio_profile_id = NULL,
             zernio_profile_name = NULL,
             whatsapp_account_id = NULL,
             whatsapp_account_name = NULL,
             whatsapp_phone_number = NULL,
             webhook_id = NULL,
             webhook_secret_ciphertext = NULL,
             webhook_account_id = NULL,
             provider = ?,
             provider_connected_at = ?,
             updated_at = ?
         WHERE id_usuario = ?`,
      )
      .run(nextProvider, nextConnectedAt, now, ownerId);
  }

  return { integration: publicIntegration(getIntegrationRow(ownerId)) };
}

export async function validateZernioKey(ownerId: string, apiKey: unknown) {
  assertActiveLandlord(ownerId);
  if (typeof apiKey !== 'string' || !/^sk_[a-fA-F0-9]{64}$/.test(apiKey.trim())) {
    throw new PublicError('A chave precisa estar no formato sk_ seguido de 64 caracteres hexadecimais.', 400);
  }

  const cleanApiKey = apiKey.trim();
  let profiles: ZernioProfile[];
  try {
    profiles = await getProfilesAndWhatsAppAccounts(cleanApiKey);
  } catch (error) {
    throw mapZernioError(error, 'integration');
  }

  const ciphertext = encryptSecret(cleanApiKey, ownerId, 'zernio');
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare(
    `INSERT INTO zernio_integracoes (
      id, id_usuario, api_key_ciphertext, api_key_last4, key_status,
      zernio_profile_id, zernio_profile_name, whatsapp_account_id, whatsapp_account_name, whatsapp_phone_number,
      validated_at, last_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'valid', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT (id_usuario) DO UPDATE SET
      api_key_ciphertext = excluded.api_key_ciphertext,
      api_key_last4 = excluded.api_key_last4,
      key_status = 'valid',
      zernio_profile_id = NULL,
      zernio_profile_name = NULL,
      whatsapp_account_id = NULL,
      whatsapp_account_name = NULL,
      whatsapp_phone_number = NULL,
      validated_at = excluded.validated_at,
      last_checked_at = excluded.last_checked_at,
      updated_at = excluded.updated_at`,
  ).run(crypto.randomUUID(), ownerId, ciphertext, cleanApiKey.slice(-4), now, now, now, now);

  const saved = getIntegrationRow(ownerId);
  if (!saved) {
    throw new PublicError('A chave foi validada, mas não foi possível salvá-la. Tente novamente.', 500);
  }
  return { integration: publicIntegration(saved), profiles };
}

function requireSavedZernioKey(ownerId: string): { integration: JsonRecord; apiKey: string } {
  const integration = getIntegrationRow(ownerId);
  if (!integration?.api_key_ciphertext) {
    throw new PublicError('Cadastre e valide uma chave Zernio primeiro.', 409);
  }
  return {
    integration,
    apiKey: decryptSecret(String(integration.api_key_ciphertext), ownerId),
  };
}

export async function refreshZernioProfiles(ownerId: string) {
  assertActiveLandlord(ownerId);
  const { apiKey } = requireSavedZernioKey(ownerId);
  const db = getDb();

  try {
    const profiles = await getProfilesAndWhatsAppAccounts(apiKey);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE zernio_integracoes SET key_status = 'valid', last_checked_at = ?, updated_at = ? WHERE id_usuario = ?`,
    ).run(now, now, ownerId);
    return { integration: publicIntegration(getIntegrationRow(ownerId)), profiles };
  } catch (error) {
    if (error instanceof ZernioRequestError && (error.status === 401 || error.status === 403)) {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE zernio_integracoes SET key_status = 'invalid', last_checked_at = ?, updated_at = ? WHERE id_usuario = ?`,
      ).run(now, now, ownerId);
    }
    throw mapZernioError(error, 'integration');
  }
}

export async function selectZernioChannel(ownerId: string, profileId: unknown, accountId: unknown) {
  assertActiveLandlord(ownerId);
  const { integration, apiKey } = requireSavedZernioKey(ownerId);

  if (typeof profileId !== 'string' || typeof accountId !== 'string') {
    throw new PublicError('Selecione um perfil e um canal WhatsApp.', 400);
  }

  let profiles: ZernioProfile[];
  try {
    profiles = await getProfilesAndWhatsAppAccounts(apiKey);
  } catch (error) {
    throw mapZernioError(error, 'integration');
  }

  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const selectedAccount = selectedProfile?.accounts.find((account) => account.id === accountId && account.active);
  if (!selectedProfile || !selectedAccount) {
    throw new PublicError(
      'Esse canal não está disponível para a chave e o perfil selecionados. Atualize a lista e tente novamente.',
      400,
    );
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE zernio_integracoes
       SET zernio_profile_id = ?,
           zernio_profile_name = ?,
           whatsapp_account_id = ?,
           whatsapp_account_name = ?,
           whatsapp_phone_number = ?,
           last_checked_at = ?,
           updated_at = ?
       WHERE id_usuario = ?`,
    )
    .run(
      selectedProfile.id,
      selectedProfile.name,
      selectedAccount.id,
      selectedAccount.name,
      selectedAccount.phoneNumber,
      now,
      now,
      ownerId,
    );

  let webhookWarning: string | null = null;
  try {
    await provisionLockWebhookInternal(integration, apiKey, ownerId, selectedAccount.id);
  } catch (webhookError) {
    webhookWarning =
      webhookError instanceof Error
        ? `Canal salvo; o webhook das fechaduras ainda não foi configurado: ${webhookError.message}`
        : 'Canal salvo; o webhook das fechaduras ainda não foi configurado.';
  }

  return { integration: publicIntegration(getIntegrationRow(ownerId)), webhookWarning };
}

export async function provisionZernioWebhook(ownerId: string) {
  assertActiveLandlord(ownerId);
  const { integration, apiKey } = requireSavedZernioKey(ownerId);
  if (!integration.whatsapp_account_id) {
    throw new PublicError('Selecione um canal WhatsApp da Zernio antes de configurar o webhook.', 409);
  }
  try {
    const webhookId = await provisionLockWebhookInternal(
      integration,
      apiKey,
      ownerId,
      String(integration.whatsapp_account_id),
    );
    return {
      success: true,
      webhookId,
      webhookUrl: lockWebhookUrl(),
      integration: publicIntegration(getIntegrationRow(ownerId)),
    };
  } catch (error) {
    throw mapZernioError(error, 'integration');
  }
}

function requireValidZernioIntegrationForOnboarding(ownerId: string): {
  integration: JsonRecord;
  apiKey: string;
} {
  assertActiveLandlord(ownerId, 'Esta operação está disponível para contas ativas de locador.');
  const integration = getIntegrationRow(ownerId);
  if (!integration?.api_key_ciphertext || integration.key_status !== 'valid') {
    throw new PublicError('Valide uma chave Zernio nas Configurações antes de conectar o WhatsApp.', 409);
  }
  return {
    integration,
    apiKey: decryptSecret(String(integration.api_key_ciphertext), ownerId),
  };
}

export async function startZernioOnboarding(
  ownerId: string,
  body: { profileId?: unknown; onboardingMode?: unknown },
) {
  const { integration, apiKey } = requireValidZernioIntegrationForOnboarding(ownerId);

  const onboardingMode = body.onboardingMode;
  if (onboardingMode !== 'api' && onboardingMode !== 'business_app') {
    throw new PublicError('Escolha explicitamente o modo de conexão do WhatsApp.', 400);
  }

  const requestedProfileId =
    typeof body.profileId === 'string' && body.profileId ? body.profileId : integration.zernio_profile_id;
  if (typeof requestedProfileId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(requestedProfileId)) {
    throw new PublicError('Atualize a lista e escolha um perfil Zernio.', 400);
  }
  if (integration.whatsapp_account_id && requestedProfileId !== integration.zernio_profile_id) {
    throw new PublicError('Desconecte o canal atual antes de iniciar a conexão em outro perfil.', 409);
  }

  let profilePayload: JsonRecord;
  try {
    profilePayload = await zernioGet('/profiles', apiKey);
  } catch (error) {
    throw mapZernioError(error, 'onboarding');
  }

  const availableProfile = arrayAt(profilePayload, 'profiles').find((item) => idOf(item) === requestedProfileId);
  if (!availableProfile) {
    throw new PublicError('O perfil não está disponível para esta chave Zernio. Atualize a lista.', 400);
  }

  const baseUrl = loadEnv().urls.zernioRedirectBase;
  let callbackUrl: URL;
  try {
    const configuredUrl = new URL(baseUrl);
    const localDevelopment = ['localhost', '127.0.0.1'].includes(configuredUrl.hostname);
    const secureOrigin =
      configuredUrl.protocol === 'https:' || (localDevelopment && configuredUrl.protocol === 'http:');
    if (
      !secureOrigin ||
      configuredUrl.search ||
      configuredUrl.hash ||
      configuredUrl.username ||
      configuredUrl.password
    ) {
      throw new Error('invalid');
    }
    callbackUrl = new URL('/zernio/callback', configuredUrl.origin);
  } catch {
    throw new PublicError('Configure APP_PUBLIC_URL / ZERNIO_REDIRECT_BASE_URL com o domínio do SGA.', 500);
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const stateHash = sha256Hex(state);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 70 * 60 * 1000).toISOString();
  const db = getDb();

  db.prepare(
    `UPDATE zernio_onboarding_sessions
     SET status = 'cancelled', callback_error = 'superseded', completed_at = ?
     WHERE id_usuario = ? AND zernio_profile_id = ? AND status = 'pending'`,
  ).run(nowIso, ownerId, requestedProfileId);

  const sessionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO zernio_onboarding_sessions (
      id, id_usuario, state_hash, zernio_profile_id, onboarding_mode, status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(sessionId, ownerId, stateHash, requestedProfileId, onboardingMode, expiresAt, nowIso);

  callbackUrl.searchParams.set('sga_state', state);
  const query = new URLSearchParams({
    profileId: requestedProfileId,
    redirect_url: callbackUrl.toString(),
    onboarding: onboardingMode,
  });

  let connectPayload: JsonRecord;
  try {
    connectPayload = await zernioGet(`/connect/whatsapp?${query.toString()}`, apiKey);
  } catch (error) {
    db.prepare(
      `UPDATE zernio_onboarding_sessions
       SET status = 'failed', callback_error = 'connect_url_failed', completed_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), sessionId);
    throw mapZernioError(error, 'onboarding');
  }

  const authUrl = connectPayload.authUrl;
  let authHost = '';
  try {
    authHost = new URL(authUrl).hostname;
  } catch {
    // URL inválida
  }

  if (
    typeof authUrl !== 'string' ||
    !authUrl.startsWith('https://') ||
    !(authHost === 'facebook.com' || authHost.endsWith('.facebook.com'))
  ) {
    db.prepare(
      `UPDATE zernio_onboarding_sessions
       SET status = 'failed', callback_error = 'invalid_connect_url', completed_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), sessionId);
    throw new PublicError('A Zernio não retornou um endereço de conexão válido.', 400);
  }

  return { authUrl, expiresAt, onboardingMode };
}

export async function completeZernioOnboarding(
  ownerId: string,
  body: {
    sgaState?: unknown;
    connected?: unknown;
    callbackProfileId?: unknown;
    accountId?: unknown;
    callbackError?: unknown;
    platform?: unknown;
  },
) {
  const { apiKey } = requireValidZernioIntegrationForOnboarding(ownerId);
  const { sgaState, connected, callbackProfileId, accountId, callbackError, platform } = body;

  if (typeof sgaState !== 'string' || sgaState.length < 40 || sgaState.length > 100) {
    throw new PublicError('O estado de retorno está ausente ou inválido. Inicie a conexão novamente.', 400);
  }

  const stateHash = sha256Hex(sgaState);
  const db = getDb();
  const session = db
    .prepare(
      `SELECT id, zernio_profile_id, onboarding_mode, status, expires_at
       FROM zernio_onboarding_sessions
       WHERE id_usuario = ? AND state_hash = ?`,
    )
    .get(ownerId, stateHash) as
    | {
        id: string;
        zernio_profile_id: string;
        onboarding_mode: string;
        status: string;
        expires_at: string;
      }
    | undefined;

  if (!session) {
    throw new PublicError('Este retorno não pertence à sua sessão. Inicie o onboarding pelo SGA.', 403);
  }

  if (session.status === 'completed' && callbackProfileId === session.zernio_profile_id) {
    const current = getIntegrationRow(ownerId);
    if (current?.whatsapp_account_id && current.whatsapp_account_id === accountId) {
      return { outcome: 'completed', integration: publicIntegration(current) };
    }
  }

  if (session.status !== 'pending' || new Date(session.expires_at).getTime() <= Date.now()) {
    throw new PublicError('Este estado já foi usado ou expirou. Inicie um novo onboarding.', 409);
  }

  const now = new Date().toISOString();
  const claim = db
    .prepare(
      `UPDATE zernio_onboarding_sessions
       SET status = 'processing'
       WHERE id = ? AND id_usuario = ? AND status = 'pending' AND expires_at > ?`,
    )
    .run(session.id, ownerId, now);

  if (claim.changes === 0) {
    throw new PublicError('Este estado já foi usado ou expirou. Inicie um novo onboarding.', 409);
  }

  let claimedSessionId: string | null = session.id;
  try {
    if (typeof callbackError === 'string' && callbackError) {
      const callbackResult = callbackMessage(callbackError);
      db.prepare(
        `UPDATE zernio_onboarding_sessions
         SET status = ?, callback_error = ?, completed_at = ?
         WHERE id = ?`,
      ).run(callbackResult.status, callbackError.slice(0, 80), new Date().toISOString(), session.id);
      claimedSessionId = null;
      return { outcome: callbackResult.status, message: callbackResult.message };
    }

    if (
      connected !== 'whatsapp' ||
      (platform && platform !== 'whatsapp') ||
      callbackProfileId !== session.zernio_profile_id ||
      typeof accountId !== 'string' ||
      !/^[a-fA-F0-9]{24}$/.test(accountId)
    ) {
      throw new PublicError(
        'O retorno da Meta não corresponde ao perfil e à plataforma esperados. Inicie um novo onboarding.',
        400,
      );
    }

    const query = new URLSearchParams({ profileId: session.zernio_profile_id });
    const accountsPayload = await zernioGet(`/accounts?${query.toString()}`, apiKey);
    const remoteAccount = arrayAt(accountsPayload, 'accounts').find((account) => {
      if ((account._id ?? account.id) !== accountId || account.platform !== 'whatsapp' || account.isActive === false) {
        return false;
      }
      const remoteProfileId = idOf(account.profileId);
      return !remoteProfileId || remoteProfileId === session.zernio_profile_id;
    });
    if (!remoteAccount) {
      throw new PublicError(
        'A Zernio ainda não confirmou esse canal no perfil selecionado. Atualize a conexão ou tente novamente.',
        400,
      );
    }

    const profilePayload = await zernioGet('/profiles', apiKey);
    const remoteProfile = arrayAt(profilePayload, 'profiles').find(
      (item) => idOf(item) === session.zernio_profile_id,
    );
    if (!remoteProfile) {
      throw new PublicError('O perfil da conexão não está mais acessível por esta chave Zernio.', 400);
    }

    const nowCompleted = new Date().toISOString();
    const phoneNumber =
      remoteAccount.selectedPhoneNumber ?? remoteAccount.phoneNumber ?? remoteAccount.username ?? null;
    const accountName = remoteAccount.displayName ?? remoteAccount.name ?? remoteAccount.username ?? 'Canal WhatsApp';

    const updateInteg = db
      .prepare(
        `UPDATE zernio_integracoes
         SET key_status = 'valid',
             zernio_profile_id = ?,
             zernio_profile_name = ?,
             whatsapp_account_id = ?,
             whatsapp_account_name = ?,
             whatsapp_phone_number = ?,
             last_checked_at = ?,
             updated_at = ?
         WHERE id_usuario = ?`,
      )
      .run(
        session.zernio_profile_id,
        remoteProfile.name ?? remoteProfile.displayName ?? 'Perfil Zernio',
        accountId,
        accountName,
        phoneNumber,
        nowCompleted,
        nowCompleted,
        ownerId,
      );

    if (updateInteg.changes === 0) {
      throw new PublicError(
        'A Meta conectou o número, mas o SGA não conseguiu salvar o canal. Atualize as Configurações.',
        500,
      );
    }

    const finish = db
      .prepare(
        `UPDATE zernio_onboarding_sessions
         SET status = 'completed', completed_at = ?, callback_error = NULL
         WHERE id = ? AND status = 'processing'`,
      )
      .run(nowCompleted, session.id);

    if (finish.changes === 0) {
      throw new PublicError(
        'O canal foi salvo, mas o SGA não conseguiu fechar a sessão. Atualize as Configurações.',
        500,
      );
    }

    claimedSessionId = null;
    return {
      outcome: 'completed',
      integration: publicIntegration(getIntegrationRow(ownerId)),
    };
  } catch (error) {
    if (claimedSessionId) {
      db.prepare(
        `UPDATE zernio_onboarding_sessions
         SET status = 'failed', callback_error = 'callback_verification_failed', completed_at = ?
         WHERE id = ? AND status = 'processing'`,
      ).run(new Date().toISOString(), claimedSessionId);
    }
    throw mapZernioError(error, 'onboarding');
  }
}

export function cancelZernioOnboarding(ownerId: string, profileId?: unknown) {
  assertActiveLandlord(ownerId, 'Esta operação está disponível para contas ativas de locador.');
  const now = new Date().toISOString();
  const db = getDb();
  const result =
    typeof profileId === 'string' && profileId
      ? db
          .prepare(
            `UPDATE zernio_onboarding_sessions
             SET status = 'cancelled', callback_error = 'cancelled_by_user', completed_at = ?
             WHERE id_usuario = ? AND zernio_profile_id = ? AND status = 'pending'`,
          )
          .run(now, ownerId, profileId)
      : db
          .prepare(
            `UPDATE zernio_onboarding_sessions
             SET status = 'cancelled', callback_error = 'cancelled_by_user', completed_at = ?
             WHERE id_usuario = ? AND status = 'pending'`,
          )
          .run(now, ownerId);

  return { success: true, cancelled: result.changes };
}

export async function disconnectZernioChannel(ownerId: string) {
  const { integration, apiKey } = requireValidZernioIntegrationForOnboarding(ownerId);
  if (!integration.whatsapp_account_id) {
    return { integration: publicIntegration(integration) };
  }

  try {
    await zernioWrite(`/accounts/${encodeURIComponent(String(integration.whatsapp_account_id))}`, apiKey, 'DELETE');
  } catch (error) {
    throw mapZernioError(error, 'onboarding');
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE zernio_integracoes
       SET whatsapp_account_id = NULL,
           whatsapp_account_name = NULL,
           whatsapp_phone_number = NULL,
           last_checked_at = ?,
           updated_at = ?
       WHERE id_usuario = ?`,
    )
    .run(now, now, ownerId);

  return { integration: publicIntegration(getIntegrationRow(ownerId)) };
}
