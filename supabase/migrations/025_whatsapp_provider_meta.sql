-- Provider-agnostic WhatsApp integration row.
--
-- The table keeps its historical name (`zernio_integracoes`) to avoid breaking
-- the deployed Edge Functions, but it now stores the credential of a single
-- active provider per landlord: 'zernio' (partner API) or 'meta' (official
-- WhatsApp Cloud API). The inactive provider keeps its own columns so the
-- landlord can switch back without reconfiguring anything.

ALTER TABLE public.zernio_integracoes
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zernio'
    CHECK (provider IN ('zernio', 'meta')),
  ADD COLUMN IF NOT EXISTS provider_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_status text NOT NULL DEFAULT 'missing'
    CHECK (meta_status IN ('missing', 'valid', 'invalid', 'connected')),
  ADD COLUMN IF NOT EXISTS meta_business_id text,
  ADD COLUMN IF NOT EXISTS meta_waba_id text,
  ADD COLUMN IF NOT EXISTS meta_phone_number_id text,
  ADD COLUMN IF NOT EXISTS meta_access_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS meta_token_last4 char(4),
  ADD COLUMN IF NOT EXISTS meta_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_display_phone_number text,
  ADD COLUMN IF NOT EXISTS meta_verified_name text,
  ADD COLUMN IF NOT EXISTS meta_quality_rating text,
  ADD COLUMN IF NOT EXISTS meta_name_status text,
  ADD COLUMN IF NOT EXISTS meta_messaging_limit_tier text,
  ADD COLUMN IF NOT EXISTS meta_code_verification_status text,
  ADD COLUMN IF NOT EXISTS meta_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_last_checked_at timestamptz;

-- Zernio-only fields become optional: a landlord may use the Meta Cloud API
-- without ever configuring a Zernio key. The existing CHECK on key_status
-- still accepts NULL, so only the NOT NULL constraints are relaxed.
ALTER TABLE public.zernio_integracoes ALTER COLUMN api_key_ciphertext DROP NOT NULL;
ALTER TABLE public.zernio_integracoes ALTER COLUMN key_status DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'zernio_integracoes_meta_waba_id_format_check'
      AND conrelid = 'public.zernio_integracoes'::regclass
  ) THEN
    ALTER TABLE public.zernio_integracoes
      ADD CONSTRAINT zernio_integracoes_meta_waba_id_format_check
      CHECK (meta_waba_id IS NULL OR meta_waba_id ~ '^[0-9]{10,20}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'zernio_integracoes_meta_phone_number_id_format_check'
      AND conrelid = 'public.zernio_integracoes'::regclass
  ) THEN
    ALTER TABLE public.zernio_integracoes
      ADD CONSTRAINT zernio_integracoes_meta_phone_number_id_format_check
      CHECK (meta_phone_number_id IS NULL OR meta_phone_number_id ~ '^[0-9]{10,20}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zernio_integracoes_meta_phone_number
  ON public.zernio_integracoes (meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;

COMMENT ON TABLE public.zernio_integracoes IS
  'Credencial WhatsApp cifrada no servidor por locador. A coluna provider indica o canal em uso (zernio ou meta) e guarda os metadados do provedor ativo. Não expor via PostgREST.';
COMMENT ON COLUMN public.zernio_integracoes.provider IS
  'Provedor de WhatsApp em uso por este locador: zernio (API da Zernio) ou meta (WhatsApp Cloud API oficial).';
COMMENT ON COLUMN public.zernio_integracoes.meta_status IS
  'Estado da conexão Meta: missing (sem credencial), valid (token aceito), invalid (token recusado) ou connected (número registrado e vinculado).';
COMMENT ON COLUMN public.zernio_integracoes.meta_access_token_ciphertext IS
  'AES-256-GCM ciphertext do token de acesso da Meta. Prefixo vm1. usa META_ENCRYPTION_KEY (ou ZERNIO_ENCRYPTION_KEY como fallback).';
COMMENT ON COLUMN public.zernio_integracoes.meta_phone_number_id IS
  'Phone Number ID do WhatsApp Business Account; identifica o canal de envio pela API oficial da Meta.';
