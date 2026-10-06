ALTER TABLE public.candidatos
  ADD COLUMN IF NOT EXISTS reserva_valor numeric(12, 2);

-- Preserve the fixed R$ 25.00 amount for payment attempts already in progress
-- before this migration, preferring the amount returned by Mercado Pago.
UPDATE public.candidatos AS candidato
SET reserva_valor = COALESCE((
  SELECT pagamento.valor
  FROM public.candidato_reserva_pagamentos AS pagamento
  WHERE pagamento.id_candidato = candidato.id
    AND pagamento.mercado_pago_id = candidato.pagamento_id
), 25.00)
WHERE candidato.reserva_valor IS NULL
  AND (candidato.pagamento_id IS NOT NULL OR candidato.reserva_idempotency_key IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.candidatos'::regclass
      AND conname = 'candidatos_reserva_valor_check'
  ) THEN
    ALTER TABLE public.candidatos
      ADD CONSTRAINT candidatos_reserva_valor_check
      CHECK (reserva_valor IS NULL OR reserva_valor BETWEEN 1.00 AND 10000.00);
  END IF;
END;
$$;

COMMENT ON COLUMN public.candidatos.reserva_valor IS
  'Reservation fee in BRL selected by the owner, saved before calling Mercado Pago to keep retries idempotent.';
