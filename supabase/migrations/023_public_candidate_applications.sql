CREATE TABLE IF NOT EXISTS public.candidate_application_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL UNIQUE REFERENCES public.usuarios(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  requests_day date,
  requests_today integer NOT NULL DEFAULT 0 CHECK (requests_today >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.candidatos
  ADD COLUMN IF NOT EXISTS id_link_inscricao uuid REFERENCES public.candidate_application_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aviso_privacidade_versao text,
  ADD COLUMN IF NOT EXISTS aviso_privacidade_lido_em timestamptz;

ALTER TABLE public.candidatos
  DROP CONSTRAINT IF EXISTS candidatos_cpf_key;

ALTER TABLE public.candidatos
  ADD CONSTRAINT candidatos_id_usuario_cpf_key UNIQUE (id_usuario, cpf);

ALTER TABLE public.candidato_reserva_auditoria
  DROP CONSTRAINT IF EXISTS candidato_reserva_auditoria_acao_check;

ALTER TABLE public.candidato_reserva_auditoria
  ADD CONSTRAINT candidato_reserva_auditoria_acao_check
  CHECK (acao IN ('confirmacao_manual', 'alteracao_status', 'atualizacao_pagamento', 'inscricao_recebida'));

ALTER TABLE public.candidate_application_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidate_application_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.candidate_application_links TO authenticated;
GRANT ALL ON public.candidate_application_links TO service_role;
CREATE POLICY candidate_application_links_owner_read
  ON public.candidate_application_links FOR SELECT TO authenticated
  USING (id_usuario = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.consumir_cota_inscricao_candidato(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_consumed boolean := false;
BEGIN
  UPDATE public.candidate_application_links
  SET requests_day = v_day,
      requests_today = CASE WHEN requests_day IS DISTINCT FROM v_day THEN 1 ELSE requests_today + 1 END,
      updated_at = now()
  WHERE id = p_link_id
    AND ativo
    AND expires_at > now()
    AND (requests_day IS DISTINCT FROM v_day OR requests_today < 50)
  RETURNING true INTO v_consumed;

  RETURN COALESCE(v_consumed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.consumir_cota_inscricao_candidato(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_cota_inscricao_candidato(uuid) TO service_role;

COMMENT ON TABLE public.candidate_application_links IS
  'Public candidate application links. Only a one-way token hash is stored; authenticated owners can read their own link record.';
