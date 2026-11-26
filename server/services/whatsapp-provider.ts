import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { PublicError, normalizeProvider, type WhatsappProvider } from './whatsapp-sender.js';

export type IntegrationRow = Record<string, any> | null | undefined;

export type PublicIntegration = {
  provider: WhatsappProvider;
  providerConnectedAt: string | null;
  hasApiKey: boolean;
  keyStatus: string | null;
  keyLast4: string | null;
  validatedAt: string | null;
  lastCheckedAt: string | null;
  profile: { id: string; name: string | null } | null;
  account: { id: string; name: string | null; phoneNumber: string | null } | null;
  meta: {
    status: string;
    hasToken: boolean;
    tokenLast4: string | null;
    tokenExpiresAt: string | null;
    businessId: string | null;
    wabaId: string | null;
    phoneNumberId: string | null;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
    nameStatus: string | null;
    messagingLimitTier: string | null;
    codeVerificationStatus: string | null;
    validatedAt: string | null;
    lastCheckedAt: string | null;
  };
};

export function assertActiveLandlord(ownerId: string, customMessage?: string): {
  id: string;
  email: string;
  nome_completo: string | null;
  empresa_nome: string | null;
  role: string;
  ativo: number;
} {
  const db = getDb();
  const owner = db
    .prepare('SELECT id, email, nome_completo, empresa_nome, role, ativo FROM usuarios WHERE id = ?')
    .get(ownerId) as
    | {
        id: string;
        email: string;
        nome_completo: string | null;
        empresa_nome: string | null;
        role: string;
        ativo: number;
      }
    | undefined;

  if (!owner || owner.role !== 'locador' || Number(owner.ativo) !== 1) {
    throw new PublicError(
      customMessage || 'Esta integração está disponível para contas ativas de locador.',
      403,
    );
  }
  return owner;
}

export function getIntegrationRow(ownerId: string): Record<string, any> | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM zernio_integracoes WHERE id_usuario = ?')
    .get(ownerId) as Record<string, any> | undefined;
  return row ?? null;
}

export function publicIntegration(row: IntegrationRow): PublicIntegration {
  if (!row) {
    return {
      provider: 'zernio',
      providerConnectedAt: null,
      hasApiKey: false,
      keyStatus: 'missing',
      keyLast4: null,
      validatedAt: null,
      lastCheckedAt: null,
      profile: null,
      account: null,
      meta: {
        status: 'missing',
        hasToken: false,
        tokenLast4: null,
        tokenExpiresAt: null,
        businessId: null,
        wabaId: null,
        phoneNumberId: null,
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        nameStatus: null,
        messagingLimitTier: null,
        codeVerificationStatus: null,
        validatedAt: null,
        lastCheckedAt: null,
      },
    };
  }

  return {
    provider: normalizeProvider(row.provider),
    providerConnectedAt: row.provider_connected_at ?? null,
    hasApiKey: Boolean(row.api_key_ciphertext),
    keyStatus: row.key_status ?? null,
    keyLast4: typeof row.api_key_last4 === 'string' ? row.api_key_last4.trim() || null : null,
    validatedAt: row.validated_at ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    profile: row.zernio_profile_id
      ? {
          id: String(row.zernio_profile_id),
          name: row.zernio_profile_name ?? null,
        }
      : null,
    account: row.whatsapp_account_id
      ? {
          id: String(row.whatsapp_account_id),
          name: row.whatsapp_account_name ?? null,
          phoneNumber: row.whatsapp_phone_number ?? null,
        }
      : null,
    meta: {
      status: row.meta_status ?? 'missing',
      hasToken: Boolean(row.meta_access_token_ciphertext),
      tokenLast4: typeof row.meta_token_last4 === 'string' ? row.meta_token_last4.trim() || null : null,
      tokenExpiresAt: row.meta_token_expires_at ?? null,
      businessId: row.meta_business_id ?? null,
      wabaId: row.meta_waba_id ?? null,
      phoneNumberId: row.meta_phone_number_id ?? null,
      displayPhoneNumber: row.meta_display_phone_number ?? null,
      verifiedName: row.meta_verified_name ?? null,
      qualityRating: row.meta_quality_rating ?? null,
      nameStatus: row.meta_name_status ?? null,
      messagingLimitTier: row.meta_messaging_limit_tier ?? null,
      codeVerificationStatus: row.meta_code_verification_status ?? null,
      validatedAt: row.meta_validated_at ?? null,
      lastCheckedAt: row.meta_last_checked_at ?? null,
    },
  };
}

export function metaWebhookUrl(): string {
  return loadEnv().urls.metaWebhook;
}

export function lockWebhookUrl(): string {
  return loadEnv().urls.lockWebhook;
}

export function activateProvider(ownerId: string, provider: WhatsappProvider): void {
  const db = getDb();
  const result = db
    .prepare('UPDATE zernio_integracoes SET provider = ?, updated_at = ? WHERE id_usuario = ?')
    .run(provider, new Date().toISOString(), ownerId);

  if (result.changes === 0) {
    throw new PublicError('Não foi possível alterar o provedor de WhatsApp em uso.', 500);
  }
}
