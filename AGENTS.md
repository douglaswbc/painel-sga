# Diretrizes do Projeto — Painel SGA

## 1. Arquitetura Geral

- **Frontend**: React + Vite + Tailwind CSS em `src/`, comunicando com o backend via cliente HTTP centralizado (`src/services/api.js`) nas rotas `/api/*`, `/uploads/*` e `/pagar/*`.
- **Backend**: Node.js + TypeScript + Express em `server/` (`server/index.ts` e `server/app.ts`), servindo também o build estático do Vite (`dist/`) com fallback SPA em processo único.
- **Banco de Dados**: SQLite nativo (`node:sqlite` / `DatabaseSync` em `server/db/database.ts`) com `PRAGMA foreign_keys = ON`, `journal_mode = WAL` e `busy_timeout = 5000`.
- **Storage e Crons**:
  - Uploads locais em `UPLOAD_DIR` (`./data/uploads/mensagens-midia/<userId>/`, `server/routes/media.ts`).
  - Agendador interno com `node-cron` (`server/cron/scheduler.ts`): ciclo de 5 minutos (`faturamento`, `lembretes`, `agendamentos`) e resumo diário às 08:00 `America/Sao_Paulo` (`resumoDiario`).
- **Configuração**: Variáveis validadas estritamente no startup via Zod em `server/config/env.ts` e documentadas em `.env.example`.

---

## 2. Banco de Dados SQLite e Migrations (`server/db/`)

1. **Migrations Versionadas e Imutáveis**:
   - Toda alteração estrutural (novas tabelas, colunas, índices, views) deve ser adicionada como uma nova migration em `server/db/migrations/` e registrada no array `MIGRATIONS` em `server/db/database.ts`.
   - **Nunca modifique** uma migration já aplicada em produção (`_migrations`); crie uma nova migration sequencial de 3 dígitos (ex.: `002_nova_coluna.ts`).
   - Garanta idempotência (`IF NOT EXISTS`, etc.).
2. **Convenções SQLite do Projeto**:
   - Chaves primárias `TEXT` devem receber UUID gerado na aplicação (`crypto.randomUUID()`).
   - Booleanos são armazenados como `INTEGER` (`0` ou `1` com `CHECK (... IN (0, 1))`) e convertidos explicitamente para `boolean` nas respostas JSON.
   - Datas de vencimento seguem `YYYY-MM-DD` no fuso `America/Sao_Paulo`; timestamps seguem ISO-8601 UTC.
3. **Integridade Referencial em Exclusões**:
   - Tabelas como `cobrancas` e `contratos` possuem FKs compostas para `locatarios(id, id_usuario)` (`ON DELETE RESTRICT` / `NO ACTION`). Operações de exclusão em cascata (como remoção de usuário em `server/routes/admin.ts`) devem apagar registros filhos na ordem segura dentro de transação `BEGIN IMMEDIATE ... COMMIT`.

---

## 3. Autenticação, Multi-Tenancy e Segurança

1. **Isolamento Multi-Tenant Obrigatório**:
   - Toda rota/query de domínio deve filtrar explicitamente por `id_usuario = req.user.id` e validar vínculos entre entidades do mesmo locador.
   - Não confie em `id_usuario` enviado no corpo da requisição.
2. **Separação de Papéis (`admin`, `locador`, `locatario`)**:
   - **`admin`**: acessa exclusivamente a **Administração Global** (`/admin` e `/api/admin/*` protegidos por `requireAdmin`). A interface oculta menus operacionais de frota e o backend bloqueia autoexclusão, autoalteração de `role` e autodesativação.
   - **`locador`**: dono de frota; credenciais de WhatsApp (`zernio_integracoes`), templates, agendamentos e notificações por e-mail (`email_notificacoes_config`) são configuradas individualmente por locador (validado via `assertActiveLandlord`).
3. **Proteção de Credenciais e Campos Sensíveis**:
   - Senhas usam `scrypt` + `timingSafeEqual`; sessões usam JWT em cookie HttpOnly (`sga_token`) ou `Authorization: Bearer` (`server/middleware/auth.ts`).
   - Dados e tokens privados (`documento_enc`, `cpf_enc`, `mp_token_ciphertext`, `api_key_ciphertext`, `meta_access_token_ciphertext`, `webhook_secret_ciphertext`) são cifrados com AES-256-GCM + AAD (`ownerId`) em `server/utils/crypto.ts`.
   - Nunca retorne `password_hash`, `*_ciphertext` ou `reset_token_hash` em respostas da API.

---

## 4. Integrações e Webhooks

- **WhatsApp**: cada locador escolhe entre **Zernio** (chave + seleção de canal/onboarding `/zernio/callback`) ou **Meta Cloud API** (token do sistema + Phone Number ID + WABA ID; sem Embedded Signup).
- **Webhooks Públicos (`server/routes/webhooks.ts`)**:
  - `GET/POST /api/webhooks/meta` (validação `X-Hub-Signature-256` usando `req.rawBody`).
  - `POST /api/webhooks/mercadopago` (baixa automática de cobranças e reservas).
  - `POST /api/webhooks/fechadura` (validação HMAC-SHA256 por conta Zernio usando `req.rawBody` + fluxo OTP).
- **URLs Externas**: derivadas exclusivamente de `APP_PUBLIC_URL` (sem domínios hardcoded).

---

## 5. Verificação Antes de Concluir Alterações

Sempre que alterar código de backend ou frontend, valide com:

```bash
npm run typecheck:server
npm run build:server
npm run build
npm run lint
npm test
```
