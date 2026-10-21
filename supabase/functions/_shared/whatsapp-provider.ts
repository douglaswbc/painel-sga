/**
 * Provider-agnostic view of the WhatsApp integration stored per landlord.
 *
 * The row keeps both provider payloads so the landlord can switch the active
 * provider without losing the previous configuration. Only the legacy Zernio
 * fields are mirrored at the root level, to keep the existing clients working.
 */

export type WhatsappProvider = 'zernio' | 'meta';

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

export function normalizeProvider(value: unknown): WhatsappProvider {
  return value === 'meta' ? 'meta' : 'zernio';
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
    keyLast4: row.api_key_last4?.trim() || null,
    validatedAt: row.validated_at ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    profile: row.zernio_profile_id ? {
      id: row.zernio_profile_id,
      name: row.zernio_profile_name,
    } : null,
    account: row.whatsapp_account_id ? {
      id: row.whatsapp_account_id,
      name: row.whatsapp_account_name,
      phoneNumber: row.whatsapp_phone_number,
    } : null,
    meta: {
      status: row.meta_status ?? 'missing',
      hasToken: Boolean(row.meta_access_token_ciphertext),
      tokenLast4: row.meta_token_last4?.trim() || null,
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

/**
 * Marks a provider as the active one. The caller must have already checked
 * that the target provider has a usable channel.
 */
export async function activateProvider(admin: any, ownerId: string, provider: WhatsappProvider): Promise<void> {
  const { error } = await admin.from('zernio_integracoes')
    .update({ provider, updated_at: new Date().toISOString() })
    .eq('id_usuario', ownerId);
  if (error) throw new Error('Não foi possível alterar o provedor de WhatsApp em uso.');
}
