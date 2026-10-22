-- Token publico por cobranca usado no botao de URL do template da Meta.
-- O botao aceita apenas um trecho dinamico no fim da URL, entao o SGA expoe
-- /pagar/<pay_token> e redireciona para o link real do Mercado Pago.
-- O token nao da acesso ao painel: a Edge Function `pay-link` usa service role
-- e devolve somente o redirecionamento daquela cobranca.
alter table public.cobrancas
  add column if not exists pay_token uuid not null default gen_random_uuid();

create unique index if not exists cobrancas_pay_token_key
  on public.cobrancas (pay_token);
