-- Separate the PIX lifetime from the rental charge and schedule repeated reminders.
ALTER TABLE public.cobrancas
  ADD COLUMN IF NOT EXISTS pix_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_interval_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pix_expired_at timestamptz;

ALTER TABLE public.cobrancas
  DROP CONSTRAINT IF EXISTS cobrancas_reminder_interval_check,
  ADD CONSTRAINT cobrancas_reminder_interval_check
    CHECK (reminder_interval_minutes BETWEEN 5 AND 240);

COMMENT ON COLUMN public.cobrancas.pix_expires_at IS
  'Expiration timestamp of the current Mercado Pago PIX payment, independent of the charge status.';
COMMENT ON COLUMN public.cobrancas.next_reminder_at IS
  'Next scheduled WhatsApp reminder for the current PIX payment.';

ALTER TABLE public.zernio_whatsapp_deliveries
  ADD COLUMN IF NOT EXISTS sequence_no integer NOT NULL DEFAULT 1;

WITH numbered AS (
  SELECT id, row_number() OVER (
    PARTITION BY id_usuario, id_cobranca ORDER BY created_at, id
  ) AS sequence_no
  FROM public.zernio_whatsapp_deliveries
)
UPDATE public.zernio_whatsapp_deliveries AS delivery
SET sequence_no = numbered.sequence_no
FROM numbered
WHERE numbered.id = delivery.id;

ALTER TABLE public.zernio_whatsapp_deliveries
  DROP CONSTRAINT IF EXISTS zernio_whatsapp_deliveries_charge_template_key;

DROP INDEX IF EXISTS public.idx_zernio_whatsapp_deliveries_charge_inflight_or_sent;
CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_charge_sequence
  ON public.zernio_whatsapp_deliveries (id_usuario, id_cobranca, sequence_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_whatsapp_deliveries_charge_sending
  ON public.zernio_whatsapp_deliveries (id_usuario, id_cobranca)
  WHERE status = 'sending';

COMMENT ON COLUMN public.zernio_whatsapp_deliveries.sequence_no IS
  'One-based reminder number for a charge; each reminder is audited and idempotent separately.';
