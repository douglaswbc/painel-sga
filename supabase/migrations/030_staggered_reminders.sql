-- 030_staggered_reminders.sql
-- Adiciona suporte a escalonamento (delay) inteligente entre envios de lembretes
-- para locadores com múltiplos contratos, evitando rajadas no WhatsApp.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS reminder_stagger_minutes integer DEFAULT 2
    CHECK (reminder_stagger_minutes >= 0 AND reminder_stagger_minutes <= 60),
  ADD COLUMN IF NOT EXISTS reminder_dispatch_delay_seconds integer DEFAULT 5
    CHECK (reminder_dispatch_delay_seconds >= 0 AND reminder_dispatch_delay_seconds <= 30);

COMMENT ON COLUMN public.usuarios.reminder_stagger_minutes IS
  'Minutos de intervalo entre lembretes de contratos diferentes do mesmo locador no faturamento.';
COMMENT ON COLUMN public.usuarios.reminder_dispatch_delay_seconds IS
  'Segundos de pausa de segurança entre disparos consecutivos dentro da mesma execução.';

-- Índice para busca rápida de lembretes pendentes ordenados
CREATE INDEX IF NOT EXISTS idx_cobrancas_usuario_next_reminder
  ON public.cobrancas (id_usuario, next_reminder_at)
  WHERE status IN ('pendente', 'atrasado') AND tipo <> 'despesa';

-- Re-agenda o cron enviar-lembretes-whatsapp para rodar a cada 1 minuto (* * * * *)
-- permitindo que mensagens escalonadas minuto a minuto sejam enviadas pontualmente
DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'sga_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'sga_cron_api_key' LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    -- Desagenda o cron atual de 5 minutos
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'enviar-lembretes-whatsapp';

    -- Agenda para rodar todo minuto
    PERFORM cron.schedule(
      'enviar-lembretes-whatsapp',
      '* * * * *',
      format($cron$
        SELECT net.http_post(
          url := %L || '/functions/v1/enviar-lembretes-cobranca',
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

