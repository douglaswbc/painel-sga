-- Re-schedule charge generation and WhatsApp reminders to honor contract times.
-- Requires sga_project_url and sga_service_role_key in Supabase Vault.
select cron.unschedule(jobid)
from cron.job
where jobname in ('sga-faturamento-cobrancas', 'enviar-lembretes-whatsapp');

select cron.schedule(
  'sga-faturamento-cobrancas',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sga_project_url')
             || '/functions/v1/faturamento-cobrancas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sga_service_role_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);

select cron.schedule(
  'enviar-lembretes-whatsapp',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sga_project_url')
             || '/functions/v1/enviar-lembretes-cobranca',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sga_service_role_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
