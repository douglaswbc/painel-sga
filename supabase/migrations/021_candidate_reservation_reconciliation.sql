CREATE TABLE IF NOT EXISTS public.candidato_reserva_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_candidato uuid NOT NULL REFERENCES public.candidatos(id) ON DELETE CASCADE,
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  mercado_pago_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'Pendente',
  status_detalhe text,
  valor numeric(12, 2),
  expira_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidato_reserva_pagamentos_candidate
  ON public.candidato_reserva_pagamentos (id_candidato, criado_em DESC);

INSERT INTO public.candidato_reserva_pagamentos
  (id_candidato, id_usuario, mercado_pago_id, status, valor, expira_em)
SELECT id, id_usuario, pagamento_id, COALESCE(NULLIF(pagamento_status, ''), 'Pendente'), 25, reserva_expira_em
FROM public.candidatos
WHERE pagamento_id IS NOT NULL
ON CONFLICT (mercado_pago_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.candidato_reserva_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_candidato uuid NOT NULL REFERENCES public.candidatos(id) ON DELETE CASCADE,
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  operador_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acao text NOT NULL CHECK (acao IN ('confirmacao_manual')),
  status_anterior text,
  status_novo text NOT NULL,
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 10 AND 1000),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidato_reserva_auditoria_candidate
  ON public.candidato_reserva_auditoria (id_candidato, criado_em DESC);

ALTER TABLE public.candidato_reserva_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidato_reserva_auditoria ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.candidato_reserva_pagamentos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.candidato_reserva_pagamentos TO authenticated;
GRANT ALL ON public.candidato_reserva_pagamentos TO service_role;
CREATE POLICY candidato_reserva_pagamentos_owner_read
  ON public.candidato_reserva_pagamentos FOR SELECT TO authenticated
  USING (id_usuario = (SELECT auth.uid()));

REVOKE ALL ON public.candidato_reserva_auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.candidato_reserva_auditoria TO authenticated;
GRANT ALL ON public.candidato_reserva_auditoria TO service_role;
CREATE POLICY candidato_reserva_auditoria_owner_read
  ON public.candidato_reserva_auditoria FOR SELECT TO authenticated
  USING (id_usuario = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.confirmar_reserva_candidato_manual(p_candidato_id uuid, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_candidate public.candidatos%ROWTYPE;
  v_audit_id uuid;
  v_payment_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR char_length(btrim(p_motivo)) < 10 OR char_length(btrim(p_motivo)) > 1000 THEN
    RAISE EXCEPTION 'Informe um motivo entre 10 e 1000 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_candidate
  FROM public.candidatos
  WHERE id = p_candidato_id AND id_usuario = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidato não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(btrim(COALESCE(v_candidate.status, ''))) NOT IN ('aguardando reserva', 'pré-aprovado', 'pre-aprovado') THEN
    RAISE EXCEPTION 'O status atual não permite confirmar a reserva.' USING ERRCODE = '22023';
  END IF;
  v_payment_status := lower(btrim(COALESCE(v_candidate.pagamento_status, '')));
  IF v_payment_status IN ('pendente', 'processando', 'autorizado', 'em análise', 'em analise', 'em disputa')
    AND (v_candidate.reserva_expira_em IS NULL OR v_candidate.reserva_expira_em > now()) THEN
    RAISE EXCEPTION 'Há um pagamento PIX ainda ativo; aguarde a reconciliação antes da confirmação manual.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.candidato_reserva_auditoria
    (id_candidato, id_usuario, operador_id, acao, status_anterior, status_novo, motivo)
  VALUES
    (v_candidate.id, v_user_id, v_user_id, 'confirmacao_manual', v_candidate.status, 'Vaga reservada', btrim(p_motivo))
  RETURNING id INTO v_audit_id;

  UPDATE public.candidatos
  SET status = 'Vaga reservada',
      pagamento_status = 'Confirmado manualmente',
      reserva_confirmada_em = now(),
      updated_at = now()
  WHERE id = v_candidate.id;

  RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_reserva_candidato_manual(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_reserva_candidato_manual(uuid, text) TO authenticated;

COMMENT ON TABLE public.candidato_reserva_pagamentos IS
  'Histórico de tentativas PIX para reconciliar webhooks repetidos ou atrasados sem perder pagamentos anteriores.';
COMMENT ON TABLE public.candidato_reserva_auditoria IS
  'Trilha imutável de confirmações manuais de reserva de candidatos.';
