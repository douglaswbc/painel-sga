-- New candidate records start with the canonical triage status.
-- Existing rows are intentionally left untouched until their production
-- status distribution has been reviewed.
ALTER TABLE public.candidatos
  ALTER COLUMN status SET DEFAULT 'Em análise';
