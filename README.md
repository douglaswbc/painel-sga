# Painel SGA — Sistema de Gestão de Aluguel

Sistema web completo para gestão de locatários, veículos, contratos, cobranças PIX (Mercado Pago), triagem de candidatos, controle de acessos (fechaduras) e automação via WhatsApp (Zernio e Meta Cloud API).

A aplicação roda em **processo único** (Node.js/TypeScript + Express + React/Vite) com banco de dados **SQLite** (`node:sqlite`), armazenamento local de mídias e agendador interno (`node-cron`), sem dependências externas de BaaS.

---

## Subindo na VPS ("Clone → `.env` → Start")

### Requisitos

- **Docker** e **Docker Compose** (recomendado para produção) — ou **Node.js 22.13+ / 24+** para execução direta.
- Um domínio apontando para a VPS com **HTTPS** ativo (obrigatório para webhooks da Meta, Zernio e Mercado Pago).

### 1. Clone e configure o `.env`

```bash
git clone <URL_DO_REPOSITORIO> painel-sga
cd painel-sga
cp .env.example .env
```

Gere duas chaves aleatórias seguras para `JWT_SECRET` e `ENCRYPTION_KEY` (64 caracteres hexadecimais):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edite o `.env` e preencha no mínimo:

- `APP_PUBLIC_URL`: URL HTTPS pública do painel (ex.: `https://sga.seudominio.com`)
- `JWT_SECRET`: chave gerada (mínimo 32 caracteres)
- `ENCRYPTION_KEY`: chave hexadecimal de 64 caracteres *(não altere após salvar credenciais de locadores)*
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: conta inicial de administrador criada automaticamente no primeiro boot

### 2. Suba com 1 comando

**Com Docker + Caddy (HTTPS automático):**

Ajuste o domínio em [`Caddyfile`](Caddyfile) e execute:

```bash
docker compose --profile proxy up -d --build
```

**Com Docker apenas na porta local (quando Nginx/Certbot ou Caddy já estão no host):**

```bash
docker compose up -d --build
```

O volume `./data:/app/data` persiste automaticamente:
- `/app/data/sga.db` (banco SQLite em modo WAL)
- `/app/data/uploads/` (mídias enviadas nos templates)

**Sem Docker (Node.js 22.13+ / 24+):**

```bash
npm ci
npm run build && npm run build:server
npm start
```

---

## Proxy Reverso e Webhooks (HTTPS obrigatório)

Os provedores externos exigem HTTPS público válido apontando para:

| Integração | Endpoint |
| --- | --- |
| **Meta Cloud API (Webhook)** | `${APP_PUBLIC_URL}/api/webhooks/meta` |
| **Mercado Pago (PIX / Reserva)** | `${APP_PUBLIC_URL}/api/webhooks/mercadopago` |
| **Zernio (Fechaduras / Mensagens)** | `${APP_PUBLIC_URL}/api/webhooks/fechadura` |
| **Zernio (Callback OAuth)** | `${APP_PUBLIC_URL}/zernio/callback` |
| **Healthcheck** | `${APP_PUBLIC_URL}/api/health` |

Se preferir **Nginx + Certbot** no host em vez do [`Caddyfile`](Caddyfile), encaminhe o tráfego HTTPS para `http://127.0.0.1:3001` preservando `Host`, `X-Real-IP`, `X-Forwarded-For` e `X-Forwarded-Proto`.

---

## Backup Consistente do SQLite

Como o SQLite opera em modo WAL (`sga.db`, `sga.db-wal`, `sga.db-shm`), **não copie o arquivo diretamente com `cp` enquanto o servidor estiver rodando**. Use o comando `.backup` nativo do `sqlite3`:

**Via Docker:**

```bash
mkdir -p backups
docker compose exec app sqlite3 /app/data/sga.db ".backup '/app/data/sga-backup.db'"
mv data/sga-backup.db "backups/sga-$(date +%F-%H%M).db"
```

**Localmente (com `sqlite3` instalado):**

```bash
mkdir -p backups
sqlite3 data/sga.db ".backup 'backups/sga-$(date +%F-%H%M).db'"
```

---

## Desenvolvimento Local e Testes

```bash
npm install
npm run dev:server   # Backend Express + SQLite na porta 3001 (com watch)
npm run dev          # Frontend Vite na porta 5173 (proxy /api -> :3001)
```

### Comandos de verificação

```bash
npm run typecheck:server   # Checagem TypeScript do backend
npm run test:server        # Suíte de testes do backend (node:test)
npm run build              # Build de produção do frontend (dist/)
npm run build:server       # Compilação TypeScript do backend (dist-server/)
npm run lint               # ESLint em src/ e server/
```

---

## Estrutura do Projeto

- `server/`: backend Express + TypeScript (`routes/`, `services/`, `db/migrations/`, `cron/`, `middleware/`, `tests/`).
- `src/`: frontend React + Vite (`pages/`, `components/`, `contexts/`, `hooks/`, `services/`).
- `Dockerfile`, `docker-compose.yml`, `Caddyfile`: empacotamento e proxy reverso para deploy em VPS.
