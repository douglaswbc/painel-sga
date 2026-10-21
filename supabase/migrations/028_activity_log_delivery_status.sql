-- Status de entrega da Meta no log unificado de operacao.
--
-- A view passa a expor `meta_status` (accepted, sent, delivered, read ou
-- failed) para que a interface mostre o andamento real de cada mensagem.

ALTER TABLE public.zernio_payment_notifications
  ADD COLUMN IF NOT EXISTS meta_status text
    CHECK (meta_status IS NULL OR meta_status IN ('accepted', 'sent', 'delivered', 'read', 'failed'));

CREATE OR REPLACE VIEW public.zernio_whatsapp_activity_log
WITH (security_invoker = true)
AS
SELECT d.id_usuario,
       'charge'::text AS type,
       d.id AS source_id,
       d.status,
       d.template_name,
       d.template_language,
       t.category,
       l.nome_completo AS recipient_name,
       l.whatsapp AS recipient_phone,
       COALESCE(d.sent_at, d.updated_at, d.created_at) AS occurred_at,
       d.created_at,
       d.message_id,
       COALESCE(d.safe_error, d.error_code) AS error,
       d.meta_status
FROM public.zernio_whatsapp_deliveries d
LEFT JOIN public.zernio_whatsapp_templates t
  ON t.id = d.template_id AND t.id_usuario = d.id_usuario
LEFT JOIN public.cobrancas c
  ON c.id = d.id_cobranca AND c.id_usuario = d.id_usuario
LEFT JOIN public.locatarios l
  ON l.id = c.id_locatario AND l.id_usuario = d.id_usuario
UNION ALL
SELECT d.id_usuario,
       'scheduled'::text,
       d.id,
       d.status,
       t.name,
       t.language,
       t.category,
       l.nome_completo,
       l.whatsapp,
       COALESCE(d.sent_at, d.attempted_at, d.created_at),
       d.created_at,
       d.message_id,
       COALESCE(d.safe_error, d.error_code),
       d.meta_status
FROM public.zernio_whatsapp_scheduled_deliveries d
JOIN public.agendamentos_mensagens a
  ON a.id = d.id_agendamento AND a.id_usuario = d.id_usuario
LEFT JOIN public.zernio_whatsapp_templates t
  ON t.id = a.zernio_template_id AND t.id_usuario = d.id_usuario
LEFT JOIN public.locatarios l
  ON l.id = a.id_locatario AND l.id_usuario = d.id_usuario
UNION ALL
SELECT d.id_usuario,
       'payment'::text,
       d.id,
       d.status,
       t.name,
       t.language,
       t.category,
       COALESCE(l.nome_completo, cand.nome),
       COALESCE(l.whatsapp, cand.telefone),
       COALESCE(d.updated_at, d.created_at),
       d.created_at,
       d.message_id,
       d.safe_error,
       d.meta_status
FROM public.zernio_payment_notifications d
LEFT JOIN public.cobrancas c
  ON c.id = d.id_cobranca AND c.id_usuario = d.id_usuario
LEFT JOIN public.locatarios l
  ON l.id = c.id_locatario AND l.id_usuario = d.id_usuario
LEFT JOIN public.candidatos cand
  ON cand.id = d.id_candidato AND cand.id_usuario = d.id_usuario
LEFT JOIN public.zernio_whatsapp_template_usages u
  ON u.id_usuario = d.id_usuario AND u.purpose = 'payment_confirmation' AND u.is_default
LEFT JOIN public.zernio_whatsapp_templates t
  ON t.id = u.template_id AND t.id_usuario = d.id_usuario
UNION ALL
SELECT d.id_usuario,
       'manual'::text,
       d.id,
       d.status,
       d.template_name,
       d.template_language,
       t.category,
       l.nome_completo,
       l.whatsapp,
       COALESCE(d.sent_at, d.updated_at, d.created_at),
       d.created_at,
       d.message_id,
       COALESCE(d.safe_error, d.error_code),
       d.meta_status
FROM public.zernio_whatsapp_manual_deliveries d
LEFT JOIN public.zernio_whatsapp_templates t
  ON t.id = d.template_id AND t.id_usuario = d.id_usuario
LEFT JOIN public.locatarios l
  ON l.id = d.id_locatario AND l.id_usuario = d.id_usuario;

REVOKE ALL ON public.zernio_whatsapp_activity_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.zernio_whatsapp_activity_log TO service_role;

COMMENT ON VIEW public.zernio_whatsapp_activity_log IS
  'Unified per-owner WhatsApp template send log with recipient names, template categories and the delivery status reported by the provider.';
