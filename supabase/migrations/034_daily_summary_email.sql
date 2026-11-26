-- Resumo diário por e-mail (Resend) com cobranças vencidas no dia anterior e custo estimado de templates WhatsApp.

ALTER TABLE public.email_notificacoes_config
  ADD COLUMN IF NOT EXISTS notificar_resumo_diario boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_daily_summary_date date,
  ADD COLUMN IF NOT EXISTS last_daily_summary_sent_at timestamptz;

COMMENT ON COLUMN public.email_notificacoes_config.notificar_resumo_diario IS
  'Habilita o envio diário às 08:00 (horário de Brasília) do resumo de cobranças do dia anterior e custos estimados do WhatsApp.';
COMMENT ON COLUMN public.email_notificacoes_config.last_daily_summary_date IS
  'Data de referência (ontem no horário de Brasília) do último resumo diário automático enviado.';
COMMENT ON COLUMN public.email_notificacoes_config.last_daily_summary_sent_at IS
  'Carimbo de data/hora do último envio (automático ou manual) do resumo diário.';

-- Agenda o disparo diário às 08:00 (America/Sao_Paulo = 11:00 UTC)
DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'sga_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'sga_cron_api_key' LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'resumo-diario-cobrancas-email';

    PERFORM cron.schedule(
      'resumo-diario-cobrancas-email',
      '0 11 * * *',
      format($cron$
        SELECT net.http_post(
          url := %L || '/functions/v1/resumo-diario-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', %L
          ),
          body := '{}'::jsonb
        ) AS request_id;
      $cron$, v_url, v_key)
    );
  END IF;
END;
$$;
