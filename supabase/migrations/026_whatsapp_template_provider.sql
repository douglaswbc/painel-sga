-- Provedor dos templates e das entregas de WhatsApp.
--
-- `provider` passa a indicar de qual provedor veio (ou vai) a mensagem:
--   zernio -> canal gerenciado pela Zernio (API do parceiro)
--   meta   -> WhatsApp Business Account ligado pela API oficial da Meta
--
-- `account_id` identifica o canal de envio do provedor correspondente:
--   zernio -> id da conta da Zernio (24 caracteres hexadecimais)
--   meta   -> phone number id do WhatsApp Business Account (somente dígitos)

ALTER TABLE public.zernio_whatsapp_templates
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zernio'
    CHECK (provider IN ('zernio', 'meta'));

ALTER TABLE public.zernio_whatsapp_templates
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_templates_account_id_check;
ALTER TABLE public.zernio_whatsapp_templates
  ADD CONSTRAINT zernio_whatsapp_templates_account_id_check
  CHECK (account_id ~ '^[a-fA-F0-9]{24}$' OR account_id ~ '^[0-9]{10,20}$');

-- A Meta devolve estados adicionais de template (limite excedido, deprecado,
-- arquivado, expirado e pendente de depreciação).
ALTER TABLE public.zernio_whatsapp_templates
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_templates_status_check;
ALTER TABLE public.zernio_whatsapp_templates
  ADD CONSTRAINT zernio_whatsapp_templates_status_check
  CHECK (status IN (
    'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL',
    'PENDING_DELETION', 'PENDING_DEPRECATION', 'LIMIT_EXCEEDED', 'DEPRECATED',
    'ARCHIVED', 'DELETED', 'EXPIRED'
  ));

-- A chave única passa a considerar o provedor, para que o mesmo template
-- possa existir nos dois canais com o mesmo nome e idioma.
ALTER TABLE public.zernio_whatsapp_templates
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_templates_owner_account_name_language_key;
ALTER TABLE public.zernio_whatsapp_templates
  ADD CONSTRAINT zernio_whatsapp_templates_owner_account_name_language_key
    UNIQUE (id_usuario, provider, account_id, name, language);

-- O template padrão também é exclusivo por provedor.
DROP INDEX IF EXISTS public.idx_zernio_whatsapp_templates_one_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_one_default
  ON public.zernio_whatsapp_templates (id_usuario, provider, purpose)
  WHERE is_default;

-- As demais tabelas registram o canal usado em cada envio.
ALTER TABLE public.zernio_whatsapp_deliveries
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zernio'
    CHECK (provider IN ('zernio', 'meta'));
ALTER TABLE public.zernio_whatsapp_template_usages
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zernio'
    CHECK (provider IN ('zernio', 'meta'));
ALTER TABLE public.zernio_whatsapp_manual_deliveries
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zernio'
    CHECK (provider IN ('zernio', 'meta'));

CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_provider_owner
  ON public.zernio_whatsapp_templates (id_usuario, provider, status, name);

COMMENT ON COLUMN public.zernio_whatsapp_templates.provider IS
  'Provedor do template: zernio (API da Zernio) ou meta (WhatsApp Cloud API).';
COMMENT ON COLUMN public.zernio_whatsapp_templates.account_id IS
  'Canal de envio do provedor: id da conta da Zernio ou phone number id da Meta.';
COMMENT ON COLUMN public.zernio_whatsapp_deliveries.provider IS
  'Provedor usado no envio registrado nesta linha.';
