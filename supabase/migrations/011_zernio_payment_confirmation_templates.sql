ALTER TABLE public.zernio_whatsapp_templates
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_templates_purpose_check;

ALTER TABLE public.zernio_whatsapp_templates
  ADD CONSTRAINT zernio_whatsapp_templates_purpose_check
  CHECK (purpose IN ('general', 'charge', 'payment_confirmation'));

DROP INDEX IF EXISTS public.idx_zernio_whatsapp_templates_one_default;
CREATE UNIQUE INDEX idx_zernio_whatsapp_templates_one_default
  ON public.zernio_whatsapp_templates (id_usuario, purpose)
  WHERE is_default;

CREATE TABLE IF NOT EXISTS public.zernio_payment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mercado_pago_id text NOT NULL UNIQUE,
  id_cobranca uuid REFERENCES public.cobrancas(id) ON DELETE CASCADE,
  id_candidato uuid REFERENCES public.candidatos(id) ON DELETE CASCADE,
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message_id text,
  safe_error text,
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zernio_payment_notification_target_check CHECK ((id_cobranca IS NOT NULL) <> (id_candidato IS NOT NULL))
);

ALTER TABLE public.zernio_payment_notifications ENABLE ROW LEVEL SECURITY;
