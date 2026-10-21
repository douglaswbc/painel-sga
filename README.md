# SGA — Sistema de Gestão de Aluguel

Sistema web para gestão de locatários, veículos, contratos, cobranças e mensagens de WhatsApp. O frontend usa React e Vite; autenticação, banco e funções de backend usam Supabase.

## Requisitos

- Node.js 20.19+ ou 22.12+ e npm.
- Um projeto Supabase.
- Acesso à API da Zernio/WhatsApp Meta para usar mensagens e lembretes.
- Conta Mercado Pago para emitir cobranças PIX.

## Instalação local

1. Clone o repositório e instale as dependências:

   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd painel-sga
   npm ci
   ```

2. No Supabase, crie um projeto. Em **Project Settings → API Keys**, copie a URL do projeto e uma chave publicável (`sb_publishable_...`) ou a chave legada `anon`.

3. Crie `.env` na raiz a partir do exemplo e preencha os dois valores:

   ```bash
   cp .env.example .env
   ```

   No PowerShell, use `Copy-Item .env.example .env`.

   ```env
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY_OU_ANON>
   ```

4. Prepare o banco seguindo a seção **Banco de dados**.

5. Inicie o frontend:

   ```bash
   npm run dev
   ```

   Para gerar a versão de produção, use `npm run build`; `npm run preview` abre o build localmente.

## Banco de dados

### Projeto Supabase novo

1. Abra o **SQL Editor** do projeto vazio e execute `supabase/sql_banco.txt` uma única vez. Esse arquivo cria a estrutura base; ele não substitui as migrations.
2. Instale as migrations versionadas em ordem, usando o Supabase CLI incluído nas dependências:

   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF>
   npx supabase db push
   ```

   A lista atual vai de `001_encrypt.sql` até `016_dashboard_summary.sql`. `db push` registra e aplica as migrations pendentes. Revise qualquer erro de preflight antes de continuar.
3. Em **Storage**, confirme o bucket público `mensagens-midia`. O SQL base define as políticas de upload e leitura; os arquivos enviados ficam no caminho `<id-do-usuario>/<arquivo>`.

### Banco já existente

Não execute `sql_banco.txt`: ele é apenas para um projeto vazio. Confira o histórico e aplique apenas migrations pendentes:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

As migrations 003 e outras fazem validações de dados existentes e podem parar se encontrarem relações entre locadores ou datas inválidas. Corrija os registros apontados antes de tentar novamente. Não marque uma migration como aplicada sem confirmar que o SQL correspondente já foi executado.

Se migrations já foram executadas manualmente no SQL Editor, confira a diferença entre o esquema e `supabase_migrations.schema_migrations` antes de usar `db push`. Reconcilie o histórico com o Supabase CLI somente depois de confirmar quais arquivos foram realmente executados.

### Primeiro administrador

O app não tem cadastro público. Crie o primeiro usuário pelo Supabase Auth; depois, no SQL Editor, atribua o papel de administrador a esse e-mail:

```sql
update public.usuarios
set role = 'admin'
where email = 'admin@exemplo.com';
```

Depois entre pelo app e crie os demais usuários pela administração. A migration 003 faz usuários novos começarem com o papel seguro `locador`.

## Edge Functions e integrações

As Edge Functions recebem `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` automaticamente do Supabase. Configure os secrets próprios da aplicação no Dashboard ou pela CLI; nunca coloque chaves secretas em variáveis `VITE_*`.

1. Gere uma chave de criptografia Zernio com 32 bytes aleatórios (64 caracteres hexadecimais):

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Guarde a chave gerada. Não a troque depois de salvar integrações Zernio, pois os dados cifrados com a chave antiga deixam de ser decifrados.

2. Crie `supabase/functions/.env` a partir de `supabase/functions/.env.example`, preencha os valores e envie os secrets:

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   npx supabase secrets set --env-file supabase/functions/.env --project-ref <PROJECT_REF>
   ```

   Configure `ZERNIO_ENCRYPTION_KEY`, `ZERNIO_REDIRECT_BASE_URL` (URL HTTPS pública do app) e `MP_WEBHOOK_URL` (`https://<PROJECT_REF>.supabase.co/functions/v1/payment-webhook-receiver`). O arquivo local com os valores reais está ignorado pelo Git.

3. Publique as funções:

   ```bash
   npx supabase functions deploy --use-api --project-ref <PROJECT_REF>
   ```

4. Cada locador conecta sua própria conta Zernio e conclui o onboarding Meta na tela **Configurações**. Os templates usados na régua precisam estar aprovados pela Meta.

### Provedor de WhatsApp: Zernio ou Meta

A rota `/configuracoes` tem abas para o provedor de WhatsApp usado pelo SGA:

- **Zernio**: chave de API da Zernio, seleção de perfil e canal e onboarding pelo Embedded Signup da Zernio (completado na rota `/zernio/callback`).
- **Meta Cloud API**: API oficial da Meta, com dois caminhos de conexão — o Embedded Signup da Meta ou a entrada manual de um token do sistema, do Phone Number ID e do WABA ID.
- **Conta e Pagamentos**: nome, WhatsApp de contato, token do Mercado Pago e redefinição de senha.

O provedor em uso fica em `zernio_integracoes.provider` (`zernio` ou `meta`). A configuração do provedor inativo é preservada, e cada aba oferece o botão **Usar este canal** para alternar.

Para a integração Meta, configure os secrets `META_APP_ID`, `META_APP_SECRET`, `META_CONFIGURATION_ID` e `META_GRAPH_VERSION` (veja `supabase/secrets.txt`). `META_ENCRYPTION_KEY` é opcional: quando ausente, o token da Meta é cifrado com `ZERNIO_ENCRYPTION_KEY`.

O guia completo, com o passo a passo do App da Meta e o estado de cada fase, está em [`docs/INTEGRACAO_META_WHATSAPP.md`](docs/INTEGRACAO_META_WHATSAPP.md).

### Mercado Pago

O app chama as RPCs `create_user_mp_secret` e `get_user_mp_token` para salvar e recuperar o token privado de cada locador. Essas RPCs não estão definidas nas migrations deste repositório. Antes de usar Mercado Pago em uma instalação nova, provisionar e revisar essas funções no banco; não copie definições de um projeto sem conferir como o token e a chave de criptografia estão armazenados.

## Crons de faturamento e mensagens

Habilite `pg_cron`, `pg_net` e Vault no projeto. No **Database → Vault → Secrets**, crie:

- `sga_project_url`: `https://<PROJECT_REF>.supabase.co`.
- `sga_cron_api_key`: valor ativo da Secret API Key `default` (`sb_secret_...`). A função aceita essa chave apenas no cabeçalho `apikey`; não use uma chave publicável.

A chave Secret API Key `default` é diferente de uma senha de Edge Function. Não a grave no SQL versionado nem em `.env` do frontend. Depois, edite o project ref em `supabase/cron-example.txt` e execute o arquivo no SQL Editor para criar os três jobs, que rodam a cada cinco minutos. Em um projeto já configurado, `supabase/update-reminder-crons.sql` atualiza faturamento, lembretes PIX e agendamentos Meta. Confira os jobs com:

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
```

A emissão e os lembretes automáticos dependem também das credenciais Mercado Pago e da configuração do provedor de WhatsApp de cada locador.

## Comandos úteis

```bash
npm run dev       # desenvolvimento
npm run build     # build de produção
npm run lint      # ESLint
npm run preview   # servir o build localmente
```

## Estrutura relevante

- `src/pages` e `src/components`: telas e interface.
- `src/services`: acesso ao Supabase.
- `supabase/functions`: Edge Functions.
- `supabase/migrations`: alterações versionadas do banco.
- `supabase/sql_banco.txt`: estrutura base para banco vazio.
- `supabase/cron-example.txt`: configuração inicial dos crons.
- `supabase/functions/_shared`: módulos compartilhados pelas Edge Functions (criptografia, cliente Graph API e leitura do provedor).
- `docs`: guias de integração (Zernio, Instagram e Meta/WhatsApp Cloud API).
