-- 031_grant_usuarios_reminder_columns.sql
-- Concede permissões de SELECT e UPDATE para a role authenticated nas novas colunas
-- de escalonamento de lembretes adicionadas pela migration 030 e empresa_nome.

GRANT SELECT (reminder_stagger_minutes, reminder_dispatch_delay_seconds)
  ON TABLE public.usuarios TO authenticated;

GRANT UPDATE (reminder_stagger_minutes, reminder_dispatch_delay_seconds, empresa_nome)
  ON TABLE public.usuarios TO authenticated;
