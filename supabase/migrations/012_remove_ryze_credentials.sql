-- No live application code depends on these legacy provider columns.
-- Apply only after the Zernio webhook and payment flows are deployed and verified.
ALTER TABLE public.usuarios
  DROP COLUMN IF EXISTS ryze_instance,
  DROP COLUMN IF EXISTS ryze_token;
