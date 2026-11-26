export const initialSchemaSql = `
-- =====================================================================
-- 1. CONFIGURAÇÃO E USUÁRIOS
-- =====================================================================

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome_completo TEXT,
  whatsapp TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'locador', 'locatario')),
  empresa_nome TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mp_notification_url TEXT,
  mp_token_ciphertext TEXT,
  reminder_stagger_minutes INTEGER DEFAULT 2
    CHECK (reminder_stagger_minutes >= 0 AND reminder_stagger_minutes <= 60),
  reminder_dispatch_delay_seconds INTEGER DEFAULT 5
    CHECK (reminder_dispatch_delay_seconds >= 0 AND reminder_dispatch_delay_seconds <= 30),
  reset_token_hash TEXT,
  reset_token_expires_at TEXT
);

-- =====================================================================
-- 2. CORE (LOCATÁRIOS, VEÍCULOS, CONTRATOS, COBRANÇAS)
-- =====================================================================

CREATE TABLE IF NOT EXISTS locatarios (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome_completo TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT,
  documento TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  cpf TEXT,
  cep TEXT,
  rua TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  portal_token TEXT,
  documento_enc TEXT,
  cpf_enc TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS locatarios_id_usuario_uidx
  ON locatarios (id, id_usuario);

CREATE VIEW IF NOT EXISTS locatarios_safe AS
SELECT
  id,
  id_usuario,
  nome_completo,
  whatsapp,
  email,
  documento,
  cpf,
  ativo,
  created_at,
  cep,
  rua,
  numero,
  bairro,
  cidade,
  estado,
  portal_token,
  documento_enc,
  cpf_enc
FROM locatarios;

CREATE TABLE IF NOT EXISTS veiculos (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  placa TEXT NOT NULL,
  modelo TEXT NOT NULL,
  marca TEXT,
  cor TEXT,
  ano INTEGER,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS veiculos_id_usuario_uidx
  ON veiculos (id, id_usuario);

CREATE TABLE IF NOT EXISTS contratos (
  id TEXT PRIMARY KEY,
  id_locatario TEXT NOT NULL,
  id_veiculo TEXT NOT NULL,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor REAL NOT NULL,
  recorrencia TEXT NOT NULL,
  data_inicio TEXT NOT NULL,
  proxima_cobranca TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ocorrencias_realizadas INTEGER DEFAULT 0,
  FOREIGN KEY (id_locatario, id_usuario) REFERENCES locatarios (id, id_usuario),
  FOREIGN KEY (id_veiculo, id_usuario) REFERENCES veiculos (id, id_usuario)
);

CREATE UNIQUE INDEX IF NOT EXISTS contratos_id_usuario_uidx
  ON contratos (id, id_usuario);

CREATE TABLE IF NOT EXISTS cobrancas (
  id TEXT PRIMARY KEY,
  id_contrato TEXT,
  id_locatario TEXT,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor REAL NOT NULL,
  data_vencimento TEXT NOT NULL,
  ciclo_cobranca TEXT,
  data_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  tentativas_envio INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mercado_pago_id TEXT,
  payment_link TEXT,
  categoria TEXT DEFAULT 'aluguel',
  tipo TEXT DEFAULT 'receita',
  ultimo_lembrete_at TEXT,
  pix_expires_at TEXT,
  next_reminder_at TEXT,
  reminder_interval_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (reminder_interval_minutes BETWEEN 5 AND 240),
  pix_expired_at TEXT,
  pay_token TEXT NOT NULL,
  FOREIGN KEY (id_contrato, id_usuario) REFERENCES contratos (id, id_usuario) ON DELETE CASCADE,
  FOREIGN KEY (id_locatario, id_usuario) REFERENCES locatarios (id, id_usuario) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cobrancas_contrato_ciclo_unique
  ON cobrancas (id_contrato, ciclo_cobranca)
  WHERE id_contrato IS NOT NULL AND ciclo_cobranca IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_pay_token_key
  ON cobrancas (pay_token);

CREATE INDEX IF NOT EXISTS idx_cobrancas_usuario_next_reminder
  ON cobrancas (id_usuario, next_reminder_at)
  WHERE status IN ('pendente', 'atrasado') AND tipo <> 'despesa';

CREATE TABLE IF NOT EXISTS mensagens_template (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  tipo TEXT DEFAULT 'cobranca',
  media_url TEXT,
  media_type TEXT,
  media_mimetype TEXT,
  media_filename TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS mensagens_template_id_usuario_uidx
  ON mensagens_template (id, id_usuario);

CREATE TABLE IF NOT EXISTS mensalidades (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor REAL NOT NULL,
  descricao TEXT,
  data_vencimento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  data_pagamento TEXT,
  mercado_pago_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =====================================================================
-- 3. CANDIDATOS E INSCRIÇÃO PÚBLICA (TRIAGEM)
-- =====================================================================

CREATE TABLE IF NOT EXISTS candidate_application_links (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  expires_at TEXT NOT NULL,
  requests_day TEXT,
  requests_today INTEGER NOT NULL DEFAULT 0 CHECK (requests_today >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS candidatos (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cpf TEXT NOT NULL,
  telefone TEXT NOT NULL,
  email TEXT,
  idade_faixa TEXT,
  tem_220v INTEGER DEFAULT 0 CHECK (tem_220v IN (0, 1)),
  trabalha_em_app INTEGER DEFAULT 0 CHECK (trabalha_em_app IN (0, 1)),
  caucao_disponivel TEXT,
  score_formulario INTEGER,
  score_credito INTEGER,
  possui_processos_criminais INTEGER CHECK (possui_processos_criminais IS NULL OR possui_processos_criminais IN (0, 1)),
  status TEXT DEFAULT 'Em análise',
  pagamento_id TEXT,
  reserva_idempotency_key TEXT,
  reserva_valor REAL
    CHECK (reserva_valor IS NULL OR (reserva_valor >= 1.00 AND reserva_valor <= 10000.00)),
  pagamento_status TEXT DEFAULT 'Aguardando',
  pix_qr_code TEXT,
  pix_copia_e_cola TEXT,
  reserva_expira_em TEXT,
  reserva_confirmada_em TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  pix_url TEXT,
  id_link_inscricao TEXT REFERENCES candidate_application_links(id) ON DELETE SET NULL,
  aviso_privacidade_versao TEXT,
  aviso_privacidade_lido_em TEXT,
  UNIQUE (id_usuario, cpf)
);

CREATE TABLE IF NOT EXISTS candidato_reserva_pagamentos (
  id TEXT PRIMARY KEY,
  id_candidato TEXT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  mercado_pago_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Pendente',
  status_detalhe TEXT,
  valor REAL,
  expira_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS candidato_reserva_auditoria (
  id TEXT PRIMARY KEY,
  id_candidato TEXT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  operador_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
  acao TEXT NOT NULL
    CHECK (acao IN ('confirmacao_manual', 'alteracao_status', 'atualizacao_pagamento', 'inscricao_recebida')),
  origem TEXT NOT NULL DEFAULT 'operador'
    CHECK (origem IN ('operador', 'sistema')),
  status_anterior TEXT,
  status_novo TEXT NOT NULL,
  pagamento_status_anterior TEXT,
  pagamento_status_novo TEXT,
  motivo TEXT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =====================================================================
-- 4. WHATSAPP & PROVEDORES (ZERNIO E META CLOUD API)
-- =====================================================================

CREATE TABLE IF NOT EXISTS zernio_integracoes (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'zernio' CHECK (provider IN ('zernio', 'meta')),
  provider_connected_at TEXT,
  api_key_ciphertext TEXT,
  api_key_last4 TEXT,
  key_status TEXT DEFAULT 'valid' CHECK (key_status IS NULL OR key_status IN ('valid', 'invalid')),
  zernio_profile_id TEXT,
  zernio_profile_name TEXT,
  whatsapp_account_id TEXT,
  whatsapp_account_name TEXT,
  whatsapp_phone_number TEXT,
  validated_at TEXT,
  last_checked_at TEXT,
  webhook_id TEXT,
  webhook_secret_ciphertext TEXT,
  webhook_account_id TEXT,
  meta_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (meta_status IN ('missing', 'valid', 'invalid', 'connected')),
  meta_business_id TEXT,
  meta_waba_id TEXT,
  meta_phone_number_id TEXT,
  meta_access_token_ciphertext TEXT,
  meta_token_last4 TEXT,
  meta_token_expires_at TEXT,
  meta_display_phone_number TEXT,
  meta_verified_name TEXT,
  meta_quality_rating TEXT,
  meta_name_status TEXT,
  meta_messaging_limit_tier TEXT,
  meta_code_verification_status TEXT,
  meta_validated_at TEXT,
  meta_last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS zernio_onboarding_sessions (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  zernio_profile_id TEXT NOT NULL,
  onboarding_mode TEXT NOT NULL CHECK (onboarding_mode IN ('api', 'business_app')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  callback_error TEXT
);

CREATE TABLE IF NOT EXISTS zernio_whatsapp_templates (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'zernio' CHECK (provider IN ('zernio', 'meta')),
  account_id TEXT NOT NULL,
  meta_template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL',
      'PENDING_DELETION', 'PENDING_DEPRECATION', 'LIMIT_EXCEEDED', 'DEPRECATED',
      'ARCHIVED', 'DELETED', 'EXPIRED'
    )),
  rejection_reason TEXT,
  components TEXT NOT NULL DEFAULT '[]',
  variable_mapping TEXT NOT NULL DEFAULT '[]',
  purpose TEXT NOT NULL DEFAULT 'general'
    CHECK (purpose IN ('general', 'charge', 'payment_confirmation', 'avulso')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id_usuario, provider, account_id, name, language)
);

CREATE UNIQUE INDEX IF NOT EXISTS zernio_whatsapp_templates_id_owner_uidx
  ON zernio_whatsapp_templates (id, id_usuario);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_one_default
  ON zernio_whatsapp_templates (id_usuario, provider, purpose)
  WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS zernio_whatsapp_template_usages (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES zernio_whatsapp_templates(id) ON DELETE CASCADE,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('charge', 'payment_confirmation', 'avulso')),
  variable_mapping TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  reminder_order INTEGER NOT NULL DEFAULT 1 CHECK (reminder_order > 0),
  provider TEXT NOT NULL DEFAULT 'zernio' CHECK (provider IN ('zernio', 'meta')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (template_id, purpose)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_charge_template_order
  ON zernio_whatsapp_template_usages (id_usuario, account_id, reminder_order)
  WHERE is_default = 1 AND purpose = 'charge';

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_payment_confirmation_default
  ON zernio_whatsapp_template_usages (id_usuario, account_id, purpose)
  WHERE is_default = 1 AND purpose = 'payment_confirmation';

CREATE TABLE IF NOT EXISTS zernio_whatsapp_deliveries (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_cobranca TEXT NOT NULL REFERENCES cobrancas(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES zernio_whatsapp_templates(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  meta_template_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  message_id TEXT,
  conversation_id TEXT,
  error_code TEXT,
  safe_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'zernio' CHECK (provider IN ('zernio', 'meta')),
  meta_status TEXT CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_charge_sequence
  ON zernio_whatsapp_deliveries (id_usuario, id_cobranca, sequence_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_charge_sending
  ON zernio_whatsapp_deliveries (id_usuario, id_cobranca)
  WHERE status = 'sending';

CREATE TABLE IF NOT EXISTS zernio_whatsapp_manual_deliveries (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_locatario TEXT NOT NULL REFERENCES locatarios(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES zernio_whatsapp_templates(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message_id TEXT,
  conversation_id TEXT,
  error_code TEXT,
  safe_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  provider TEXT NOT NULL DEFAULT 'zernio' CHECK (provider IN ('zernio', 'meta')),
  meta_status TEXT CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed'))
);

CREATE TABLE IF NOT EXISTS agendamentos_mensagens (
  id TEXT PRIMARY KEY,
  id_template TEXT,
  id_locatario TEXT NOT NULL,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_contrato TEXT,
  frequencia TEXT NOT NULL
    CHECK (frequencia IN ('diario', 'semanal', 'quinzenal', 'mensal', 'personalizado')),
  frequencia_dias INTEGER,
  proximo_envio TEXT NOT NULL,
  horario_envio TEXT NOT NULL DEFAULT '08:00:00',
  ativo INTEGER DEFAULT 1 CHECK (ativo IS NULL OR ativo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  zernio_template_id TEXT,
  template_params TEXT NOT NULL DEFAULT '[]',
  ultimo_erro TEXT,
  ultima_execucao TEXT,
  CHECK ((id_template IS NULL) <> (zernio_template_id IS NULL)),
  FOREIGN KEY (id_template, id_usuario) REFERENCES mensagens_template (id, id_usuario) ON DELETE CASCADE,
  FOREIGN KEY (zernio_template_id, id_usuario) REFERENCES zernio_whatsapp_templates (id, id_usuario) ON DELETE CASCADE,
  FOREIGN KEY (id_locatario, id_usuario) REFERENCES locatarios (id, id_usuario) ON DELETE CASCADE,
  FOREIGN KEY (id_contrato, id_usuario) REFERENCES contratos (id, id_usuario) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS agendamentos_mensagens_id_usuario_uidx
  ON agendamentos_mensagens (id, id_usuario);

CREATE TABLE IF NOT EXISTS zernio_whatsapp_scheduled_deliveries (
  id TEXT PRIMARY KEY,
  id_agendamento TEXT NOT NULL,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message_id TEXT,
  conversation_id TEXT,
  safe_error TEXT,
  error_code TEXT,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  meta_status TEXT CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed')),
  UNIQUE (id_agendamento, scheduled_date, scheduled_time),
  FOREIGN KEY (id_agendamento, id_usuario) REFERENCES agendamentos_mensagens (id, id_usuario) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zernio_webhook_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  id_usuario TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('zernio', 'meta')),
  account_id TEXT,
  event_name TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS zernio_payment_notifications (
  id TEXT PRIMARY KEY,
  mercado_pago_id TEXT NOT NULL UNIQUE,
  id_cobranca TEXT REFERENCES cobrancas(id) ON DELETE CASCADE,
  id_candidato TEXT REFERENCES candidatos(id) ON DELETE CASCADE,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  message_id TEXT,
  safe_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  meta_status TEXT CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed')),
  CHECK ((id_cobranca IS NOT NULL) <> (id_candidato IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS meta_alertas (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'pagamento',
    'conta_bloqueada',
    'token_invalido',
    'permissao',
    'template',
    'limite_envio',
    'integracao'
  )),
  severidade TEXT NOT NULL DEFAULT 'warning'
    CHECK (severidade IN ('info', 'warning', 'error', 'critical')),
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'resolvido')),
  codigo INTEGER,
  detalhe TEXT,
  ocorrencias INTEGER NOT NULL DEFAULT 1 CHECK (ocorrencias > 0),
  primeira_ocorrencia TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultima_ocorrencia TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultima_notificacao_at TEXT,
  resolvido_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id_usuario, tipo)
);

CREATE TABLE IF NOT EXISTS email_notificacoes_config (
  id_usuario TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend')),
  api_key_ciphertext TEXT,
  api_key_last4 TEXT,
  key_status TEXT CHECK (key_status IS NULL OR key_status IN ('valid', 'invalid')),
  from_email TEXT,
  from_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  notificar_pagamento INTEGER NOT NULL DEFAULT 1 CHECK (notificar_pagamento IN (0, 1)),
  notificar_conta_bloqueada INTEGER NOT NULL DEFAULT 1 CHECK (notificar_conta_bloqueada IN (0, 1)),
  notificar_token_invalido INTEGER NOT NULL DEFAULT 1 CHECK (notificar_token_invalido IN (0, 1)),
  notificar_permissao INTEGER NOT NULL DEFAULT 1 CHECK (notificar_permissao IN (0, 1)),
  notificar_template INTEGER NOT NULL DEFAULT 1 CHECK (notificar_template IN (0, 1)),
  notificar_limite_envio INTEGER NOT NULL DEFAULT 0 CHECK (notificar_limite_envio IN (0, 1)),
  notificar_integracao INTEGER NOT NULL DEFAULT 1 CHECK (notificar_integracao IN (0, 1)),
  notificar_resumo_diario INTEGER NOT NULL DEFAULT 1 CHECK (notificar_resumo_diario IN (0, 1)),
  last_test_at TEXT,
  last_sent_at TEXT,
  last_daily_summary_date TEXT,
  last_daily_summary_sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE VIEW IF NOT EXISTS zernio_whatsapp_activity_log AS
SELECT d.id_usuario,
       'charge' AS type,
       d.id AS source_id,
       d.status,
       d.template_name,
       d.template_language,
       t.category,
       l.nome_completo AS recipient_name,
       l.whatsapp AS recipient_phone,
       COALESCE(d.sent_at, d.updated_at, d.created_at) AS occurred_at,
       d.created_at,
       d.message_id,
       COALESCE(d.safe_error, d.error_code) AS error,
       d.meta_status
FROM zernio_whatsapp_deliveries d
LEFT JOIN zernio_whatsapp_templates t
  ON t.id = d.template_id AND t.id_usuario = d.id_usuario
LEFT JOIN cobrancas c
  ON c.id = d.id_cobranca AND c.id_usuario = d.id_usuario
LEFT JOIN locatarios l
  ON l.id = c.id_locatario AND l.id_usuario = d.id_usuario
UNION ALL
SELECT d.id_usuario,
       'scheduled' AS type,
       d.id AS source_id,
       d.status,
       t.name AS template_name,
       t.language AS template_language,
       t.category,
       l.nome_completo AS recipient_name,
       l.whatsapp AS recipient_phone,
       COALESCE(d.sent_at, d.attempted_at, d.created_at) AS occurred_at,
       d.created_at,
       d.message_id,
       COALESCE(d.safe_error, d.error_code) AS error,
       d.meta_status
FROM zernio_whatsapp_scheduled_deliveries d
JOIN agendamentos_mensagens a
  ON a.id = d.id_agendamento AND a.id_usuario = d.id_usuario
LEFT JOIN zernio_whatsapp_templates t
  ON t.id = a.zernio_template_id AND t.id_usuario = d.id_usuario
LEFT JOIN locatarios l
  ON l.id = a.id_locatario AND l.id_usuario = d.id_usuario
UNION ALL
SELECT d.id_usuario,
       'payment' AS type,
       d.id AS source_id,
       d.status,
       t.name AS template_name,
       t.language AS template_language,
       t.category,
       COALESCE(l.nome_completo, cand.nome) AS recipient_name,
       COALESCE(l.whatsapp, cand.telefone) AS recipient_phone,
       COALESCE(d.updated_at, d.created_at) AS occurred_at,
       d.created_at,
       d.message_id,
       d.safe_error AS error,
       d.meta_status
FROM zernio_payment_notifications d
LEFT JOIN cobrancas c
  ON c.id = d.id_cobranca AND c.id_usuario = d.id_usuario
LEFT JOIN locatarios l
  ON l.id = c.id_locatario AND l.id_usuario = d.id_usuario
LEFT JOIN candidatos cand
  ON cand.id = d.id_candidato AND cand.id_usuario = d.id_usuario
LEFT JOIN zernio_whatsapp_template_usages u
  ON u.id_usuario = d.id_usuario AND u.purpose = 'payment_confirmation' AND u.is_default = 1
LEFT JOIN zernio_whatsapp_templates t
  ON t.id = u.template_id AND t.id_usuario = d.id_usuario
UNION ALL
SELECT d.id_usuario,
       'manual' AS type,
       d.id AS source_id,
       d.status,
       d.template_name,
       d.template_language,
       t.category,
       l.nome_completo AS recipient_name,
       l.whatsapp AS recipient_phone,
       COALESCE(d.sent_at, d.updated_at, d.created_at) AS occurred_at,
       d.created_at,
       d.message_id,
       COALESCE(d.safe_error, d.error_code) AS error,
       d.meta_status
FROM zernio_whatsapp_manual_deliveries d
LEFT JOIN zernio_whatsapp_templates t
  ON t.id = d.template_id AND t.id_usuario = d.id_usuario
LEFT JOIN locatarios l
  ON l.id = d.id_locatario AND l.id_usuario = d.id_usuario;

-- =====================================================================
-- 5. FECHADURAS INTELIGENTES (HARDWARE / ESP32)
-- =====================================================================

CREATE TABLE IF NOT EXISTS fechaduras (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  identificador TEXT NOT NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id_usuario, identificador)
);

CREATE TABLE IF NOT EXISTS fechadura_verificacoes (
  id TEXT PRIMARY KEY,
  whatsapp TEXT NOT NULL,
  id_fechadura TEXT NOT NULL REFERENCES fechaduras(id) ON DELETE CASCADE,
  codigo_otp TEXT NOT NULL,
  tentativas INTEGER DEFAULT 0,
  verificado INTEGER DEFAULT 0 CHECK (verificado IS NULL OR verificado IN (0, 1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS fechadura_comandos (
  id TEXT PRIMARY KEY,
  id_fechadura TEXT NOT NULL REFERENCES fechaduras(id) ON DELETE CASCADE,
  token_acesso TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS fechadura_logs (
  id TEXT PRIMARY KEY,
  id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_locatario TEXT REFERENCES locatarios(id) ON DELETE SET NULL,
  id_fechadura TEXT NOT NULL REFERENCES fechaduras(id) ON DELETE CASCADE,
  whatsapp TEXT,
  evento TEXT NOT NULL,
  detalhes TEXT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =====================================================================
-- 6. ÍNDICES DE PERFORMANCE
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_contratos_usuario ON contratos(id_usuario);
CREATE INDEX IF NOT EXISTS idx_contratos_locatario_usuario ON contratos (id_locatario, id_usuario);
CREATE INDEX IF NOT EXISTS idx_contratos_veiculo_usuario ON contratos (id_veiculo, id_usuario);

CREATE INDEX IF NOT EXISTS idx_locatarios_usuario ON locatarios(id_usuario);
CREATE INDEX IF NOT EXISTS idx_veiculos_usuario ON veiculos(id_usuario);

CREATE INDEX IF NOT EXISTS idx_cobrancas_usuario ON cobrancas(id_usuario);
CREATE INDEX IF NOT EXISTS idx_cobrancas_status ON cobrancas(status);
CREATE INDEX IF NOT EXISTS idx_cobrancas_contrato_usuario ON cobrancas (id_contrato, id_usuario);
CREATE INDEX IF NOT EXISTS idx_cobrancas_locatario_usuario ON cobrancas (id_locatario, id_usuario);
CREATE INDEX IF NOT EXISTS idx_cobrancas_usuario_vencimento ON cobrancas (id_usuario, data_vencimento);

CREATE INDEX IF NOT EXISTS idx_mensagens_usuario ON mensagens_template(id_usuario);

CREATE INDEX IF NOT EXISTS idx_agendamentos_template ON agendamentos_mensagens(id_template);
CREATE INDEX IF NOT EXISTS idx_agendamentos_usuario ON agendamentos_mensagens(id_usuario);
CREATE INDEX IF NOT EXISTS idx_agendamentos_proximo ON agendamentos_mensagens(proximo_envio, horario_envio);
CREATE INDEX IF NOT EXISTS idx_agendamentos_locatario_usuario ON agendamentos_mensagens (id_locatario, id_usuario);
CREATE INDEX IF NOT EXISTS idx_agendamentos_zernio_template_owner ON agendamentos_mensagens (zernio_template_id, id_usuario) WHERE zernio_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidatos_usuario ON candidatos(id_usuario);
CREATE INDEX IF NOT EXISTS idx_candidato_reserva_pagamentos_candidate ON candidato_reserva_pagamentos (id_candidato, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_candidato_reserva_auditoria_candidate ON candidato_reserva_auditoria (id_candidato, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_zernio_onboarding_owner_status ON zernio_onboarding_sessions (id_usuario, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zernio_onboarding_expiry ON zernio_onboarding_sessions (expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_owner_status ON zernio_whatsapp_templates (id_usuario, status, name);
CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_templates_provider_owner ON zernio_whatsapp_templates (id_usuario, provider, status, name);

CREATE INDEX IF NOT EXISTS idx_zernio_template_usages_owner_template ON zernio_whatsapp_template_usages (id_usuario, template_id);

CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_owner_created ON zernio_whatsapp_deliveries (id_usuario, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zernio_whatsapp_manual_deliveries_owner_created ON zernio_whatsapp_manual_deliveries (id_usuario, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zernio_scheduled_deliveries_owner_created ON zernio_whatsapp_scheduled_deliveries (id_usuario, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zernio_webhook_events_owner_received ON zernio_webhook_events (id_usuario, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_owner_received ON whatsapp_webhook_events (id_usuario, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_alertas_usuario_status ON meta_alertas (id_usuario, status, severidade);
CREATE INDEX IF NOT EXISTS idx_meta_alertas_status_tipo ON meta_alertas (status, tipo) WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_fechaduras_usuario ON fechaduras(id_usuario);
CREATE INDEX IF NOT EXISTS idx_fechadura_comandos_pendentes ON fechadura_comandos(id_fechadura) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_fechadura_logs_data ON fechadura_logs(timestamp DESC);
`;
