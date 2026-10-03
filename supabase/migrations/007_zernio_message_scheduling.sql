-- Connect recurring message schedules to the owner's approved Meta templates.
CREATE UNIQUE INDEX IF NOT EXISTS zernio_whatsapp_templates_id_owner_uidx
  ON public.zernio_whatsapp_templates (id, id_usuario);

ALTER TABLE public.agendamentos_mensagens
  ALTER COLUMN id_template DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS zernio_template_id uuid,
  ADD COLUMN IF NOT EXISTS template_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ultimo_erro text,
  ADD COLUMN IF NOT EXISTS ultima_execucao timestamptz;

ALTER TABLE public.agendamentos_mensagens
  DROP CONSTRAINT IF EXISTS agendamentos_mensagens_template_fkey,
  DROP CONSTRAINT IF EXISTS agendamentos_template_mesmo_usuario_fkey,
  DROP CONSTRAINT IF EXISTS agendamentos_meta_template_mesmo_usuario_fkey,
  DROP CONSTRAINT IF EXISTS agendamentos_mensagens_template_source_check,
  ADD CONSTRAINT agendamentos_mensagens_template_source_check
    CHECK ((id_template IS NULL) <> (zernio_template_id IS NULL)),
  ADD CONSTRAINT agendamentos_template_mesmo_usuario_fkey
    FOREIGN KEY (id_template, id_usuario)
    REFERENCES public.mensagens_template (id, id_usuario) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT agendamentos_meta_template_mesmo_usuario_fkey
    FOREIGN KEY (zernio_template_id, id_usuario)
    REFERENCES public.zernio_whatsapp_templates (id, id_usuario) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT agendamentos_template_params_array_check
    CHECK (jsonb_typeof(template_params) = 'array');

ALTER TABLE public.agendamentos_mensagens
  VALIDATE CONSTRAINT agendamentos_template_mesmo_usuario_fkey,
  VALIDATE CONSTRAINT agendamentos_meta_template_mesmo_usuario_fkey;

CREATE INDEX IF NOT EXISTS idx_agendamentos_zernio_template_owner
  ON public.agendamentos_mensagens (zernio_template_id, id_usuario)
  WHERE zernio_template_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agendamentos_mensagens_id_usuario_uidx
  ON public.agendamentos_mensagens (id, id_usuario);

CREATE TABLE IF NOT EXISTS public.zernio_whatsapp_scheduled_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_agendamento uuid NOT NULL,
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  scheduled_time time NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message_id text,
  conversation_id text,
  safe_error text,
  error_code text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zernio_scheduled_delivery_occurrence_key
    UNIQUE (id_agendamento, scheduled_date, scheduled_time),
  CONSTRAINT zernio_scheduled_delivery_agendamento_owner_fkey
    FOREIGN KEY (id_agendamento, id_usuario)
    REFERENCES public.agendamentos_mensagens (id, id_usuario) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zernio_scheduled_deliveries_owner_created
  ON public.zernio_whatsapp_scheduled_deliveries (id_usuario, created_at DESC);

ALTER TABLE public.zernio_whatsapp_scheduled_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_whatsapp_scheduled_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_whatsapp_scheduled_deliveries TO service_role;

COMMENT ON COLUMN public.agendamentos_mensagens.zernio_template_id IS
  'Template Meta aprovado associado a novos agendamentos Zernio; id_template permanece para agendamentos legados.';
COMMENT ON COLUMN public.agendamentos_mensagens.template_params IS
  'Valores recorrentes das variáveis posicionais do template Meta para este locatário.';
COMMENT ON TABLE public.zernio_whatsapp_scheduled_deliveries IS
  'Tentativas idempotentes dos envios recorrentes de templates Meta feitos pelo cron Zernio.';
