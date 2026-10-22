# Diretrizes do Projeto - Painel SGA

## Regras de Banco de Dados e Migrations

Sempre que uma nova migration for criada, modificada ou aplicada em `supabase/migrations/`:

1. **Atualização Obrigatória de `supabase/sql_banco.txt`**:
   - O arquivo `supabase/sql_banco.txt` é o esquema mestre consolidado de todo o banco de dados Supabase deste projeto.
   - Logo após criar ou alterar qualquer migration em `supabase/migrations/`, a IA deve obrigatoriamente atualizar o arquivo `supabase/sql_banco.txt` para incluir todas as alterações (novas tabelas, colunas, chaves estrangeiras, índices, funções, triggers, views, permissões de RLS e `GRANTs`).
   - O objetivo é que qualquer desenvolvedor ou deploy em um banco vazio consiga rodar `supabase/sql_banco.txt` e obter a estrutura idêntica e completa do sistema sem discrepâncias.

2. **Permissões Granulares na Tabela `usuarios`**:
   - A tabela `public.usuarios` possui segurança restrita por colunas (`REVOKE ALL`). Toda nova coluna que precise ser lida ou escrita por usuários logados deve receber explicitamente `GRANT SELECT (...) ON TABLE public.usuarios TO authenticated;` e/ou `GRANT UPDATE (...) ON TABLE public.usuarios TO authenticated;`, evitando erros de permissão (`code 42501`).

3. **Padrão de Migrations**:
   - Manter a numeração sequencial de 3 dígitos (ex: `032_nome_da_migration.sql`).
   - Garantir idempotência (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`).
