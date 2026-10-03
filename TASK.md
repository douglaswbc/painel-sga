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
- [x] Revogar acesso do cliente às colunas de segredo de `usuarios`, proteger as RPCs de criptografia contra execução por `anon`/`authenticated` e corrigir a volatilidade declarada.
- [ ] Confirmar no projeto Supabase a estrutura real de `app_config` e as RPCs `get_user_mp_token`/`create_user_mp_secret`, que são chamadas pelas Edge Functions mas não estão definidas no repositório; provisionar/documentar após conferir como os segredos existentes foram armazenados.
- [x] Identificar `supabase/sql_banco.txt` como referência de instalação inicial e alinhar nele o tipo `date`.

**Estado:** migration `003_security_and_integrity.sql` aplicada no Supabase pelo responsável pelo projeto. Os ajustes de frontend e Edge Functions preparados com ela precisam estar publicados para que todos os fluxos administrativos usem as novas permissões.

### Critérios de conclusão

- Um locador autenticado só pode ler ou alterar os próprios dados pelas APIs do Supabase. (migration aplicada; requer validação ponta a ponta)
- O banco rejeita relações entre registros de locadores diferentes e duplicatas de cobrança. (migration aplicada)
- Segredos só podem ser descriptografados por rotinas autorizadas do backend. (migration aplicada; pendente confirmar estrutura de segredos legados)

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

**Estado:** codigo pronto localmente. Aplicar `006_zernio_templates_and_deliveries.sql`, publicar `zernio-whatsapp` e o frontend. Os cron/lembretes e os outros fluxos que ainda usam Evolution/RyzeAPI permanecem para a migracao da fase 6.

### Criterios de conclusao

- O locador cria o template e acompanha a revisao da Meta; somente um aprovado pode ser escolhido e usado.
- A cobranca e enviada com nome, valor, vencimento e link PIX mapeados nas posicoes definidas pelo template.
- Falhas ficam no historico sem marcar a cobranca como enviada; repeticoes nao geram uma segunda mensagem.

### Agendamentos Meta na rota `/mensagens`

- [x] Remover as abas de modelos legados da rota e manter Templates Meta e Agendamentos Ativos.
- [x] Criar agendamento recorrente a partir de template Meta aprovado, com locatário, variáveis, frequência, data e horário.
- [x] Listar e permitir pausar, reativar ou excluir agendamentos; identificar os registros antigos como legados.
- [x] Adicionar envio recorrente idempotente por Zernio e registrar tentativas/erros.

**Estado:** implementação local pronta. Aplicar `007_zernio_message_scheduling.sql`, publicar `zernio-whatsapp` e a nova Edge Function `zernio-message-scheduler`, e instalar o cron descrito em `supabase/cron-example.txt`. O cron legado continua atendendo somente aos agendamentos antigos.

## Fase 6 — Substituir Evolution e RyzeAPI

- [ ] Migrar `reenvio-cobranca`, `gerar-cobranca-pix`, `enviar-lembretes-cobranca` e `agendador-mensagens-avulsas` para o serviço Zernio.
- [ ] Migrar `ryze-proxy`, `instance-status`, `create-instance`, `admin-create-user` e `delete-user`; remover criação/estado de instâncias da Evolution onde deixar de ser necessário.
- [ ] Migrar `payment-webhook-receiver` para localizar a integração/canal e template do locador antes de enviar a confirmação.
- [ ] Migrar `webhook-fechadura` se o envio de mensagens da fechadura continuar sendo requisito; preservar OTP, autorização e auditoria.
- [ ] Atualizar Configurações, telas de mensagens, onboarding de usuários, README, dependências e nomes visíveis que ainda indiquem Evolution/RyzeAPI.
- [ ] Remover código, segredos e colunas antigas `ryze_instance`/`ryze_token` apenas depois da migração e confirmação de que nenhuma função em produção depende deles.

### Critérios de conclusão

- Nenhum fluxo operacional de WhatsApp depende de Evolution ou RyzeAPI.
- Cada mensagem usa a credencial e o canal do locador dono do evento/cobrança.
- Recursos que deixarem de existir (por exemplo, controles de instância Evolution) foram removidos da interface sem quebrar os fluxos mantidos.

## Fase 7 — Operação e implantação

- [ ] Atualizar documentação de configuração, cron, Edge Functions e secrets do Supabase. A chave Zernio por locador não deve ser adicionada ao `.env` do Vite.
- [ ] Definir retenção e acesso aos logs; ocultar tokens, chaves, telefone completo e dados PIX desnecessários.
- [ ] Implantar primeiro banco/RLS e Edge Functions; depois interface/onboarding; por último desativar os provedores antigos.
- [ ] Fazer uma validação ponta a ponta em ambiente controlado: salvar chave, conectar número, criar e aprovar template, faturar um contrato de teste, enviar template, receber callback e confirmar o isolamento entre dois locadores.
- [ ] Só eliminar os secrets e campos antigos após confirmar que a implantação nova está ativa e monitorada.

## Inventário inicial verificado

- Faturamento automático: `supabase/functions/faturamento-cobrancas/index.ts`.
- Cobrança individual: `supabase/functions/cobrar-contrato/index.ts`.
- Modal de contrato com recorrências legadas: `src/components/ContratoModal.jsx`.
- Exemplo de cron com endpoint antigo e `userId` fixo: `supabase/cron-example.txt`.
- Esquema base revisado: `supabase/sql_banco.txt`.
- Migração de criptografia revisada: `supabase/migrations/001_encrypt.sql`.
- Integrações Evolution/Ryze identificadas principalmente em `supabase/functions/` e `src/pages/Configuracoes.jsx`.

## Ordem recomendada

1. Corrigir cron, recorrência, datas e idempotência do faturamento.
2. Aplicar migrações de banco, RLS e armazenamento seguro de segredos.
3. Implementar cadastro/validação da chave individual do Zernio.
4. Implementar conexão Meta e retorno ao SGA.
5. Implementar templates e envio de mensagens.
6. Migrar os demais fluxos WhatsApp e retirar Evolution/RyzeAPI.
7. Validar ponta a ponta e concluir a implantação.
