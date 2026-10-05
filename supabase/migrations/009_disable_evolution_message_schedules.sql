-- Stop only old free-text schedules. Meta template schedules remain active and
-- are processed by zernio-message-scheduler.
UPDATE public.agendamentos_mensagens
SET ativo = false,
    ultimo_erro = 'Agendamento legado pausado na migração para templates aprovados da Meta. Recrie em /mensagens.'
WHERE ativo = true
  AND zernio_template_id IS NULL;

COMMENT ON COLUMN public.agendamentos_mensagens.id_template IS
  'Template legado de texto livre; schedules based on this field are paused during the Evolution removal.';
