# Plano de trabalho: Zernio e faturamento do SGA

## Decisão de arquitetura

- Cada locador usará a **própria chave de API do Zernio** e a própria conta/perfil/canal WhatsApp.
- O SGA deverá resolver a chave a partir do usuário autenticado em cada operação. Nunca aceitar `userId` arbitrário para escolher credenciais.
- A chave Zernio é um segredo: não pode ficar em código do frontend, `localStorage`, logs, mensagens de erro ou respostas da API ao navegador. O frontend chama funções Supabase; somente elas chamam o Zernio.
- Guardar a chave criptografada no banco, com leitura e gravação restritas ao backend. Permitir que o locador valide, atualize e remova sua chave sem revelar a chave já salva.
- O fluxo deve suportar perfis e canais que pertencem à chave daquele locador. Não assumir que todos os locadores compartilham uma equipe ou API key Zernio.

## Fase 1 — Corrigir o faturamento automático

- [x] Atualizar `supabase/cron-example.txt` para chamar a Edge Function existente `faturamento-cobrancas` (o exemplo atual usa `gerar-cobrancas-diarias`).
- [x] Remover do cron o `userId` fixo; executar para todos os locadores ou usar uma rotina de processamento por locador, sem deixar nenhum de fora.
- [x] Unificar o formato de `contratos.recorrencia` entre o modal e as Edge Functions, aceitando também os rótulos legados.
- [x] Corrigir a conversão de data do contrato para preservar o dia local de São Paulo e não reiniciar a recorrência ao editar outros campos.
- [x] Tornar a criação idempotente e segura para execuções simultâneas do cron e do botão manual, com chave estável do Mercado Pago, ciclo de cobrança único e reconciliação após falhas parciais.
- [x] Fazer `cobrar-contrato` autenticar o locador e verificar que o contrato pertence a ele antes de usar credenciais administrativas.
- [x] Mostrar na interface o resultado por contrato, inclusive falhas retornadas com HTTP 200.
- [x] Retornar falhas por contrato e permitir reprocessamento seguro sem criar uma segunda cobrança.

**Estado:** código, migration e crons aplicados no Supabase pelo responsável pelo projeto. A migration foi ajustada para preservar cobranças históricas duplicadas e associar apenas uma cobrança ao ciclo recorrente.

### Critérios de conclusão

- O cron chama a função existente e processa os contratos de todos os locadores elegíveis.
- Uma recorrência semanal ou quinzenal permanece semanal ou quinzenal depois de salvar e faturar.
- Cobranças respeitam a data local configurada e não duplicam quando cron e usuário tentam faturar ao mesmo tempo.
- A interface distingue sucesso, falha e cobrança já existente, com o contrato afetado.

## Fase 2 — Corrigir e endurecer o banco

- [x] Criar migrações incrementais para bancos existentes; não depender de recriar as tabelas em `supabase/sql_banco.txt`.
- [x] Mudar `cobrancas.data_vencimento` de `text` para `date`, com validação prévia e indicação dos IDs que precisam de correção.
- [x] Ativar RLS e criar políticas por `auth.uid()` para as tabelas com dados de locador, locatário, veículo, contrato, cobrança, templates, candidatos e fechaduras.
- [x] Garantir no banco, com FKs compostas, que registros relacionados pertencem ao mesmo `id_usuario`; a migration interrompe e lista IDs se encontrar vínculos cruzados.
- [x] Manter a unicidade de ciclo da migration 002 e adicionar índices para relacionamentos e consultas de cobrança.
- [x] Restringir upload/exclusão do Storage à pasta do usuário. A leitura pública foi mantida por compatibilidade com as URLs atuais de mídia; migrar para URLs privadas exige adaptar o envio.
- [x] Alterar `handle_new_user` para iniciar com papel `locador`; a criação administrativa atribui o papel solicitado via Edge Function com service role.
- [x] Exigir autenticação e papel `admin` nas Edge Functions `admin-create-user` e `delete-user`, que executam operações privilegiadas.
- [x] Revogar acesso do cliente às colunas de segredo de `usuarios`, bloquear as RPCs de criptografia para `anon` e corrigir a volatilidade; a execução de `decrypt_val` por `authenticated` é necessária para a view `locatarios_safe`, cujas linhas são limitadas por RLS por locador.
- [ ] Confirmar no projeto Supabase a estrutura real de `app_config` e as RPCs `get_user_mp_token`/`create_user_mp_secret`, que são chamadas pelas Edge Functions mas não estão definidas no repositório; provisionar/documentar após conferir como os segredos existentes foram armazenados.
- [x] Identificar `supabase/sql_banco.txt` como referência de instalação inicial e alinhar nele o tipo `date`.

**Estado:** migration `003_security_and_integrity.sql` aplicada no Supabase pelo responsável pelo projeto. Os ajustes de frontend e Edge Functions preparados com ela precisam estar publicados para que todos os fluxos administrativos usem as novas permissões.

### Critérios de conclusão

- Um locador autenticado só pode ler ou alterar os próprios dados pelas APIs do Supabase. (migration aplicada; requer validação ponta a ponta)
- O banco rejeita relações entre registros de locadores diferentes e duplicatas de cobrança. (migration aplicada)
- Segredos só podem ser descriptografados por rotinas autorizadas do backend. (migration aplicada; pendente confirmar estrutura de segredos legados)

**Ajuste posterior:** `008_locatarios_safe_decrypt_grant.sql` concede `EXECUTE` de `decrypt_val(bytea)` a `authenticated`, necessário porque `locatarios_safe` usa `security_invoker`; `anon` e `PUBLIC` continuam sem acesso e as linhas da tabela permanecem limitadas por RLS.

## Fase 3 - Persistir e validar a chave Zernio de cada locador

- [x] Criar a migration `004_zernio_integration.sql` com credencial cifrada, estado de validação, `profileId`, `accountId`, metadados do canal e datas de atualização.
- [x] Criar a Edge Function autenticada `zernio-integration` para validar, salvar, atualizar, remover e selecionar metadados da chave do locador atual.
- [x] Validar a chave consultando a API do Zernio no servidor e só salvá-la depois da validação bem-sucedida.
- [x] Listar perfis e canais WhatsApp acessíveis com aquela chave; verificar no servidor o perfil e o canal antes de gravar a seleção.
- [x] Apresentar orientação se nao houver perfil/canal e nao associar silenciosamente uma conta.
- [x] Não devolver a chave ao frontend; devolver apenas presença/estado, sufixo curto e metadados selecionados.

**Estado:** o responsavel confirmou que a migration 004 foi aplicada e `ZERNIO_ENCRYPTION_KEY` configurada no Supabase. Código e frontend estao preparados; falta publicar a Edge Function e o frontend. A chave de criptografia deve permanecer fora do `.env` do Vite.

## Fase 4 - Onboarding Meta e retorno ao SGA

- [x] Criar o fluxo que usa a chave Zernio do locador e o `profileId` escolhido para obter a URL de onboarding WhatsApp.
- [x] Permitir selecionar explicitamente o modo `api` ou coexistencia com WhatsApp Business, explicando as diferenças.
- [x] Criar estado de onboarding aleatório, de uso único, vinculado ao locador/perfil e com expiração; armazenar somente o hash.
- [x] Criar a tela de callback que trata sucesso, cancelamento, erro da Meta, sessão expirada e retorno sem canal confirmado.
- [x] Validar o `accountId` consultando a Zernio com a chave do locador e conferir perfil, plataforma e estado antes de salvar.
- [x] Atualizar Configuracoes e permitir iniciar reconexão ou desconectar o canal.

**Estado:** implementação local pronta. A migration `005_zernio_onboarding.sql` precisa ser aplicada no Supabase; configurar também `ZERNIO_REDIRECT_BASE_URL` com a origem HTTPS publica do SGA, publicar `zernio-onboarding` e o frontend. O retorno exige que o dominio publico sirva a rota SPA `/zernio/callback`.

### Criterios de conclusao

- O locador inicia no SGA, conclui o onboarding da Meta e retorna ao SGA com resultado visível.
- Parâmetros alterados manualmente na URL não permitem vincular canal de outro perfil ou locador.
- Cancelamento ou falha não gravam um novo canal como conectado.

## Fase 5 - Templates Meta e envio de cobrancas

- [x] Criar a Edge Function `zernio-whatsapp` para sincronizar/listar templates, criar template transacional e consultar a aprovacao remota pela chave e canal do locador autenticado.
- [x] Persistir nome, idioma, categoria, status Meta, motivo de rejeicao, componentes, mapeamento de variaveis e escolha do template padrao.
- [x] Exibir estados `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`, `IN_APPEAL` e `PENDING_DELETION`; o backend so envia templates `APPROVED` confirmados na Meta.
- [x] Definir o template UTILITY da cobranca com locatario, valor, vencimento e link PIX, incluindo exemplos para analise da Meta.
- [x] Ligar o envio manual de cobrancas do Dashboard a um template aprovado. Se ainda nao houver link, o SGA gera e salva o PIX antes do envio.
- [x] Registrar o `messageId`, conversa, status e erro seguro; proteger concorrencia e repeticoes com idempotencia local e da Zernio.
- [x] Centralizar criacao e gestao dos templates Meta na rota `/mensagens`, remover a criacao manual de modelos legados e manter os registros existentes para os agendamentos ainda em uso.
- [x] Adicionar formulário guiado com categorias, idiomas, componentes Meta, exemplos de variáveis, limites, botões interativos e prévia de WhatsApp; permitir classificar templates UTILITY compatíveis para cobranças do SGA.

**Estado:** implementação local concluída. Os fluxos de cobrança e mensagem foram migrados na fase 6; a ativação de banco, Edge Functions e interface em produção está listada na fase 7.

### Criterios de conclusao

- O locador cria o template e acompanha a revisao da Meta; somente um aprovado pode ser escolhido e usado.
- A cobranca e enviada com nome, valor, vencimento e link PIX mapeados nas posicoes definidas pelo template.
- Falhas ficam no historico sem marcar a cobranca como enviada; repeticoes nao geram uma segunda mensagem.

### Agendamentos Meta na rota `/mensagens`

- [x] Remover as abas de modelos legados da rota e manter Templates Meta e Agendamentos Ativos.
- [x] Criar agendamento recorrente a partir de template Meta aprovado, com locatário, variáveis, frequência, data e horário.
- [x] Listar e permitir pausar, reativar ou excluir agendamentos; identificar os registros antigos como legados.
- [x] Adicionar envio recorrente idempotente por Zernio e registrar tentativas/erros.

**Estado:** implementação local pronta. Aplicar `007_zernio_message_scheduling.sql`, publicar `zernio-whatsapp` e `zernio-message-scheduler`, e instalar os crons de `supabase/cron-example.txt`. A migration 009 pausa os agendamentos antigos de texto livre.

## Fase 6 — Substituir Evolution e RyzeAPI

- [x] Migrar `reenvio-cobranca`, `gerar-cobranca-pix`, `enviar-lembretes-cobranca` e `agendador-mensagens-avulsas` para o serviço Zernio ou desativar as rotas antigas sem deixar chamadas Evolution ativas.
- [x] Migrar `ryze-proxy`, `instance-status`, `create-instance`, `admin-create-user` e `delete-user`; remover criação/estado de instâncias da Evolution da interface e do cadastro.
- [x] Migrar `payment-webhook-receiver` para localizar a integração/canal e o template de confirmação aprovado por locador.
- [x] Migrar `webhook-fechadura` para webhook assinado Zernio, preservando OTP, autorização, auditoria e deduplicação.
- [x] Atualizar Configurações, telas de mensagens, onboarding de usuários e nomes ativos da interface que indicavam Evolution/RyzeAPI.
- [x] Remover localmente código e documentação operacional de Evolution/RyzeAPI; deixar colunas antigas para remoção controlada pela migration 012 após validação em produção.

### Progresso de implementação local

- [x] Remover da tela Configurações o estado, QR Code e gerenciamento de instâncias Evolution; a conexão passa pelo cartão Zernio.
- [x] Remover criação automática de instância ao cadastrar locador e chamada à Evolution ao excluir usuário.
- [x] Trocar o envio avulso por seleção de templates gerais aprovados da Meta e envio pelo canal Zernio.
- [x] Migrar o cron de lembretes vencidos para `zernio-whatsapp` com o template de cobrança aprovado e idempotência por cobrança.
- [x] Remover os diretórios locais das Edge Functions legadas sem chamadas ativas; suas versões já implantadas precisam ser apagadas no Supabase após publicar as funções novas.
- [ ] Aplicar `009_disable_evolution_message_schedules.sql`; ele pausa agendamentos antigos de texto livre que não podem ser convertidos automaticamente em templates aprovados.
- [x] Migrar as mensagens de confirmação de pagamento para template UTILITY aprovado, configurado por locador na aba Templates Meta.
- [x] Migrar o webhook de fechaduras para webhooks assinados Zernio, preservando deduplicação e fluxo OTP.
- [ ] Aplicar `010_zernio_lock_webhooks.sql` e `011_zernio_payment_confirmation_templates.sql` antes de publicar as funções correspondentes.
- [ ] Depois de validar os fluxos em produção, aplicar `012_remove_ryze_credentials.sql`, excluir no Supabase as funções implantadas sem uso e remover secrets Evolution antigos.

**Estado:** migração local concluída. A ativação em produção ainda exige aplicar `009`, `010` e `011`, publicar as Edge Functions e o frontend atualizados, configurar o webhook Zernio no cartão de integração e validar OTP/callback de pagamento. Depois da validação, aplicar `012`, excluir as antigas funções já implantadas e retirar secrets Evolution do Supabase.

### Critérios de conclusão

- Nenhum fluxo operacional de WhatsApp depende de Evolution ou RyzeAPI.
- Cada mensagem usa a credencial e o canal do locador dono do evento/cobrança.
- Recursos que deixarem de existir (por exemplo, controles de instância Evolution) foram removidos da interface sem quebrar os fluxos mantidos.

## Fase 7 — Operação e implantação

- [x] Atualizar README, exemplo de secrets, cron e esquema base para Zernio; a chave Zernio de cada locador fica cifrada no banco, não no `.env` do Vite.
- [x] Remover o exemplo de secrets Evolution e corrigir o esquema-base para não incluir `ryze_instance`/`ryze_token`.
- [x] Remover do repositório as Edge Functions legadas sem chamadas ativas e criar migration `012_remove_ryze_credentials.sql` para a limpeza do banco após validação.
- [ ] Aplicar migrations `009`–`011`, publicar Edge Functions/frontend/crons Zernio e validar integração, OTP, templates, cobrança e callback em produção.
- [ ] Fazer uma validação ponta a ponta em ambiente controlado, incluindo isolamento entre dois locadores e revisão dos logs sem exposição de tokens ou dados pessoais completos.
- [ ] Só após validar os fluxos, aplicar migration `012`, remover no Supabase as funções já implantadas `agendador-mensagens-avulsas`, `create-instance`, `gerar-cobranca-pix`, `instance-status`, `reenvio-cobranca` e `ryze-proxy`, e excluir `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` dos secrets do projeto.

Para apagar uma função já implantada, use `supabase functions delete <nome> --project-ref <project-ref>` para cada função listada acima. Não use `--prune`, pois isso também removeria quaisquer outras funções remotas sem pasta local.

## Inventário inicial verificado

- Faturamento automático: `supabase/functions/faturamento-cobrancas/index.ts`.
- Cobrança individual: `supabase/functions/cobrar-contrato/index.ts`.
- Modal de contrato com recorrências legadas: `src/components/ContratoModal.jsx`.
- Exemplo de cron com endpoint antigo e `userId` fixo: `supabase/cron-example.txt`.
- Esquema base revisado: `supabase/sql_banco.txt`.
- Migração de criptografia revisada: `supabase/migrations/001_encrypt.sql`.
- Integrações legadas Evolution/Ryze removidas do código ativo; migration `003` preservada como histórico de implantação.

## Ordem recomendada

1. Corrigir cron, recorrência, datas e idempotência do faturamento.
2. Aplicar migrações de banco, RLS e armazenamento seguro de segredos.
3. Implementar cadastro/validação da chave individual do Zernio.
4. Implementar conexão Meta e retorno ao SGA.
5. Implementar templates e envio de mensagens.
6. Migrar os demais fluxos WhatsApp e retirar Evolution/RyzeAPI.
7. Validar ponta a ponta e concluir a implantação.

## Plano de trabalho: rota `/triagem`

### Objetivo

Concluir o fluxo de análise de candidatos e reserva de vaga, com status consistentes entre a interface, o Mercado Pago e o webhook, além de controles claros para a operação diária.

### Etapa 1 — Alinhar o fluxo e os status

- [x] Conferir os status existentes em produção e identificar registros que usam nomes diferentes para a mesma etapa.
- [x] Definir os status canônicos: `Em análise`, `Pré-aprovado`, `Aguardando reserva`, `Vaga reservada` e `Reprovado`.
- [x] Mapear na interface estados legados como `Aguardando Processamento` e `Reserva Confirmada` para os nomes canônicos sem alterar registros históricos.
- [x] Restringir as ações disponíveis conforme o status atual e impedir que uma ação comum sobrescreva uma reserva já confirmada.
- [x] Definir o fluxo provisório de confirmação: somente o webhook confirma automaticamente; a ação manual fica desabilitada até haver registro de operador, data e motivo na etapa 3.

**Critério de conclusão:** a interface e o backend usam os mesmos status, e cada candidato só pode avançar por transições válidas.

**Progresso:** produção tinha um candidato com status `Aguardando Reserva` e default `Aguardando Processamento`; nenhum registro foi alterado. A migration 019 foi aplicada e registrada, e o novo default remoto `Em análise` foi confirmado. A Edge Function `payment-webhook-receiver` foi publicada com a gravação do status canônico. As mudanças de interface permanecem locais.

- [x] Criar a migration `019_triagem_canonical_status_default.sql` para que novos candidatos usem `Em análise`, sem alterar registros existentes.
- [x] Aplicar e registrar a migration 019 no Supabase depois de conferir os status existentes no ambiente de produção.

**Atenção para operações futuras:** o responsável confirmou que as migrations 001–016 já foram publicadas. Mesmo assim, `supabase migration list` não as reconhece no histórico remoto e mostra também a versão `20260325222643` sem arquivo local. A migration 019 foi aplicada isoladamente; reconciliar o histórico antes do próximo `db push`, pois o CLI pode tentar aplicar migrations antigas.

### Etapa 2 — Implementar a criação da reserva PIX

- [x] Criar localmente a Edge Function `create-reservation-pix`, chamada pelo frontend.
- [x] Exigir sessão autenticada e confirmar que o candidato pertence ao locador autenticado antes de gerar a cobrança.
- [x] Obter a credencial do Mercado Pago no backend usando `get_user_mp_token`; nunca enviar o token ao navegador.
- [x] Criar a cobrança com chave de idempotência persistida no candidato para proteger repetições, concorrência e timeout.
- [x] Persistir no candidato o identificador do pagamento, os dados PIX, o vencimento e os status de reserva e pagamento.
- [x] Retornar ao frontend os campos esperados pelo modal: QR Code e código copia e cola.
- [x] Tratar PIX pendente existente, pagamento já confirmado, PIX expirado, credencial/webhook ausente e falha parcial.
- [x] Capturar o e-mail do candidato antes da cobrança; a API PIX exige e-mail e o schema de produção não tinha esse campo.
- [x] Criar a migration `020_candidate_reservation_pix.sql` com os campos `email` e `reserva_idempotency_key`.
- [x] Confirmar que o secret `MP_WEBHOOK_URL` está cadastrado no projeto Supabase.
- [x] Aplicar e registrar a migration 020 e publicar `create-reservation-pix` no Supabase.
- [x] Publicar as alterações do frontend que solicitam o e-mail e o enviam junto com o pedido de PIX.

**Critério de conclusão:** um candidato pré-aprovado recebe uma cobrança PIX única, vinculada ao próprio registro e ao locador correto.

**Progresso:** migration 020 aplicada e registrada; `create-reservation-pix` publicada. Confirmei remotamente as colunas `email` e `reserva_idempotency_key`. O frontend atualizado em `candidatosService` e `/triagem` foi publicado no Cloudflare Pages. O secret `MP_WEBHOOK_URL` está cadastrado. PIX expirado fica bloqueado até a etapa de reconciliação, para evitar gerar cobrança duplicada enquanto o webhook do pagamento anterior pode estar pendente.

### Etapa 3 — Unificar a confirmação de pagamento

- [x] Ajustar `payment-webhook-receiver` para reconhecer a cobrança de reserva e atualizar `pagamento_status`, `status`, `reserva_confirmada_em` e `updated_at` de forma consistente.
- [x] Tornar o processamento repetido do webhook idempotente, sem duplicar notificações ou reverter o estado da reserva.
- [x] Definir como tratar pagamentos recusados, cancelados, expirados, devolvidos e contestados; falhas terminais liberam nova tentativa, devoluções liberam a vaga e disputas mantêm a reserva sinalizada.
- [x] Implementar confirmação manual autenticada, limitada ao proprietário do candidato, com motivo obrigatório e trilha de auditoria; pagamentos PIX ainda ativos bloqueiam a ação.
- [x] Atualizar a lista da triagem a cada 15 segundos enquanto a tela está visível e após confirmação manual.
- [x] Criar a migration `021_candidate_reservation_reconciliation.sql` com histórico de tentativas PIX, auditoria e RPC transacional para confirmação manual.

**Critério de conclusão:** o status exibido na triagem representa o estado real da cobrança e da vaga, inclusive após notificações repetidas ou fora de ordem.

**Progresso:** migration 021 aplicada e registrada no Supabase; `payment-webhook-receiver` e `create-reservation-pix` publicados. O histórico remoto confirma a versão 021, e as duas funções constam como ativas (`payment-webhook-receiver` sem JWT obrigatório; `create-reservation-pix` com JWT obrigatório). A configuração local registra essas opções. O frontend permanece local e precisa ser publicado antes da validação ponta a ponta. A migration faz backfill das cobranças PIX já associadas aos candidatos para que notificações atrasadas continuem identificáveis. Ainda falta validar em produção os cenários listados na etapa 6.

### Etapa 4 — Completar estados e ações da tela

- [x] Exibir estados distintos de carregamento, erro com opção de tentar novamente e fila vazia.
- [x] Adicionar atualização manual da lista e impedir ações duplicadas enquanto uma operação está em andamento.
- [x] Mostrar mensagens claras quando a criação do PIX falhar ou quando já existir uma cobrança ativa.
- [x] Permitir abrir novamente os dados PIX de uma reserva pendente, desde que a cobrança ainda esteja válida.
- [x] Exibir pontuação ausente de forma clara, sem apresentar `null` ou `undefined`.
- [x] Mostrar confirmação antes de reprovar um candidato ou confirmar uma reserva manualmente.

**Critério de conclusão:** cada ação informa seu resultado, mantém a lista sincronizada e oferece recuperação clara para erros comuns.

**Progresso:** implementação local concluída e validada com `npm.cmd run build`. A interface oferece carregamento, erro recuperável, fila vazia, atualização manual e periódica, reabertura do PIX válido e mensagens específicas retornadas pela Edge Function. O frontend ainda precisa ser publicado para que essas mudanças cheguem à produção.

### Etapa 5 — Busca, filtros e ficha do candidato

- [x] Adicionar busca por nome e telefone e filtros por status.
- [x] Permitir ordenar por pontuação e data de entrada na fila.
- [x] Criar uma ficha do candidato com respostas disponíveis no formulário, pontuações, status, dados da reserva, tentativas PIX e histórico de alterações.
- [x] Mascarar o CPF na lista e mostrar o dado completo somente na ficha, sob a RLS do proprietário autenticado.
- [x] Incluir paginação na lista de resultados, com 20 candidatos por página.
- [x] Criar a migration `022_candidate_status_audit.sql` para registrar mudanças de status e pagamento a partir de sua publicação, preservando o motivo da confirmação manual.

**Critério de conclusão:** operadores conseguem localizar candidatos, entender decisões e acompanhar o histórico sem expor dados pessoais na lista geral.

**Progresso:** migration 022 aplicada e registrada no Supabase; ela passa a auditar transições de status e pagamento. O frontend da ficha ainda está local e precisa ser publicado para exibir busca, filtros, paginação e histórico. Confirmações manuais anteriores permanecem no histórico; alterações antigas sem auditoria não podem ser reconstruídas.

### Etapa 6 — Fechar a entrega operacional

- [x] Conferir remotamente o RLS: `candidatos` usa política `ALL` limitada a `id_usuario = auth.uid()`; histórico de pagamentos e auditoria permite leitura somente ao proprietário; RLS está ativo nas três tabelas.
- [x] Documentar os secrets e a configuração do webhook necessários para a Edge Function de reserva; o secret `MP_WEBHOOK_URL` está configurado e o endpoint esperado consta em `.env.example`, `supabase/secrets.txt` e README.
- [ ] Fazer validação manual do fluxo: aprovação, geração e reabertura do PIX, pagamento aprovado, repetição do webhook, expiração e confirmação manual. O frontend já foi publicado; a validação de pagamento segue pendente por falta de sandbox/teste Mercado Pago. Nenhuma cobrança real foi criada.
- [x] Atualizar este plano com o estado real de implantação das migrations, Edge Functions e frontend.

**Critério de conclusão:** o fluxo pode ser acompanhado de ponta a ponta e cada implantação pendente está registrada sem confundir código local com produção.

**Estado verificado em 06/10/2026:** migrations 019–024 aplicadas e registradas; `create-reservation-pix` ativa com JWT obrigatório e `payment-webhook-receiver` ativa sem JWT obrigatório. RLS e presença do secret `MP_WEBHOOK_URL` foram conferidos remotamente sem consultar dados pessoais ou revelar valores secretos. O frontend foi publicado no Cloudflare Pages (conforme informado pelo responsável); build e lint direcionado aos arquivos da triagem passam. O lint global ainda aponta erros preexistentes em arquivos fora da triagem e avisos de globais Deno nas Edge Functions. A validação ponta a ponta também segue pendente porque não há sandbox Mercado Pago; não executar teste que possa gerar uma cobrança real.

## Inscrição pública de candidatos vinculada à rota `/triagem`

### Objetivo e fluxo

O locador gera e compartilha um link individual pela rota `/triagem`. O candidato abre `/inscricao/:codigo`, preenche os dados e envia a inscrição sem criar conta. O backend valida o link, grava a candidatura vinculada ao locador que o criou e inicia o status `Em análise`; a candidatura então aparece na fila existente de triagem.

### Etapa 1 — Implementar o fluxo local

- [x] Criar a rota pública `/inscricao/:codigo`, fora da área autenticada do painel.
- [x] Adicionar à `/triagem` a geração, cópia, rotação e desativação do link individual do locador, com toggle de estado, validade restante e correções de contraste.
- [x] Criar a Edge Function autenticada `candidate-application-link`; guardar somente o hash do código e expirar o link após 90 dias.
- [x] Criar `submit-candidate-application` sem JWT, validando o link, CPF, campos, aviso de privacidade, honeypot e tempo mínimo de preenchimento antes de inserir.
- [x] Vincular a inscrição ao `id_usuario` obtido exclusivamente do link, começar em `Em análise`, impedir CPF repetido para o mesmo locador e auditar o recebimento.
- [x] Limitar cada link a 50 envios diários no banco e não expor acesso público direto às tabelas.
- [x] Mostrar na ficha do candidato a origem e a versão/data do aviso de privacidade aceito.
- [x] Aplicar e registrar a migration `023_public_candidate_applications.sql` no Supabase.
- [x] Publicar as Edge Functions `candidate-application-link` (`verify_jwt = true`) e `submit-candidate-application` (`verify_jwt = false`).
- [x] Publicar o frontend no Cloudflare Pages.
- [ ] Testar link válido, expirado/desativado, CPF duplicado, limite diário e isolamento entre dois locadores.

**Estado em 06/10/2026:** migration 023 executada e registrada no projeto `cobranca_car`; confirmei remotamente a tabela de links, RLS ativo e RPC de limite diário. As duas Edge Functions estão ativas com as opções JWT esperadas; `candidate-application-link` foi atualizada para retornar o estado e a expiração do link ao painel. O frontend foi publicado no Cloudflare Pages (conforme informado pelo responsável); validar a geração/envio com links válidos, expirados/desativados, CPF duplicado, limite diário e isolamento entre locadores. O formulário pede campos do fluxo existente de candidatos, apresenta aviso de privacidade e não oferece consulta pública de status. O limite de 50 inscrições por link/dia e o campo honeypot são controles básicos contra abuso; acompanhar envios e erros após a publicação.

## Taxa de reserva variável

- [x] Permitir informar a taxa em reais antes de criar o PIX, mantendo R$ 25,00 como valor inicial sugerido.
- [x] Validar no frontend e no backend valores entre R$ 1,00 e R$ 10.000,00, em centavos e com até duas casas decimais.
- [x] Gravar a taxa no candidato antes da chamada ao Mercado Pago, para manter o mesmo valor em tentativas concorrentes e reexecuções idempotentes.
- [x] Exibir o valor escolhido no modal do PIX, ao reabrir o pagamento e na ficha do candidato; preservar o valor real nas tentativas reconciliadas.
- [x] Criar a migration `024_candidate_reservation_amount.sql` e alinhar o esquema base.
- [x] Aplicar e registrar a migration 024; publicar a Edge Function `create-reservation-pix` atualizada.
- [x] Publicar o frontend no Cloudflare Pages.
- [ ] Validar valores com centavos, valor padrão, limites e reabertura de uma tentativa existente sem criar nova cobrança.

**Estado:** migration 024 aplicada e registrada no Supabase; coluna `candidatos.reserva_valor` e validação de faixa confirmadas remotamente. `create-reservation-pix` está ativa na versão 3, com JWT obrigatório. Frontend publicado no Cloudflare Pages (conforme informado pelo responsável). A validação manual continua pendente; nenhuma cobrança real foi criada durante a implementação.

## Fase 8 — Integração Meta (WhatsApp Cloud API) e abas em `/configuracoes`

### Objetivo

Permitir que o locador use a API oficial da Meta (WhatsApp Cloud API) no lugar da Zernio, escolhendo o provedor na rota `/configuracoes`. O provedor ativo fica em `zernio_integracoes.provider`; a configuração do provedor inativo é preservada para permitir a troca sem reconfigurar.

### Fase 8.1 — Fundação no banco e abstração de provedor

- [x] Criar a migration `025_whatsapp_provider_meta.sql` com `provider`, `provider_connected_at`, `meta_status` e as colunas Meta (`meta_waba_id`, `meta_phone_number_id`, `meta_access_token_ciphertext`, `meta_token_last4`, `meta_token_expires_at`, `meta_display_phone_number`, `meta_verified_name`, `meta_quality_rating`, `meta_name_status`, `meta_messaging_limit_tier`, `meta_code_verification_status`, `meta_business_id`, `meta_validated_at`, `meta_last_checked_at`).
- [x] Tornar `api_key_ciphertext` e `key_status` opcionais, para que um locador use apenas a Meta.
- [x] Extrair a cifra AES-GCM para `supabase/functions/_shared/crypto.ts`, preservando o formato `v1.` da Zernio e usando `vm1.` para a Meta (chave `META_ENCRYPTION_KEY`, com fallback para `ZERNIO_ENCRYPTION_KEY`).
- [x] Criar `supabase/functions/_shared/meta-graph.ts` com o cliente da Graph API, timeout, mapeamento de erros e sanitização das mensagens do provedor.
- [x] Criar `supabase/functions/_shared/whatsapp-provider.ts` com a leitura pública da integração e a troca de provedor ativo.
- [x] Adaptar `zernio-integration` para usar os módulos compartilhados, com a ação `activate` e a remoção que agora limpa apenas os campos da Zernio (a linha é compartilhada entre os dois provedores).

**Estado:** migration 025 aplicada e registrada no projeto `cobranca_car`; colunas e restrições confirmadas remotamente. `zernio-integration` republicada (versão 8) com a resposta de `status` mantida compatível com o frontend existente.

### Fase 8.2 — Abas em `/configuracoes` e conexão Meta

- [x] Transformar `/configuracoes` em página com abas **Zernio**, **Meta Cloud API** e **Conta e Pagamentos**, no mesmo padrão visual de `/mensagens`.
- [x] Mover o formulário de perfil, token do Mercado Pago e redefinição de senha para a aba **Conta e Pagamentos**, carregando `get-secrets` sob demanda.
- [x] Criar `src/components/MetaIntegrationCard.jsx` com o status do canal, os metadados do número e as ações de atualizar, desconectar e usar o canal.
- [x] Implementar o Embedded Signup com o SDK do Facebook (`FB.login` com `config_id`, `response_type: 'code'` e `sessionInfoVersion: '3'`), carregado sob demanda.
- [x] Implementar a entrada manual de token do sistema, Phone Number ID e WABA ID, validada no servidor antes de gravar.
- [x] Criar a Edge Function autenticada `meta-integration` com as ações `status`, `validate_manual`, `complete_signup`, `select_number`, `register`, `refresh`, `disconnect` e `activate`.
- [x] Registrar o número na Meta (`POST /{phone_number_id}/register`) com o PIN de 6 dígitos definido pelo locador, sem persistir o PIN.
- [x] Assinar os webhooks da conta (`POST /{waba_id}/subscribed_apps`) ao concluir a conexão.
- [x] Adicionar o botão **Usar este canal** nas duas abas e o aviso quando o outro provedor está ativo.
- [x] Documentar os secrets (`META_APP_ID`, `META_APP_SECRET`, `META_CONFIGURATION_ID`, `META_GRAPH_VERSION`, `META_ENCRYPTION_KEY` opcional) em `supabase/secrets.txt`, `supabase/functions/.env.example` e README.
- [x] Criar `docs/INTEGRACAO_META_WHATSAPP.md` com o passo a passo do App da Meta, os limites e o roadmap.
- [x] Aplicar e registrar a migration 025; publicar `meta-integration` e `zernio-integration`; configurar o secret `META_GRAPH_VERSION`.

**Estado:** `meta-integration` está ativa com JWT obrigatório e `zernio-integration` republicada. Um teste de fumaca com locador descartavel confirmou o formato da resposta de `status`, os 409 de `activate` sem canal, o erro limpo de token invalido em `validate_manual` e a rejeicao de codigo invalido em `complete_signup`; o usuario e a linha de teste foram removidos ao final. `META_APP_ID`, `META_APP_SECRET` e `META_CONFIGURATION_ID` ainda nao foram cadastrados: sem eles a aba Meta informa que o App da Meta nao foi configurado. O frontend precisa ser publicado no Cloudflare Pages para a aba aparecer em producao.

### Fase 8.3 — Templates pela Meta

- [x] Criar a migration `026_whatsapp_template_provider.sql` com `provider` em `zernio_whatsapp_templates`, `zernio_whatsapp_deliveries`, `zernio_whatsapp_template_usages` e `zernio_whatsapp_manual_deliveries`.
- [x] Relaxar o CHECK de `account_id` para aceitar o Phone Number ID da Meta e recriar a chave única como `(id_usuario, provider, account_id, name, language)`.
- [x] Aceitar os estados extras de template da Meta (`LIMIT_EXCEEDED`, `DEPRECATED`, `PENDING_DEPRECATION`, `ARCHIVED`, `DELETED`, `EXPIRED`) e ler o motivo de recusa em `rejected_reason`.
- [x] Criar `resolveChannel()` em `zernio-whatsapp`: o canal vem de `zernio_integracoes.provider` e a credencial é descriptografada conforme o prefixo (`v1.` Zernio, `vm1.` Meta).
- [x] Despachar `list` e `syncTemplates()` para a API do provedor ativo: `GET /whatsapp/templates` na Zernio e `GET /{waba_id}/message_templates` com paginação na Meta.
- [x] Despachar `create_template`: `POST /whatsapp/templates` na Zernio e `POST /{waba_id}/message_templates` com `parameter_format: POSITIONAL` na Meta.
- [x] Gravar `provider` nos usos de template e incluir `channel` na resposta de `list`, `create_template`, `set_default` e `save_charge_order`.
- [x] Adaptar `health` ao provedor ativo.
- [x] Mostrar provedor e canal nas abas **Templates Meta** e **Agendamentos Ativos**, com atalho para `/configuracoes`.
- [x] Impedir envio pelo canal errado: envio manual e agendamento respondem com aviso quando o provedor ativo é a Meta, e o cron de lembretes marca a cobrança como `skipped`.
- [x] Aplicar e registrar a migration 026; publicar `zernio-whatsapp` e `enviar-lembretes-cobranca`.

**Estado:** migration 026 aplicada e registrada no projeto `cobranca_car`; as três constraints foram conferidas remotamente. `zernio-whatsapp` e `enviar-lembretes-cobranca` republicadas. Um teste de fumaca com locador descartavel confirmou o despacho: `provider=zernio` sem chave responde 409 pedindo chave Zernio, `provider=meta` sem credencial responde 409 pedindo numero da Meta, `health` responde `attention` e `validate_manual` com token falso devolve erro sanitizado da Meta sem vazar o token. O envio pela Meta foi habilitado na fase 8.4. O frontend precisa ser publicado no Cloudflare Pages.

**Validacao com a conta Meta real** (WABA `1493104652592138`, numero `1177949292067294` / +55 11 92217-5013, quality GREEN, limite TIER_2K, nameStatus APPROVED): os secrets `META_APP_ID`, `META_APP_SECRET` e `META_GRAPH_VERSION=26` foram cadastrados; `validate_manual` conectou o canal; `list` devolveu os 8 templates da conta com os componentes preservados; `create_template` gravou um template novo com status PENDING e o `meta_template_id` correto. Todos os templates de teste foram removidos da conta (restaram os 8 originais). As duas regras de analise de template da Meta foram medidas empiricamente e implementadas na validacao do SGA.

### Fase 8.4 — Envio por provedor

- [x] Normalizar `META_GRAPH_VERSION` para aceitar `26` ou `v26.0`.
- [x] Validar no SGA as duas regras de analise de template da Meta (variavel no inicio ou no fim do corpo; corpo curto demais para o numero de variaveis) e repassar o `error_user_msg` da Meta.
- [x] Adicionar retry com backoff para as chamadas idempotentes da Graph API, que responde com erro transitorio logo apos um POST.
- [x] Atribuir o system user a WABA (`POST /{waba_id}/assigned_users?user=...&tasks=['MANAGE']`), exigido para excluir templates.
- [x] Criar `supabase/functions/_shared/meta-messages.ts` com o conversor de `components` (formato de criacao -> formato de envio) e o envio pela Messages API.
- [x] Fazer `send_charge`, `send_template`, `zernio-message-scheduler` e `payment-webhook-receiver` usarem o provedor ativo.
- [x] Tratar o numero brasileiro com e sem o 9o digito: a Meta aceita apenas a forma registrada no WhatsApp e responde `#100 Invalid parameter` para a outra.
- [x] Corrigir a substituicao das variaveis no envio: o cursor dos parametros nao avancava dentro do `map`, e todas as variaveis recebiam o valor da primeira.
- [x] Criar `supabase/tests/meta-messages.test.ts` com testes do Deno para o conversor de componentes e das variantes de numero, executados por `npm test`.
- [x] Repassar o erro da Meta no `zernio-whatsapp` em vez da mensagem generica.
- [ ] Implementar a exclusao de templates pela Graph API (`DELETE /{waba_id}/message_templates?name=...`), hoje validada na conta real mas ainda sem controle na interface.

**Estado:** validado de ponta a ponta na conta Meta real. O teste criou um locador temporario, configurou `aviso_boleto_01` como template de lembrete de cobranca (4 variaveis: nome, valor, vencimento e link PIX) e um template de confirmacao de pagamento (3 variaveis), e enviou um lembrete real pela Cloud API. Resultado: `messageId=wamid...`, linha de auditoria com `status=sent`, `provider=meta` e `account_id=1177949292067294`, cobranca com `tentativas_envio=1`, `ultimo_lembrete_at` preenchido e `next_reminder_at` agendado para 30 minutos depois. Todos os registros de teste foram removidos.

**Correcao das variaveis:** o conversor de componentes mantinha o cursor fixo dentro do `map`, entao toda variavel recebia o valor da primeira ({{1}}) e as demais ficavam com o valor errado. O cursor agora avanca a cada parametro. A numeracao `{{n}}` e global no template (cabecalho, corpo e botoes nessa ordem) e o frontend (`getTemplateParameterSlots`), o mapeamento do backend (`billingTemplateParams`) e o envio (`buildTemplateComponents`) seguem a mesma ordem. O teste de Deno trava esse comportamento.

**Observacao sobre o numero:** o celular da empresa e exibido como `+55 11 92217-5013`, mas no WhatsApp ele esta registrado como `551122175013` (sem o 9o digito). A Meta so aceita a forma registrada, e a tentativa com o 9o digito retorna `#100 Invalid parameter`. O envio tenta as duas formas. A primeira implementacao montava a variante com o prefixo `55` duplicado; a Meta acabava resolvendo para o mesmo numero, mas a forma canonica e a sem o 9o digito.

**Confirmacao de pagamento:** o caminho de envio e o mesmo do lembrete e usa a mesma conversao, mas o disparo depende de um pagamento real do Mercado Pago chegar pelo webhook; por isso nao foi exercitado de ponta a ponta para nao gerar cobranca real.

### Fase 8.5 — Webhooks da Meta

- [ ] Criar a Edge Function `meta-webhook` (`verify_jwt = false`) com a verificacao `GET` (`hub.mode`, `hub.verify_token`, `hub.challenge`) e a assinatura `X-Hub-Signature-256` sobre o corpo cru.
- [ ] Tratar o inbound `messages` reaproveitando a logica de OTP das fechaduras, extraida de `webhook-fechadura` para `_shared`.
- [ ] Tratar `statuses` (`sent`, `delivered`, `read`, `failed`) e atualizar o status das entregas registradas.

**Observacao:** enquanto as fases 8.3 a 8.5 nao forem entregues, os envios do SGA continuam usando exclusivamente o canal da Zernio, mesmo com `provider = 'meta'`.
