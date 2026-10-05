# SGA - Sistema de Gestão de Aluguel 🚀📱

Um sistema completo e moderno para gestão de frotas, contratos de aluguel e cobrança automatizada via WhatsApp. Desenvolvido para oferecer controle financeiro total e comunicação ágil com locatários.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Estilização**: Tailwind CSS (Design Premium / Glassmorphism)
- **Backend / DB**: [Supabase](https://supabase.com/) (PostgreSQL, Edge Functions, Auth, Storage)
- **Mensagens**: [Zernio](https://zernio.com/) com a API oficial do WhatsApp da Meta
- **Pagamentos**: [Mercado Pago](https://www.mercadopago.com.br/) (PIX Automático)
- **Ícones**: [Lucide React](https://lucide.dev/)

---

## ✨ Principais Funcionalidades

### 📋 Gestão de Cadastros
- **Locatários**: Cadastro completo com integração ViaCEP e validação de documentos.
- **Veículos**: Controle de frota com status de atividade.
- **Contratos**: Configuração de cobrança com recorrência semanal/diária ajustável.

### 💰 Financeiro & Cobrança
- **Faturamento Diário**: Processamento automático de contratos via Cron Jobs.
- **PIX Automático**: Geração de QR Code e Copia-e-Cola integrado ao Mercado Pago.
- **Fluxo de Caixa**: Visão agrupada por locatário com status de pagamento em tempo real.

### 💬 Comunicação Inteligente
- **Régua de Cobrança**: Envio por templates Meta aprovados, usando a integração Zernio individual de cada locador.
- **Templates Meta**: Criação e acompanhamento da aprovação, envio manual e agendamentos pela rota `/mensagens`.
- **Conexão WhatsApp**: Cada locador informa sua própria chave de API Zernio, seleciona o canal WhatsApp e conclui o onboarding Meta em Configurações.
- **Portal do Locatário**: Link exclusivo para o cliente acompanhar faturas e realizar pagamentos.

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- Node.js (v18+)
- Conta no Supabase
- Conta Zernio com acesso à API do WhatsApp da Meta

### Passo a Passo
1. **Clonar o repositório**
   ```bash
   git clone [link-do-repositorio]
   cd painel-sga
   ```

2. **Instalar dependências**
   ```bash
   npm install
   ```

3. **Configurar Variáveis de Ambiente**
   Crie um arquivo `.env` na raiz do projeto com as seguintes chaves:
   ```env
   VITE_SUPABASE_URL=seu_url_do_supabase
   VITE_SUPABASE_ANON_KEY=sua_chave_anon
   ```

4. **Banco de Dados, secrets e crons**
   - Aplique as migrations `001`–`011` em ordem. Aplique a `012` somente depois de confirmar os fluxos Zernio em produção.
   - Configure `ZERNIO_ENCRYPTION_KEY`, `ZERNIO_REDIRECT_BASE_URL` e `MP_WEBHOOK_URL` como secrets das Edge Functions no Supabase. Gere uma chave hexadecimal de 32 bytes para `ZERNIO_ENCRYPTION_KEY`.
   - Configure os crons seguindo `supabase/cron-example.txt`.
   - Cada locador cadastra sua chave Zernio na própria conta; essa chave fica cifrada no banco e não deve ser adicionada ao `.env` do Vite.

5. **Rodar em Desenvolvimento**
   ```bash
   npm run dev
   ```

---

## 📁 Estrutura de Pastas Úteis

- `/src/pages`: Telas principais do sistema (Locatários, Cobranças, Mensagens).
- `/src/components`: Componentes reutilizáveis (Modais, Seletores).
- `/supabase/functions`: Lógica de backend (Faturamento, WhatsApp, Webhooks).
- `/src/services/supabase.js`: Configuração do cliente Supabase.

---

## 📄 Licença
Este projeto foi desenvolvido para uso exclusivo pela **Emove Entregas**. Todos os direitos reservados.
