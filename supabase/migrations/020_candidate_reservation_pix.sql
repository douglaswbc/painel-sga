-- Candidate PIX payments require the buyer email and a stable idempotency key.
ALTER TABLE public.candidatos
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS reserva_idempotency_key uuid;
