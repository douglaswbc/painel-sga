# Plano de Migração — Painel SGA (Supabase → Backend Próprio + SQLite na VPS)

> **Objetivo:** Eliminar a dependência do Supabase (Postgres, Auth, Storage, Edge Functions, `pg_cron` e Vault) e consolidar o sistema em um backend próprio (Node.js/TypeScript) com SQLite, pronto para qualquer pessoa clonar o repositório na VPS, preencher um único `.env` e subir a aplicação.
>
> *Nota: O histórico anterior de tarefas das integrações Zernio/Meta/Triagem permanece preservado no histórico do Git.*

---

## Etapa 0 — Fundação do Backend, SQLite, Auth, Storage e Agendador

### 0.1 Estrutura do Servidor Backend (`server/`)
- [x] Inicializar projeto backend em Node.js + TypeScript (Express em `server/`, `tsconfig.server.json`).
- [x] Criar validação estrita das variáveis de ambiente no startup (`server/config/env.ts` com Zod).
- [x] Configurar CORS, headers de segurança, parse de JSON (preservando `rawBody` nas rotas de webhook da Meta e Zernio para validação HMAC-SHA256) e tratamento padronizado de erros HTTP (`server/app.ts`).
- [x] Servir os arquivos estáticos do build do Vite (`dist/`) com fallback SPA (`/* → index.html`) para permitir deploy em processo único na VPS.

### 0.2 Banco de Dados SQLite e Migrations (`server/db/`)
- [x] Configurar driver SQLite (`node:sqlite` / `DatabaseSync`) com `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL` e `PRAGMA busy_timeout = 5000` (`server/db/database.ts`).
- [x] Converter as 28 tabelas e 2 views (`locatarios_safe`, `zernio_whatsapp_activity_log`) de `supabase/sql_banco.txt` para migrations SQLite versionadas e idempotentes, executadas automaticamente ao iniciar o servidor (`server/db/migrations/001_initial_schema.ts`):
  - [x] Core: `usuarios` (`password_hash`, `mp_token_ciphertext`, `reset_token_hash`, `reset_token_expires_at`), `locatarios`, `veiculos`, `contratos`, `cobrancas`, `mensagens_template`, `mensalidades`.
  - [x] Triagem: `candidate_application_links`, `candidatos`, `candidato_reserva_pagamentos`, `candidato_reserva_auditoria`.
  - [x] WhatsApp/Notificações: `zernio_integracoes`, `zernio_onboarding_sessions`, `zernio_whatsapp_templates`, `zernio_whatsapp_template_usages`, `zernio_whatsapp_deliveries`, `zernio_whatsapp_manual_deliveries`, `agendamentos_mensagens`, `zernio_whatsapp_scheduled_deliveries`, `zernio_webhook_events`, `whatsapp_webhook_events`, `zernio_payment_notifications`, `meta_alertas`, `email_notificacoes_config`.
  - [x] Fechaduras: `fechaduras`, `fechadura_verificacoes`, `fechadura_comandos`, `fechadura_logs`.
- [x] Preservar todos os índices únicos parciais (`idx_cobrancas_contrato_ciclo_unique`, `idx_zernio_whatsapp_templates_one_default`, `idx_zernio_charge_template_order`, `idx_zernio_payment_confirmation_default`, `idx_zernio_whatsapp_deliveries_charge_sequence`, `idx_zernio_whatsapp_deliveries_charge_sending`).
- [x] Criar helper de criptografia AES-256-GCM compartilhado (`server/utils/crypto.ts`) compatível com os formatos `v1.` / `vm1.` / `vr1.` / `vp1.` / `vd1.`.

### 0.3 Autenticação, Sessão e Isolamento Multi-Tenant
- [x] Implementar hash de senhas (`scrypt` + `timingSafeEqual`) e emissão/validação de JWT (`JWT_SECRET`).
- [x] Criar middleware `requireAuth` (`server/middleware/auth.ts`, valida JWT via header Bearer ou cookie HttpOnly, carrega usuário em `usuarios` e bloqueia se `ativo = 0`).
- [x] Criar middleware `requireAdmin` (`role === 'admin'`).
- [x] Criar bootstrap automático do primeiro administrador no startup a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD` do `.env` quando não houver usuários cadastrados (`bootstrapAdmin`).
- [x] Garantir em **todas** as queries de serviços/rotas o filtro `id_usuario = req.user.id` (aplicado conforme as rotas de domínio forem criadas nas Etapas 1 a 9).

### 0.4 Storage Local e Agendador Interno (Crons)
- [x] Criar serviço de storage local em `UPLOAD_DIR` (`server/routes/media.ts`, `./data/uploads/mensagens-midia/<userId>/`) e rota pública estática `/uploads/...` (substituindo bucket `mensagens-midia`).
- [x] Configurar agendador interno com `node-cron` (`server/cron/scheduler.ts`, ciclo de 5min para `faturamento`, `lembretes` e `agendamentos` + resumo diário às 08:00 `America/Sao_Paulo` com lock contra concorrência).

### 0.5 Webhooks Públicos e Base de URL Dinâmica
- [x] Centralizar todas as URLs externas a partir de `APP_PUBLIC_URL` (`server/config/env.ts`) e criar router base em `server/routes/webhooks.ts`:
  - [x] `GET / POST /api/webhooks/meta` (verificação `hub.challenge` + validação `X-Hub-Signature-256` + processamento completo de status/OTP via `handleMetaWebhookEvent`).
  - [x] `POST /api/webhooks/mercadopago` (portado `payment-webhook-receiver` via `handleMercadoPagoWebhook` em `server/services/billing-service.ts`).
  - [x] `POST /api/webhooks/fechadura` (portado `webhook-fechadura` + `server/services/lock-otp.ts` via `handleZernioLockWebhook`).

---

## Etapa 1 — Shell Global, Autenticação e Camada de API do Frontend

### Screen/Módulo: Cliente HTTP + `AuthContext` + `DashboardLayout`
- [x] **Cliente HTTP (`src/services/api.js`)**
  - [x] Criar cliente `fetch` centralizado com base `/api`, envio automático de credenciais/token (`Bearer` + `credentials: 'include'`) e tratamento unificado de erros (401 dispara `sga:unauthorized` para limpar sessão).
  - [x] Configurar proxy de desenvolvimento em `vite.config.js` (`/api`, `/uploads`, `/pagar` → backend Node).
  - [x] Remover dependência de `src/services/supabase.ts` após concluir todas as screens (Etapa 10).
- [x] **Contexto de Autenticação (`src/contexts/AuthContext.jsx`)**
  - [x] Substituir `supabase.auth.getSession()` / `onAuthStateChange()` por `GET /api/auth/me`.
  - [x] Substituir `supabase.auth.signOut()` por `POST /api/auth/logout`.
- [x] **Hooks Globais (`src/hooks/useNavCounts.js`, `src/hooks/useMetaAlerts.js`)**
  - [x] Criar endpoint `GET /api/dashboard/nav-counts` para substituir as queries diretas de `cobrancas` atrasadas e `candidatos` pendentes em `useNavCounts.js`.
  - [x] Migrar `useMetaAlerts.js` de `supabase.functions.invoke('meta-integration')` para `GET /api/meta/alerts` e `POST /api/meta/alerts/clear`.
- [x] **Busca Rápida (`src/components/QuickSearchModal.jsx`)**
  - [x] Criar endpoint `GET /api/search?q=...` no backend consultando `locatarios` (descriptografando `cpf_enc`) e `veiculos` do locador logado, substituindo `supabase.from('locatarios_safe')` e `supabase.from('veiculos')`.
- [x] **Layout e Navegação (`DashboardLayout.jsx`, `Sidebar.jsx`, `BottomNav.jsx`, `QuickActionsMenu.jsx`, `MetaAlertBanner.jsx`)**
  - [x] Validar que contadores, alertas da Meta e busca rápida funcionam apenas com a nova API.

---

## Etapa 2 — Screens Públicas e Autenticação

### Screen `/`: `src/pages/Landing.jsx`
- [x] Revisar links e textos para garantir que não haja referências fixas a domínios antigos ou Supabase; validar renderização pública sem autenticação.

### Screen `/login`: `src/pages/Login.jsx`
- [x] Substituir `supabase.auth.signInWithPassword` e consulta adicional em `usuarios` por `POST /api/auth/login` (que já valida senha, verifica `ativo = 1` e retorna sessão + perfil).
- [x] Remover `supabase.auth.getSession()` no `useEffect`, usando estado do `AuthContext`.
- [x] Validar redirecionamento para `redirectTo` (ou `/dashboard`) após login e tratamento de usuário inativo.

### Screen `/pagar/:token` e `/pagar/aviso/:motivo`: `src/pages/PaymentNotice.jsx`
- [x] **Remover `public/_redirects`** (que apontava `/pagar/:token` para `https://ykvmzelwpodjmvoujumf.supabase.co/functions/v1/pay-link?t=:token`).
- [x] Criar rota `GET /pagar/:token` no backend (`server/routes/pay-link.ts`, portando `supabase/functions/pay-link/index.ts`):
  - [x] Validar UUID `pay_token` na tabela `cobrancas`.
  - [x] Redirecionar (`302`) para `payment_link` HTTPS válido do Mercado Pago.
  - [x] Em caso de `pago`, `cancelado`, `expirado`, `invalido` ou `indisponivel`, redirecionar (`302`) para `${APP_PUBLIC_URL}/pagar/aviso/<motivo>`.
- [x] Validar todas as variações da tela `PaymentNotice.jsx` (`/pagar/aviso/{pago,cancelado,expirado,invalido,indisponivel}`) e garantir que `/pagar/aviso/*` siga para o SPA.

---

## Etapa 3 — Cadastros Principais

### Screen `/locatarios`: `src/pages/Locatarios.jsx` + `LocatarioModal.jsx`
- [x] Criar endpoints REST no backend (`server/routes/locatarios.ts`):
  - [x] `GET /api/locatarios` (suportando listagem completa, simples, com WhatsApp e `include=agendamentos`; descriptografando `documento_enc` e `cpf_enc` no servidor no padrão da view `locatarios_safe`).
  - [x] `GET /api/locatarios/:id`
  - [x] `POST /api/locatarios` (criptografando `documento` e `cpf` antes de gravar).
  - [x] `PUT /api/locatarios/:id` e `PATCH /api/locatarios/:id/status` (atualizando campos criptografados quando modificados).
  - [x] `DELETE /api/locatarios/:id` (retornando `409` amigável quando houver vínculo por FK).
- [x] Atualizar `src/services/locatarios.js` e `src/components/LocatarioModal.jsx` (removido `supabase.from('locatarios')` direto do modal).
- [x] Integrar `MessageSelectorModal.jsx` e `AgendamentoModal.jsx` (concluídos na Etapa 5).

### Screen `/veiculos`: `src/pages/Veiculos.jsx` + `VeiculoModal.jsx`
- [x] Criar endpoints REST no backend (`server/routes/veiculos.ts`):
  - [x] `GET /api/veiculos` (incluindo contratos vinculados `id, status` e opção de filtro `ativo=true`).
  - [x] `POST /api/veiculos`
  - [x] `PUT /api/veiculos/:id`
  - [x] `DELETE /api/veiculos/:id` (retornando `409` amigável quando vinculado a contrato).
- [x] Atualizar `src/services/veiculos.js`, `src/pages/Veiculos.jsx` (removido `supabase.from('veiculos')` direto na página) e `src/components/VeiculoModal.jsx` (removido `supabase.from('veiculos')` direto no modal).

### Screen `/contratos`: `src/pages/Contratos.jsx` + `ContratoModal.jsx` + `RecurrenceConfig.jsx`
- [x] Criar endpoints REST no backend (`server/routes/contratos.ts`):
  - [x] `GET /api/contratos` (com join de `locatarios(nome_completo)` e `veiculos(placa, modelo)`).
  - [x] `GET /api/contratos/ativo-por-locatario/:locatarioId`
  - [x] `POST /api/contratos` (validando que `id_locatario` e `id_veiculo` pertencem ao mesmo `id_usuario`, replicando as FKs compostas do Postgres).
  - [x] `PUT /api/contratos/:id` e `PATCH /api/contratos/:id/status`
  - [x] `DELETE /api/contratos/:id`
- [x] Atualizar `src/services/contratos.js` e `src/components/ContratoModal.jsx` (removidas chamadas diretas `supabase.from(...)`).
- [x] Validar preservação de `recorrencia` e cálculo de `proxima_cobranca` no fuso `America/Sao_Paulo`.

---

## Etapa 4 — Financeiro (`Dashboard` e `Cobranças`)

### Screen `/dashboard`: `src/pages/Dashboard.jsx`
- [x] Criar endpoint `GET /api/dashboard/summary` portando a lógica SQL de `get_dashboard_summary()` para SQLite + TypeScript com cálculo exato de início/fim do mês em `America/Sao_Paulo`.
- [x] Criar endpoint `GET /api/dashboard/charges` para substituir `listDashboardCharges` (contagens por status + lista paginada com joins de locatário, contrato e veículo).
- [x] Remover queries diretas de `supabase.from('veiculos')` e `supabase.from('candidatos')` em `Dashboard.jsx` via endpoint `GET /api/dashboard/operational-stats`.
- [x] Validar botões de ação rápida do Dashboard: geração de PIX, envio de cobrança via WhatsApp e criação de cobrança avulsa.

### Screen `/cobrancas`: `src/pages/Cobrancas.jsx` + `PixModal.jsx`
- [x] Criar endpoints REST de cobranças no backend (`server/routes/cobrancas.ts`):
  - [x] `GET /api/cobrancas` (com joins de locatário, contrato e veículo) e `GET /api/cobrancas/contrato/:contratoId/pendente`.
  - [x] `POST /api/cobrancas` (aplicando validação equivalente ao trigger `set_cobranca_locatario` e gerando `pay_token` UUID).
  - [x] `PUT /api/cobrancas/:id`, `PATCH /api/cobrancas/:id/pagar`, `PATCH /api/cobrancas/:id/cancelar`.
- [x] Portar Edge Functions financeiras para o backend (`server/services/billing-service.ts` e `server/services/whatsapp-sender.ts`):
  - [x] `POST /api/cobrancas/faturar` e job de cron `faturamento` (portando `faturamento-cobrancas` + `_shared/billing.ts`, usando token MP do locador e `MP_WEBHOOK_URL` derivado de `APP_PUBLIC_URL`).
  - [x] `POST /api/cobrancas/cobrar-contrato` (portando `cobrar-contrato`).
  - [x] `POST /api/cobrancas/:id/gerar-pix` e `POST /api/cobrancas/:id/confirmar-pagamento` + job de cron `lembretes` (`enviar-lembretes-cobranca`).
- [x] Atualizar `src/services/cobrancas.js` e `src/pages/Cobrancas.jsx` (removidos import e chamadas de `supabase`).
- [x] Validar fluxo de "Dar Baixa e Notificar" (com confirmação automática pelo provedor ativo e fallback para `MessageSelectorModal`, que será migrado na Etapa 5).

---

## Etapa 5 — Mensagens, Templates Meta, Agendamentos e Custos

### Screen `/mensagens`: `src/pages/Mensagens.jsx` + Cards e Modais
- [x] **Portar serviço WhatsApp (`supabase/functions/zernio-whatsapp` + `_shared/meta-graph.ts` + `_shared/meta-messages.ts` + `_shared/meta-alerts.ts`)** para endpoints REST no backend:
  - [x] `GET /api/whatsapp/templates` (`list` + `syncTemplates` para Zernio e Meta).
  - [x] `POST /api/whatsapp/templates` (`create_template` com validação de regras da Meta).
  - [x] `PUT /api/whatsapp/templates/:id` (`update_template` e `update_template_button`).
  - [x] `DELETE /api/whatsapp/templates/:id` (`delete_template`, preservando histórico como `DELETED` quando houver entregas).
  - [x] `POST /api/whatsapp/templates/default`, `DELETE /api/whatsapp/templates/:id/usage/:purpose` e `POST /api/whatsapp/templates/charge-order` (`set_default`, `remove_template_usage`, `save_charge_order`).
  - [x] `POST /api/whatsapp/send-template` (envio avulso pelo `MessageSelectorModal`).
  - [x] `GET /api/whatsapp/analytics`, `GET /api/whatsapp/activity` (substituindo view `zernio_whatsapp_activity_log`) e `GET /api/whatsapp/health`.
- [x] **Corrigir URL padrão hardcoded em `ZernioTemplatesCard.jsx` (`line 42`)**:
  - [x] Remover `'https://sga.emoveentregas.com/pagar/{{1}}'` e obter a URL pública dinâmica via backend (`APP_PUBLIC_URL`) ou `window.location.origin`.
- [x] **Agendamentos (`ZernioSchedulesCard.jsx` e `AgendamentoModal.jsx`)**:
  - [x] Criar endpoints `GET/POST/PATCH/DELETE /api/agendamentos` e `POST /api/whatsapp/schedules` + job de cron `agendamentos` (`scheduled-messages-service.ts`).
  - [x] Atualizar `ZernioSchedulesCard.jsx`, `ZernioOperationsCard.jsx` e `AgendamentoModal.jsx` para remover import de `supabase`.
- [x] **Templates legados e Mídia (`src/services/mensagens.js`)**:
  - [x] Criar endpoints `GET/PUT/DELETE /api/mensagens-template` e `POST/DELETE /api/media` (storage local no lugar do bucket `mensagens-midia`).
  - [x] Atualizar `MessageSelectorModal.jsx` (remover `supabase.auth.getUser()`, `supabase.from('locatarios_safe')` e `supabase.functions.invoke`).

---

## Etapa 6 — Triagem de Candidatos e Inscrição Pública

### Screen `/triagem`: `src/pages/Triagem.jsx` + `CandidatoDetalheModal.jsx`
- [x] Criar endpoints REST no backend (`server/routes/candidatos.ts` e `server/services/candidatos-service.ts`):
  - [x] `GET /api/candidatos`, `PUT /api/candidatos/:id` (registrando auditoria em `candidato_reserva_auditoria` ao alterar `status` ou `pagamento_status`, replicando o trigger `registrar_historico_status_candidato`).
  - [x] `GET /api/candidatos/:id/reserva-historico` (retornando `candidato_reserva_auditoria` e `candidato_reserva_pagamentos`).
  - [x] `POST /api/candidatos/:id/reserva-pix` (portando `create-reservation-pix`).
  - [x] `POST /api/candidatos/:id/confirmar-reserva-manual` (portando RPC `confirmar_reserva_candidato_manual` com bloqueio de PIX ativo e auditoria obrigatória).
  - [x] `GET/POST/DELETE /api/candidatos/link-inscricao` (portando `candidate-application-link`).
- [x] Atualizar `src/services/candidatos.js` (e ajustar cópia segura em `Triagem.jsx`) mantendo polling automático de 15s, filtros, paginação, ficha e modal PIX.

### Screen `/inscricao/:token`: `src/pages/CandidateApplication.jsx`
- [x] Portar `submit-candidate-application` para `POST /api/public/inscricao` (`server/routes/public.ts`):
  - [x] Validar token via SHA-256 em `candidate_application_links` (`ativo = 1` e `expires_at > now`).
  - [x] Executar cota diária de 50 envios em transação SQLite (`BEGIN IMMEDIATE`, portando RPC `consumir_cota_inscricao_candidato`).
  - [x] Validar CPF, campos obrigatórios, honeypot (`website`), tempo mínimo de preenchimento e duplicidade de CPF por `id_usuario`.
  - [x] Registrar candidatura em `candidatos` + evento `inscricao_recebida` em `candidato_reserva_auditoria`.
- [x] Atualizar `candidatosService.submitApplication` para consumir `/api/public/inscricao` sem sessão.

---

## Etapa 7 — Controle de Acessos (Fechaduras Inteligentes)

### Screen `/acessos`: `src/pages/Acessos.jsx` + `FechaduraModal.jsx`
- [x] Criar endpoints REST no backend (`server/routes/fechaduras.ts`):
  - [x] `GET/POST/PUT/DELETE /api/fechaduras`
  - [x] `GET /api/fechaduras/logs` (join com `locatarios(nome_completo)` e `fechaduras(nome)`, limite 50).
- [x] Verificar/portar fluxo completo de OTP e comandos (`server/services/lock-otp.ts`, `server/services/webhooks-service.ts`, `fechadura_verificacoes`, `fechadura_comandos`, `fechadura_logs`) acionado pelos webhooks da Meta (`/api/webhooks/meta`) e Zernio (`/api/webhooks/fechadura`).
- [x] Atualizar `src/services/fechaduras.js` e `src/components/FechaduraModal.jsx` (remover `supabase.from('fechaduras')` direto do modal).

---

## Etapa 8 — Configurações, Onboarding Zernio e Callback

### Screen `/configuracoes`: `src/pages/Configuracoes.jsx` + Cards de Integração
- [x] **Aba Zernio (`ZernioIntegrationCard.jsx`)**:
  - [x] Portar `zernio-integration` para `/api/integrations/zernio` (`status`, `save_key`, `select_profile`, `select_account`, `activate`, `disconnect`, `provision_webhook` apontando para `${APP_PUBLIC_URL}/api/webhooks/fechadura`).
  - [x] Portar `zernio-onboarding` (`start`, `cancel`) usando `${APP_PUBLIC_URL}/zernio/callback` como redirect base.
- [x] **Aba Meta Cloud API (`MetaIntegrationCard.jsx`)**:
  - [x] Portar `meta-integration` para `/api/integrations/meta` (`status`, `validate_manual`, `register`, `refresh`, `disconnect`, `activate`, `alerts`, `clear_alert`), retornando `webhookUrl = ${APP_PUBLIC_URL}/api/webhooks/meta`.
- [x] **Aba Notificações (`EmailNotificacoesCard.jsx`)**:
  - [x] Portar `email-settings` (`get`, `save`, `test`, `send_daily_summary`) usando `_shared/resend.ts` e `_shared/daily-summary.ts`.
- [x] **Aba Conta e Pagamentos (`Configuracoes.jsx`)**:
  - [x] Portar `get-secrets` e `save-secret` para `GET /api/account/secrets` e `POST /api/account/secrets` (salvando/lendo token do Mercado Pago cifrado).
  - [x] Atualizar perfil do usuário via `PUT /api/account/profile` (substituindo `usuariosService.update` + `resetPassword`).

### Screen `/zernio/callback`: `src/pages/ZernioCallback.jsx`
- [x] Migrar chamada `supabase.functions.invoke('zernio-onboarding', { body: { action: 'complete', ... } })` para `POST /api/integrations/zernio/onboarding/complete`.
- [x] Validar fluxo de retorno OAuth/Embedded Signup (sucesso, erro, cancelamento e estado expirado).

---

## Etapa 9 — Administração de Usuários

### Screen `/admin`: `src/pages/Admin.jsx` + `UserModal.jsx`
- [x] Criar endpoints administrativos protegidos por `requireAdmin`:
  - [x] `GET /api/admin/usuarios`
  - [x] `POST /api/admin/usuarios` (portando `admin-create-user`, criando usuário já com `password_hash` e `role` definidos).
  - [x] `PUT /api/admin/usuarios/:id` (portando RPC `admin_update_usuario`).
  - [x] `PATCH /api/admin/usuarios/:id/status` (portando RPC `admin_set_usuario_status`).
  - [x] `DELETE /api/admin/usuarios/:id` (portando `delete-user`, removendo usuário e dados em cascata).
- [x] Atualizar `src/services/usuarios.js` e `src/components/UserModal.jsx`.

---

## Etapa 10 — Empacotamento VPS ("Clone, `.env` e Start"), Testes e Limpeza

- [x] **Configuração única de ambiente**:
  - [x] Substituir `.env.example` e `supabase/functions/.env.example` por **um único `.env.example` na raiz** com:
    - `PORT`, `APP_PUBLIC_URL`, `DATABASE_PATH`, `UPLOAD_DIR`
    - `JWT_SECRET`, `ENCRYPTION_KEY` (64 hex chars)
    - `ADMIN_EMAIL`, `ADMIN_PASSWORD`
    - `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `META_WEBHOOK_VERIFY_TOKEN`
    - (Opcional) `SMTP_*` / `RESEND_SYSTEM_API_KEY` para recuperação de senha
- [x] **Deploy simplificado na VPS**:
  - [x] Criar `Dockerfile` + `docker-compose.yml` com volume persistente `./data:/app/data` (armazenando SQLite + `uploads/`).
  - [x] Adicionar configuração de exemplo de proxy reverso com HTTPS automático (`Caddyfile` ou Nginx + Certbot) — obrigatório para webhooks da Meta, Zernio e Mercado Pago.
  - [x] Atualizar `.gitignore` (`data/`, `*.db`, `*.db-wal`, `*.db-shm`, `.env`).
  - [x] Atualizar `README.md` com guia "Clone → preencha `.env` → suba em 1 comando" + instruções de backup consistente do SQLite (`sqlite3 sga.db ".backup ..."`).
- [x] **Testes e Limpeza Final**:
  - [x] Portar os testes de `supabase/tests/` (`daily-summary.test.ts`, `meta-alerts.test.ts`, `meta-messages.test.ts`) para a suíte do novo backend e adicionar testes de integração para Auth, SQLite multi-tenant e webhooks.
  - [x] Remover dependências e arquivos obsoletos do Supabase (`@supabase/supabase-js`, `supabase` CLI, `src/services/supabase.ts`, pasta `supabase/` após validar paridade total).
  - [x] Executar validação completa (`build`, `lint`, testes automatizados; deploy ponta a ponta em staging/VPS pronto para validação na infraestrutura de destino).
