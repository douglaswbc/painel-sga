-- Suporte à categorização de templates como mensagem avulsa (além de lembrete e confirmação de pagamento)

ALTER TABLE public.zernio_whatsapp_templates
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_templates_purpose_check;

ALTER TABLE public.zernio_whatsapp_templates
  ADD CONSTRAINT zernio_whatsapp_templates_purpose_check
  CHECK (purpose IN ('general', 'charge', 'payment_confirmation', 'avulso'));

ALTER TABLE public.zernio_whatsapp_template_usages
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_template_usages_purpose_check;

ALTER TABLE public.zernio_whatsapp_template_usages
  ADD CONSTRAINT zernio_whatsapp_template_usages_purpose_check
  CHECK (purpose IN ('charge', 'payment_confirmation', 'avulso'));

COMMENT ON CONSTRAINT zernio_whatsapp_templates_purpose_check ON public.zernio_whatsapp_templates IS
  'Permite classificar o template em geral, lembrete (charge), confirmação de pagamento (payment_confirmation) ou mensagem avulsa (avulso).';

COMMENT ON CONSTRAINT zernio_whatsapp_template_usages_purpose_check ON public.zernio_whatsapp_template_usages IS
  'Finalidades de uso do template: charge (lembrete), payment_confirmation (confirmação) ou avulso (mensagem avulsa / agendamento manual).';
