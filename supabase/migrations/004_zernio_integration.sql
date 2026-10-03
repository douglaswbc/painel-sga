-- Store one Zernio credential per landlord. The ciphertext is only accessible
-- to trusted Edge Functions through service_role; browser clients have no grants.
CREATE TABLE IF NOT EXISTS public.zernio_integracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL UNIQUE
    REFERENCES public.usuarios(id) ON DELETE CASCADE,
  api_key_ciphertext text NOT NULL,
  api_key_last4 char(4),
  key_status text NOT NULL DEFAULT 'valid'
    CHECK (key_status IN ('valid', 'invalid')),
  zernio_profile_id text,
  zernio_profile_name text,
  whatsapp_account_id text,
  whatsapp_account_name text,
  whatsapp_phone_number text,
  validated_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zernio_profile_id_format_check
    CHECK (zernio_profile_id IS NULL OR zernio_profile_id ~ '^[a-fA-F0-9]{24}$'),
  CONSTRAINT zernio_account_id_format_check
    CHECK (whatsapp_account_id IS NULL OR whatsapp_account_id ~ '^[a-fA-F0-9]{24}$')
);

ALTER TABLE public.zernio_integracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_integracoes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_integracoes TO service_role;

COMMENT ON TABLE public.zernio_integracoes IS
  'Credencial Zernio cifrada no servidor e metadados WhatsApp por locador. Não expor via PostgREST.';
COMMENT ON COLUMN public.zernio_integracoes.api_key_ciphertext IS
  'AES-256-GCM ciphertext using the Supabase Edge Function secret ZERNIO_ENCRYPTION_KEY.';
