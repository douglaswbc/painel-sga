-- Webhooks do WhatsApp (Meta Cloud API).
--
-- A tabela guarda os eventos recebidos para deduplicacao: a Meta repete o
-- mesmo evento quando nao recebe HTTP 200, e cada mensagem gera ate tres
-- atualizacoes de status (sent, delivered, read).

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  id_usuario uuid REFERENCES public.usuarios(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('zernio', 'meta')),
  account_id text,
  event_name text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_owner_received
  ON public.whatsapp_webhook_events (id_usuario, received_at DESC);

ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_webhook_events TO service_role;

-- Status de entrega devolvido pela Meta, guardado junto da entrega.
ALTER TABLE public.zernio_whatsapp_deliveries
  ADD COLUMN IF NOT EXISTS meta_status text
    CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed'));
ALTER TABLE public.zernio_whatsapp_manual_deliveries
  ADD COLUMN IF NOT EXISTS meta_status text
    CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed'));
ALTER TABLE public.zernio_whatsapp_scheduled_deliveries
  ADD COLUMN IF NOT EXISTS meta_status text
    CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed'));

COMMENT ON TABLE public.whatsapp_webhook_events IS
  'Eventos de webhook de WhatsApp recebidos da Meta, deduplicados por identificador.';
COMMENT ON COLUMN public.zernio_whatsapp_deliveries.meta_status IS
  'Ultimo status de entrega informado pela Meta para esta mensagem.';
