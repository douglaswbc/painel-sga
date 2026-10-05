-- Re-schedule charge generation and WhatsApp reminders to honor contract times.
-- Requires sga_project_url and the rotated default Secret API Key stored as
-- sga_cron_api_key in Supabase Vault.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'sga_project_url' and nullif(decrypted_secret, '') is not null) then
    raise exception 'Vault secret sga_project_url is missing or empty.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'sga_cron_api_key' and nullif(decrypted_secret, '') is not null) then
    raise exception 'Vault secret sga_cron_api_key is missing or empty.';
  end if;
end;
$$;
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
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sga_cron_api_key')
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
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sga_cron_api_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);


-- Recurring sends for Meta approved templates through Zernio.
select cron.unschedule(jobid)
from cron.job
where jobname = 'sga-zernio-message-scheduler';

select cron.schedule(
  'sga-zernio-message-scheduler',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sga_project_url')
             || '/functions/v1/zernio-message-scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sga_cron_api_key')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
