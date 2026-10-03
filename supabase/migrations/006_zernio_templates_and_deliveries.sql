-- Add tenant linkage for manual invoices and private Zernio template/send records.
ALTER TABLE public.cobrancas
  ADD COLUMN IF NOT EXISTS id_locatario uuid;

UPDATE public.cobrancas c
SET id_locatario = k.id_locatario
FROM public.contratos k
WHERE c.id_contrato = k.id
  AND c.id_usuario = k.id_usuario
  AND c.id_locatario IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cobrancas_locatario_mesmo_usuario_fkey'
      AND conrelid = 'public.cobrancas'::regclass
  ) THEN
    ALTER TABLE public.cobrancas
      ADD CONSTRAINT cobrancas_locatario_mesmo_usuario_fkey
      FOREIGN KEY (id_locatario, id_usuario)
      REFERENCES public.locatarios (id, id_usuario)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE public.cobrancas
  VALIDATE CONSTRAINT cobrancas_locatario_mesmo_usuario_fkey;

CREATE INDEX IF NOT EXISTS idx_cobrancas_locatario_usuario
  ON public.cobrancas (id_locatario, id_usuario);

CREATE OR REPLACE FUNCTION public.set_cobranca_locatario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  contract_tenant_id uuid;
BEGIN
  IF NEW.id_contrato IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT k.id_locatario INTO contract_tenant_id
  FROM public.contratos k
  WHERE k.id = NEW.id_contrato AND k.id_usuario = NEW.id_usuario;

  IF contract_tenant_id IS NULL THEN
    RAISE EXCEPTION 'O contrato da cobranca nao pertence ao locador informado.';
  END IF;
  IF NEW.id_locatario IS NOT NULL AND NEW.id_locatario <> contract_tenant_id THEN
    RAISE EXCEPTION 'O locatario da cobranca nao corresponde ao contrato.';
  END IF;

  NEW.id_locatario := contract_tenant_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_cobranca_locatario() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_set_cobranca_locatario ON public.cobrancas;
CREATE TRIGGER trg_set_cobranca_locatario
  BEFORE INSERT OR UPDATE OF id_contrato, id_usuario, id_locatario ON public.cobrancas
  FOR EACH ROW EXECUTE FUNCTION public.set_cobranca_locatario();

CREATE TABLE IF NOT EXISTS public.zernio_whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '^[a-fA-F0-9]{24}$'),
  meta_template_id text NOT NULL,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL CHECK (category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION')),
  rejection_reason text,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  variable_mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  purpose text NOT NULL DEFAULT 'general' CHECK (purpose IN ('general', 'charge')),
  is_default boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zernio_whatsapp_templates_owner_account_name_language_key
    UNIQUE (id_usuario, account_id, name, language)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_one_default
  ON public.zernio_whatsapp_templates (id_usuario)
  WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_owner_status
  ON public.zernio_whatsapp_templates (id_usuario, status, name);

CREATE TABLE IF NOT EXISTS public.zernio_whatsapp_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  id_cobranca uuid NOT NULL REFERENCES public.cobrancas(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.zernio_whatsapp_templates(id) ON DELETE RESTRICT,
  account_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  meta_template_id text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL,
  message_id text,
  conversation_id text,
  error_code text,
  safe_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT zernio_whatsapp_deliveries_charge_template_key
    UNIQUE (id_usuario, id_cobranca, template_id)
);

CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_owner_created
  ON public.zernio_whatsapp_deliveries (id_usuario, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_charge_inflight_or_sent
  ON public.zernio_whatsapp_deliveries (id_usuario, id_cobranca)
  WHERE status IN ('sending', 'sent');

ALTER TABLE public.zernio_whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zernio_whatsapp_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_whatsapp_templates, public.zernio_whatsapp_deliveries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_whatsapp_templates,
  public.zernio_whatsapp_deliveries TO service_role;

COMMENT ON TABLE public.zernio_whatsapp_templates IS
  'Metadata sincronizada dos templates WhatsApp Meta acessados pela conta Zernio de cada locador.';
COMMENT ON TABLE public.zernio_whatsapp_deliveries IS
  'Auditoria e idempotencia dos envios de templates WhatsApp para cobrancas.';
COMMENT ON COLUMN public.cobrancas.id_locatario IS
  'Locatario da cobranca, inclusive quando lancada manualmente sem contrato.';
