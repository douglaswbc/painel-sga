import crypto from 'node:crypto';
import { getDb } from '../db/database.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import {
  ALLOWED_META_ALERT_TYPES,
  activeMetaAlerts,
  classifyMetaError,
  publicMetaAlerts,
  recordAndNotifyMetaAlert,
  resolveMetaAlerts,
  type MetaAlertType,
} from './meta-alerts.js';
import {
  MetaApiError,
  debugToken,
  describeMetaError,
  getPhoneNumberDetails,
  getWaba,
  listPhoneNumbers,
  registerPhoneNumber,
} from './meta-graph.js';
import { PublicError } from './whatsapp-sender.js';
import {
  activateProvider,
  assertActiveLandlord,
  getIntegrationRow,
  metaWebhookUrl,
  publicIntegration,
} from './whatsapp-provider.js';

const META_ID = /^[0-9]{10,20}$/;

const META_PATCH_COLUMNS = new Set([
  'provider',
  'provider_connected_at',
  'meta_status',
  'meta_business_id',
  'meta_waba_id',
  'meta_phone_number_id',
  'meta_access_token_ciphertext',
  'meta_token_last4',
  'meta_app_secret_ciphertext',
  'meta_app_secret_last4',
  'meta_webhook_verify_token_ciphertext',
  'meta_webhook_verify_token_last4',
  'meta_token_expires_at',
  'meta_display_phone_number',
  'meta_verified_name',
  'meta_quality_rating',
  'meta_name_status',
  'meta_messaging_limit_tier',
  'meta_code_verification_status',
  'meta_validated_at',
  'meta_last_checked_at',
]);

function tokenExpiryIso(expiresAt: number | null): string | null {
  if (!expiresAt || expiresAt <= 0) return null;
  return new Date(expiresAt * 1000).toISOString();
}

function saveMetaState(ownerId: string, patch: Record<string, string | null>): Record<string, any> {
  const entries = Object.entries(patch).filter(([key]) => META_PATCH_COLUMNS.has(key));
  const now = new Date().toISOString();
  const cols = ['id', 'id_usuario', ...entries.map(([k]) => k), 'created_at', 'updated_at'];
  const placeholders = cols.map(() => '?').join(', ');
  const values: Array<string | null> = [
    crypto.randomUUID(),
    ownerId,
    ...entries.map(([, v]) => v),
    now,
    now,
  ];
  const updateAssignments = [
    ...entries.map(([k]) => `${k} = excluded.${k}`),
    'updated_at = excluded.updated_at',
  ].join(', ');

  getDb()
    .prepare(
      `INSERT INTO zernio_integracoes (${cols.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (id_usuario) DO UPDATE SET ${updateAssignments}`,
    )
    .run(...values);

  const saved = getIntegrationRow(ownerId);
  if (!saved) {
    throw new PublicError('Não foi possível salvar a integração da Meta.', 500);
  }
  return saved;
}

export function getMetaStatus(ownerId: string) {
  assertActiveLandlord(ownerId);
  const integration = getIntegrationRow(ownerId);
  const alerts = activeMetaAlerts(ownerId);
  const webhookUrl = metaWebhookUrl(ownerId);
  return {
    integration: publicIntegration(integration),
    alerts: publicMetaAlerts(alerts),
    callbackUrl: webhookUrl,
    webhookUrl,
  };
}

export function listMetaAlerts(ownerId: string) {
  assertActiveLandlord(ownerId);
  return { alerts: publicMetaAlerts(activeMetaAlerts(ownerId)) };
}

export function clearMetaAlert(ownerId: string, tipo?: unknown) {
  assertActiveLandlord(ownerId);
  const requested = typeof tipo === 'string' ? tipo.trim() : '';
  if (requested && !ALLOWED_META_ALERT_TYPES.includes(requested as MetaAlertType)) {
    throw new PublicError('Tipo de alerta inválido.', 400);
  }
  resolveMetaAlerts(ownerId, requested ? [requested as MetaAlertType] : undefined);
  return { alerts: publicMetaAlerts(activeMetaAlerts(ownerId)), success: true };
}

export function activateMetaProvider(ownerId: string, provider: unknown) {
  assertActiveLandlord(ownerId);
  if (provider !== 'zernio' && provider !== 'meta') {
    throw new PublicError('Provedor inválido.', 400);
  }
  const integration = getIntegrationRow(ownerId);
  if (provider === 'meta') {
    if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id) {
      throw new PublicError('Conecte um número da Meta antes de usá-lo como canal principal.', 409);
    }
  } else {
    if (
      !integration?.api_key_ciphertext ||
      integration?.key_status !== 'valid' ||
      !integration?.whatsapp_account_id
    ) {
      throw new PublicError('Conecte um canal da Zernio antes de usá-lo como canal principal.', 409);
    }
  }
  activateProvider(ownerId, provider);
  return { integration: publicIntegration(getIntegrationRow(ownerId)) };
}

export function disconnectMetaChannel(ownerId: string) {
  assertActiveLandlord(ownerId);
  const integration = getIntegrationRow(ownerId);
  const now = new Date().toISOString();
  const keepZernio = Boolean(integration?.api_key_ciphertext) && integration?.key_status === 'valid';

  if (integration) {
    const nextProvider =
      integration.provider === 'meta' && keepZernio ? 'zernio' : (integration.provider ?? 'zernio');
    getDb()
      .prepare(
        `UPDATE zernio_integracoes
         SET meta_status = 'missing',
             meta_business_id = NULL,
             meta_waba_id = NULL,
             meta_phone_number_id = NULL,
             meta_access_token_ciphertext = NULL,
             meta_token_last4 = NULL,
             meta_app_secret_ciphertext = NULL,
             meta_app_secret_last4 = NULL,
             meta_webhook_verify_token_ciphertext = NULL,
             meta_webhook_verify_token_last4 = NULL,
             meta_token_expires_at = NULL,
             meta_display_phone_number = NULL,
             meta_verified_name = NULL,
             meta_quality_rating = NULL,
             meta_name_status = NULL,
             meta_messaging_limit_tier = NULL,
             meta_code_verification_status = NULL,
             provider_connected_at = NULL,
             provider = ?,
             last_checked_at = ?,
             updated_at = ?
         WHERE id_usuario = ?`,
      )
      .run(nextProvider, now, now, ownerId);
  }

  resolveMetaAlerts(ownerId);
  return { integration: publicIntegration(getIntegrationRow(ownerId)), alerts: [] };
}

function buildWebhookCredentialsPatch(
  ownerId: string,
  body: { appSecret?: unknown; webhookVerifyToken?: unknown },
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  const appSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';
  const webhookVerifyToken = typeof body.webhookVerifyToken === 'string' ? body.webhookVerifyToken.trim() : '';

  if (appSecret) {
    if (appSecret.length < 8 || appSecret.length > 200) {
      throw new PublicError('Informe um App Secret da Meta válido (entre 8 e 200 caracteres).', 400);
    }
    patch.meta_app_secret_ciphertext = encryptSecret(appSecret, ownerId, 'meta');
    patch.meta_app_secret_last4 = appSecret.slice(-4);
  }

  if (webhookVerifyToken) {
    if (webhookVerifyToken.length < 4 || webhookVerifyToken.length > 200) {
      throw new PublicError('Informe um Verify Token de webhook válido (entre 4 e 200 caracteres).', 400);
    }
    patch.meta_webhook_verify_token_ciphertext = encryptSecret(webhookVerifyToken, ownerId, 'meta');
    patch.meta_webhook_verify_token_last4 = webhookVerifyToken.slice(-4);
  }

  return patch;
}

export function saveMetaWebhookSettings(
  ownerId: string,
  body: { appSecret?: unknown; webhookVerifyToken?: unknown },
) {
  assertActiveLandlord(ownerId);
  const patch = buildWebhookCredentialsPatch(ownerId, body);
  if (Object.keys(patch).length === 0) {
    throw new PublicError('Informe o App Secret e/ou o Verify Token do webhook da Meta.', 400);
  }
  const saved = saveMetaState(ownerId, patch);
  return { integration: publicIntegration(saved), alerts: publicMetaAlerts(activeMetaAlerts(ownerId)) };
}

export async function validateManualMeta(
  ownerId: string,
  body: {
    accessToken?: unknown;
    phoneNumberId?: unknown;
    wabaId?: unknown;
    appSecret?: unknown;
    webhookVerifyToken?: unknown;
  },
) {
  assertActiveLandlord(ownerId);
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
  const wabaId = typeof body.wabaId === 'string' ? body.wabaId.trim() : '';

  if (accessToken.length < 40 || accessToken.length > 2000) {
    throw new PublicError('Informe um token de acesso do sistema válido.', 400);
  }
  if (!META_ID.test(phoneNumberId) || !META_ID.test(wabaId)) {
    throw new PublicError('Informe o Phone Number ID e o WABA ID apenas com dígitos.', 400);
  }
  const webhookPatch = buildWebhookCredentialsPatch(ownerId, body);

  let waba: Record<string, unknown>;
  let numbers: Awaited<ReturnType<typeof listPhoneNumbers>>;
  try {
    waba = await getWaba(wabaId, accessToken);
    numbers = await listPhoneNumbers(wabaId, accessToken);
  } catch (error) {
    const meta = classifyMetaError(error);
    if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
    throw new PublicError(describeMetaError(error), 400);
  }

  if (String(waba?.id ?? wabaId) !== wabaId) {
    throw new PublicError('A Meta não encontrou esse WABA ID com este token.', 400);
  }
  const match = numbers.find((item) => item.id === phoneNumberId);
  if (!match) {
    throw new PublicError('Esse Phone Number ID não pertence ao WABA informado ou ainda não foi verificado.', 400);
  }

  let details = null;
  try {
    details = await getPhoneNumberDetails(phoneNumberId, accessToken);
  } catch {
    details = null;
  }

  const now = new Date().toISOString();
  const tokenInfo = await debugToken(accessToken).catch(() => null);
  const ciphertext = encryptSecret(accessToken, ownerId, 'meta');
  const saved = saveMetaState(ownerId, {
    ...webhookPatch,
    meta_access_token_ciphertext: ciphertext,
    meta_token_last4: accessToken.slice(-4),
    meta_token_expires_at: tokenExpiryIso(tokenInfo?.expiresAt ?? null),
    meta_business_id: tokenInfo?.userId ?? null,
    meta_waba_id: wabaId,
    meta_phone_number_id: phoneNumberId,
    meta_display_phone_number: details?.displayPhoneNumber ?? match.displayPhoneNumber,
    meta_verified_name: details?.verifiedName ?? match.verifiedName,
    meta_quality_rating: details?.qualityRating ?? match.qualityRating,
    meta_name_status: details?.nameStatus ?? null,
    meta_messaging_limit_tier: details?.messagingLimitTier ?? null,
    meta_code_verification_status: details?.codeVerificationStatus ?? null,
    meta_status: 'connected',
    meta_validated_at: now,
    meta_last_checked_at: now,
    provider_connected_at: now,
    provider: 'meta',
  });
  activateProvider(ownerId, 'meta');
  resolveMetaAlerts(ownerId, ['token_invalido', 'permissao', 'integracao']);
  const alerts = activeMetaAlerts(ownerId);
  return { integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts) };
}

export async function registerMetaNumber(ownerId: string, body: { pin?: unknown }) {
  assertActiveLandlord(ownerId);
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!/^\d{6}$/.test(pin)) {
    throw new PublicError('Informe o PIN de 6 dígitos da verificação em duas etapas do WhatsApp.', 400);
  }

  const integration = getIntegrationRow(ownerId);
  if (
    !integration?.meta_access_token_ciphertext ||
    !integration?.meta_phone_number_id ||
    !integration?.meta_waba_id
  ) {
    throw new PublicError('Conecte um número da Meta antes de registrá-lo.', 409);
  }

  const token = decryptSecret(String(integration.meta_access_token_ciphertext), ownerId);
  try {
    const registered = await registerPhoneNumber(String(integration.meta_phone_number_id), pin, token);
    if (!registered) {
      throw new PublicError(
        'A Meta não confirmou o registro do número. Verifique o PIN e o status de verificação.',
        409,
      );
    }
  } catch (error) {
    if (error instanceof PublicError) throw error;
    const meta = classifyMetaError(error);
    if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
    throw new PublicError(describeMetaError(error), 400);
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE zernio_integracoes
       SET meta_status = 'connected', provider_connected_at = ?, provider = 'meta', updated_at = ?
       WHERE id_usuario = ?`,
    )
    .run(now, now, ownerId);

  activateProvider(ownerId, 'meta');
  resolveMetaAlerts(ownerId, ['token_invalido', 'permissao', 'integracao']);
  const saved = getIntegrationRow(ownerId);
  const alerts = activeMetaAlerts(ownerId);
  return { integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts) };
}

export async function refreshMetaStatus(ownerId: string) {
  assertActiveLandlord(ownerId);
  const integration = getIntegrationRow(ownerId);
  const currentAlerts = activeMetaAlerts(ownerId);

  if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id) {
    return { integration: publicIntegration(integration), alerts: publicMetaAlerts(currentAlerts) };
  }

  const token = decryptSecret(String(integration.meta_access_token_ciphertext), ownerId);
  try {
    const details = await getPhoneNumberDetails(String(integration.meta_phone_number_id), token);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE zernio_integracoes
         SET meta_display_phone_number = ?,
             meta_verified_name = ?,
             meta_quality_rating = ?,
             meta_name_status = ?,
             meta_messaging_limit_tier = ?,
             meta_code_verification_status = ?,
             meta_status = 'connected',
             meta_last_checked_at = ?,
             updated_at = ?
         WHERE id_usuario = ?`,
      )
      .run(
        details.displayPhoneNumber,
        details.verifiedName,
        details.qualityRating,
        details.nameStatus,
        details.messagingLimitTier,
        details.codeVerificationStatus,
        now,
        now,
        ownerId,
      );

    resolveMetaAlerts(ownerId, ['token_invalido']);
    const saved = getIntegrationRow(ownerId);
    const alerts = activeMetaAlerts(ownerId);
    return { integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts) };
  } catch (error) {
    const meta = classifyMetaError(error);
    if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
    if (error instanceof MetaApiError && (error.status === 401 || error.status === 403)) {
      const now = new Date().toISOString();
      getDb()
        .prepare(
          `UPDATE zernio_integracoes
           SET meta_status = 'invalid', meta_last_checked_at = ?, updated_at = ?
           WHERE id_usuario = ?`,
        )
        .run(now, now, ownerId);
      const saved = getIntegrationRow(ownerId);
      const alerts = activeMetaAlerts(ownerId);
      throw new PublicError('O token da Meta não autorizou a consulta. Gere um novo token.', 409, {
        integration: publicIntegration(saved),
        alerts: publicMetaAlerts(alerts),
      });
    }
    throw new PublicError(describeMetaError(error), 400);
  }
}
