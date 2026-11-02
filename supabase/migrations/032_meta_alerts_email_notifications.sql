-- Alertas operacionais da Meta e notificacoes por e-mail (Resend).
--
-- `meta_alertas` guarda um alerta ativo por tipo e locador. O alerta e criado
-- quando a Meta recusa um envio por um motivo acionavel (pagamento, conta
-- bloqueada, token invalido, permissao, template, limite de envio ou numero
-- fora de configuracao) e resolvido quando um envio volta a funcionar ou
-- quando o locador confirma que regularizou o problema.
--
-- `email_notificacoes_config` guarda a credencial do Resend de cada locador.
-- A API Key e cifrada pela Edge Function (AES-256-GCM) e nunca volta ao
-- navegador. O destinatario e sempre o e-mail da conta em public.usuarios.

CREATE TABLE IF NOT EXISTS public.meta_alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'pagamento',
    'conta_bloqueada',
    'token_invalido',
    'permissao',
    'template',
    'limite_envio',
    'integracao'
  )),
  severidade text NOT NULL DEFAULT 'warning'
    CHECK (severidade IN ('info', 'warning', 'error', 'critical')),
  status text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'resolvido')),
  codigo integer,
  detalhe text,
  ocorrencias integer NOT NULL DEFAULT 1 CHECK (ocorrencias > 0),
  primeira_ocorrencia timestamptz NOT NULL DEFAULT now(),
  ultima_ocorrencia timestamptz NOT NULL DEFAULT now(),
  ultima_notificacao_at timestamptz,
  resolvido_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_alertas_usuario_tipo_key UNIQUE (id_usuario, tipo)
);

CREATE INDEX IF NOT EXISTS idx_meta_alertas_usuario_status
  ON public.meta_alertas (id_usuario, status, severidade);

CREATE INDEX IF NOT EXISTS idx_meta_alertas_status_tipo
  ON public.meta_alertas (status, tipo)
  WHERE status = 'ativo';

COMMENT ON TABLE public.meta_alertas IS
  'Alertas acionaveis devolvidos pela Meta por locador. Um registro por tipo; reabre o mesmo registro quando o problema volta.';
COMMENT ON COLUMN public.meta_alertas.tipo IS
  'Categoria do alerta: pagamento, conta_bloqueada, token_invalido, permissao, template, limite_envio ou integracao.';
COMMENT ON COLUMN public.meta_alertas.severidade IS
  'Gravidade usada pelo banner e pelos e-mails: info, warning, error ou critical.';
COMMENT ON COLUMN public.meta_alertas.ultima_notificacao_at IS
  'Ultimo envio de e-mail deste alerta. Usado para limitar a uma notificacao a cada 24 horas.';

CREATE TABLE IF NOT EXISTS public.email_notificacoes_config (
  id_usuario uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend')),
  api_key_ciphertext text,
  api_key_last4 char(4),
  key_status text CHECK (key_status IS NULL OR key_status IN ('valid', 'invalid')),
  from_email text,
  from_name text,
  enabled boolean NOT NULL DEFAULT true,
  notificar_pagamento boolean NOT NULL DEFAULT true,
  notificar_conta_bloqueada boolean NOT NULL DEFAULT true,
  notificar_token_invalido boolean NOT NULL DEFAULT true,
  notificar_permissao boolean NOT NULL DEFAULT true,
  notificar_template boolean NOT NULL DEFAULT true,
  notificar_limite_envio boolean NOT NULL DEFAULT false,
  notificar_integracao boolean NOT NULL DEFAULT true,
  last_test_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_notificacoes_config IS
  'Configuracao do Resend por locador. A API Key e cifrada na Edge Function e nunca e exposta ao navegador.';
COMMENT ON COLUMN public.email_notificacoes_config.api_key_ciphertext IS
  'AES-256-GCM ciphertext da API Key do Resend. Prefixo vr1. usa RESEND_ENCRYPTION_KEY (ou META/ZERNIO como fallback).';
COMMENT ON COLUMN public.email_notificacoes_config.from_email IS
  'Remetente usado no Resend. O dominio precisa estar verificado na conta Resend do locador.';
COMMENT ON COLUMN public.email_notificacoes_config.notificar_limite_envio IS
  'Limites de envio sao transitorios; por padrao nao geram e-mail para evitar ruido.';

ALTER TABLE public.meta_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_notificacoes_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_alertas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.email_notificacoes_config FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.meta_alertas TO service_role;
GRANT ALL ON TABLE public.email_notificacoes_config TO service_role;
