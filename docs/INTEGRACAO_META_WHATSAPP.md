# Integração Meta (WhatsApp Cloud API) no SGA

O SGA usa a **API oficial da Meta (WhatsApp Cloud API)** como alternativa à Zernio. O locador escolhe o provedor na rota `/configuracoes`, na aba **Meta Cloud API**, e o canal ativo fica gravado em `zernio_integracoes.provider`.

> A implementação atual cobre a **Fase 0** (modelo de dados e abstração de provedor) e a **Fase 1** (conexão do canal Meta). O envio de mensagens pela Meta está previsto nas fases 2 a 4 e ainda não está disponível: enquanto `provider = 'meta'`, os envios do SGA continuam usando o canal da Zernio.

## 1. O que já existe

| Peça | Arquivo |
| --- | --- |
| Colunas do provedor e credencial Meta | `supabase/migrations/025_whatsapp_provider_meta.sql` |
| Cifra AES-GCM compartilhada (`v1.` Zernio, `vm1.` Meta) | `supabase/functions/_shared/crypto.ts` |
| Cliente Graph API | `supabase/functions/_shared/meta-graph.ts` |
| Leitura pública da integração (Zernio + Meta) | `supabase/functions/_shared/whatsapp-provider.ts` |
| Edge Function de conexão | `supabase/functions/meta-integration/index.ts` |
| Tela | `src/components/MetaIntegrationCard.jsx` + aba em `src/pages/Configuracoes.jsx` |

## 2. Preparar o App da Meta

1. Crie um **App** em [developers.facebook.com](https://developers.facebook.com) do tipo *Business*.
2. Adicione o produto **WhatsApp**.
3. Em *WhatsApp > API Setup*, copie:
   - **Phone number ID** e **WhatsApp Business Account ID** (usados no modo manual);
   - o **Configuration ID** do Embedded Signup (`META_CONFIGURATION_ID`).
4. Crie um **Business Portfolio** e vincule-o ao App.
5. Gere um **System User access token** com as permissões:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `whatsapp_business_manage_events` (necessária para os webhooks da fase 4)
6. Em *Configurações do App > Básico*, copie o **App ID** e o **App Secret**.

### Secrets do Supabase

```bash
npx supabase secrets set --project-ref <PROJECT_REF> \
  META_APP_ID=<app-id> \
  META_APP_SECRET=<app-secret> \
  META_CONFIGURATION_ID=<configuration-id> \
  META_GRAPH_VERSION=v23.0
```

`META_ENCRYPTION_KEY` é opcional. Quando não existe, o SGA cifra os tokens da Meta com `ZERNIO_ENCRYPTION_KEY` (mesmo formato `v1.`/`vm1.`), de modo que a rotação de uma chave não invalida a outra sem querer.

## 3. Conectar o número

### Modo A — Embedded Signup (recomendado)

1. Em `/configuracoes > Meta Cloud API`, escolha **Conectar pela Meta**.
2. Informe o **PIN de 6 dígitos** da verificação em duas etapas do WhatsApp. Ele é enviado à Meta no registro do número e **não é guardado pelo SGA**.
3. Clique em **Conectar com a Meta**. O SDK do Facebook abre o cadastro embutido.
4. Ao voltar, o SGA troca o código pelo *business token*, descobre o WABA compartilhado, lista os números e:
   - com **um** número: registra o número, assina os webhooks e ativa o canal;
   - com **vários** números: abre uma lista para o locador escolher.

Fluxo no servidor (`meta-integration`):

```
POST /oauth/access_token            code → business token
GET  /oauth/access_token            fb_exchange_token → token de longa duração
GET  /debug_token                   granular_scopes[].target_ids → WABA ID
GET  /{waba_id}/phone_numbers       lista de números
POST /{phone_number_id}/register    { messaging_product: 'whatsapp', pin }
POST /{waba_id}/subscribed_apps     assina o webhook da WABA
```

### Modo B — Token e número manuais

Preencha **Token de acesso do sistema**, **Phone Number ID** e **WABA ID**. O SGA valida tudo na Graph API (`GET /{waba_id}`, `GET /{waba_id}/phone_numbers`, `GET /{phone_number_id}`) antes de gravar, e só então ativa o canal.

## 4. Trocar de provedor

- O provedor ativo fica em `zernio_integracoes.provider` (`'zernio'` ou `'meta'`).
- Cada aba mostra o botão **Usar este canal** quando o outro provedor está ativo.
- A configuração do provedor inativo é preservada: dá para voltar e para a Zernio sem reconfigurar nada.
- `remover` na aba Zernio agora **apaga apenas os campos da Zernio** (a linha é compartilhada entre os dois provedores).

## 5. Regras e limites da Meta

- O número precisa ser **registrado** em até 14 dias após o Embedded Signup, senão o cadastro precisa ser refeito.
- A verificação em duas etapas é obrigatória: sem PIN o registro falha.
- A verificação do negócio é feita pelo próprio locador no Meta Business e define o limite de mensagens e o selo de conta oficial.
- A partir de um mês, relatórios da Meta exigem Template de Marketing aprovado. A tela de modelos do SGA segue sendo a fonte de verdade dos templates (`zernio_whatsapp_templates`).

## 6. Fases seguintes

| Fase | Escopo |
| --- | --- |
| 2 | Coluna `provider` nas tabelas de templates e envios; `list`, `create_template`, `set_default` e `save_charge_order` despachando para a Graph API; conversor de `components` (formato de criação → formato de envio). **Entregue** (ver seção 5). |
| 3 | `send_charge`, envio manual, `zernio-message-scheduler` e confirmação de pagamento usando o provedor ativo. |
| 4 | Edge Function `meta-webhook` (verificação `GET`, assinatura `X-Hub-Signature-256`, inbound `messages` para o OTP das fechaduras e `statuses` de entrega). |

## 5. Templates por provedor (Fase 2, entregue)

A rota `/mensagens` já lê o provedor ativo e gerencia os templates do canal correspondente.

**No banco** (migration `026_whatsapp_template_provider.sql`):

- `zernio_whatsapp_templates.provider` (`zernio` | `meta`), com padrão `zernio` para os registros existentes.
- `account_id` passou a aceitar o Phone Number ID da Meta (`^[0-9]{10,20}$`) além do id de conta da Zernio (`^[a-fA-F0-9]{24}$`).
- A chave única virou `(id_usuario, provider, account_id, name, language)`, e o template padrão é exclusivo por provedor.
- O `status` aceitou os estados extras da Meta: `PENDING_DEPRECATION`, `LIMIT_EXCEEDED`, `DEPRECATED`, `ARCHIVED`, `DELETED` e `EXPIRED`.
- `provider` também foi adicionado a `zernio_whatsapp_deliveries`, `zernio_whatsapp_template_usages` e `zernio_whatsapp_manual_deliveries`.

**No backend** (`zernio-whatsapp`):

- `resolveChannel()` descobre o canal do provedor ativo a partir de `zernio_integracoes.provider`, descriptografa a credencial correta (`v1.` na Zernio, `vm1.` na Meta) e valida o canal remoto no caso da Zernio.
- `list` e `syncTemplates()` consultam a API do provedor: `GET /whatsapp/templates` na Zernio, `GET /{waba_id}/message_templates` (com paginação) na Meta.
- `create_template` usa `POST /whatsapp/templates` na Zernio e `POST /{waba_id}/message_templates` com `parameter_format: POSITIONAL` na Meta. O `components` usa o mesmo formato da Meta nos dois casos.
- `set_default` e `save_charge_order` gravam o `provider` junto do uso do template.
- `health` verifica o canal do provedor ativo.
- A resposta de `list` inclui `channel` (`provider`, `providerLabel`, `accountId`, `phoneNumber`, `label`), consumido pela interface.

**Na interface**: as abas **Templates Meta** e **Agendamentos Ativos** mostram o provedor e o canal em uso, com atalho para trocar o canal em `/configuracoes`.

**Limite desta fase**: o envio continua sendo feito apenas pela Zernio. Com o provedor Meta ativo, o envio manual e o agendamento respondem com uma mensagem explicativa, e o cron de lembretes marca a cobrança como `skipped` (sem enviar pelo canal errado e sem poluir o log de falhas). A cobrança permanece pendente e será retomada quando a fase de envio for ativada.

## 7. Referências

- [WhatsApp Business Platform — Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp)
- [Embedded Signup — implementação](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [Manage phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-phone-numbers)
- [Message Templates API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api)
- [Webhooks de mensagens](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks)
