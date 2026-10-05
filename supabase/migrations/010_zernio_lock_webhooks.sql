ALTER TABLE public.zernio_integracoes
  ADD COLUMN IF NOT EXISTS webhook_id text,
  ADD COLUMN IF NOT EXISTS webhook_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS webhook_account_id text;

CREATE TABLE IF NOT EXISTS public.zernio_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  event_name text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zernio_webhook_events_owner_received
  ON public.zernio_webhook_events (id_usuario, received_at DESC);

ALTER TABLE public.zernio_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_webhook_events TO service_role;

COMMENT ON TABLE public.zernio_webhook_events IS
  'Deduplicação dos eventos recebidos dos webhooks Zernio por locador.';
