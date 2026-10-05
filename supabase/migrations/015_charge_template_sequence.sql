ALTER TABLE public.zernio_whatsapp_template_usages
  ADD COLUMN IF NOT EXISTS reminder_order integer NOT NULL DEFAULT 1;

ALTER TABLE public.zernio_whatsapp_template_usages
  DROP CONSTRAINT IF EXISTS zernio_template_reminder_order_check,
  ADD CONSTRAINT zernio_template_reminder_order_check
    CHECK (reminder_order > 0);

DROP INDEX IF EXISTS public.idx_zernio_template_usages_one_default;

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_charge_template_order
  ON public.zernio_whatsapp_template_usages (id_usuario, account_id, reminder_order)
  WHERE is_default AND purpose = 'charge';

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_payment_confirmation_default
  ON public.zernio_whatsapp_template_usages (id_usuario, account_id, purpose)
  WHERE is_default AND purpose = 'payment_confirmation';

COMMENT ON COLUMN public.zernio_whatsapp_template_usages.reminder_order IS
  'Order in the owner-specific reminder template sequence; reminders cycle in this order until PIX payment or expiry.';
