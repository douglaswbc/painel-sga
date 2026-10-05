CREATE TABLE IF NOT EXISTS public.zernio_whatsapp_manual_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  id_locatario uuid NOT NULL REFERENCES public.locatarios(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.zernio_whatsapp_templates(id) ON DELETE RESTRICT,
  account_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  template_name text NOT NULL,
  template_language text NOT NULL,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message_id text,
  conversation_id text,
  error_code text,
  safe_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_manual_deliveries_owner_created
  ON public.zernio_whatsapp_manual_deliveries (id_usuario, created_at DESC);

ALTER TABLE public.zernio_whatsapp_manual_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_whatsapp_manual_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_whatsapp_manual_deliveries TO service_role;

COMMENT ON TABLE public.zernio_whatsapp_manual_deliveries IS
  'Per-owner audit log for manually sent approved WhatsApp template messages.';
