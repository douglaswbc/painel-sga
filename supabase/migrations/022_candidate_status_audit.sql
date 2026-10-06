ALTER TABLE public.candidato_reserva_auditoria
  ALTER COLUMN operador_id DROP NOT NULL,
  ALTER COLUMN motivo DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'operador',
  ADD COLUMN IF NOT EXISTS pagamento_status_anterior text,
  ADD COLUMN IF NOT EXISTS pagamento_status_novo text;

ALTER TABLE public.candidato_reserva_auditoria
  DROP CONSTRAINT IF EXISTS candidato_reserva_auditoria_acao_check;

ALTER TABLE public.candidato_reserva_auditoria
  ADD CONSTRAINT candidato_reserva_auditoria_acao_check
  CHECK (acao IN ('confirmacao_manual', 'alteracao_status', 'atualizacao_pagamento'));

ALTER TABLE public.candidato_reserva_auditoria
  ADD CONSTRAINT candidato_reserva_auditoria_origem_check
  CHECK (origem IN ('operador', 'sistema'));

CREATE OR REPLACE FUNCTION public.registrar_historico_status_candidato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator_id uuid := auth.uid();
  v_action text;
  v_reason text;
BEGIN
  IF current_setting('app.skip_candidate_reserva_audit', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status
    AND OLD.pagamento_status IS NOT DISTINCT FROM NEW.pagamento_status THEN
    RETURN NEW;
  END IF;

  v_action := CASE
    WHEN OLD.pagamento_status IS DISTINCT FROM NEW.pagamento_status THEN 'atualizacao_pagamento'
    ELSE 'alteracao_status'
  END;
  v_reason := CASE
    WHEN OLD.pagamento_status IS DISTINCT FROM NEW.pagamento_status
      THEN format('Pagamento: %s → %s', COALESCE(OLD.pagamento_status, 'sem status'), COALESCE(NEW.pagamento_status, 'sem status'))
    ELSE format('Status: %s → %s', COALESCE(OLD.status, 'sem status'), COALESCE(NEW.status, 'sem status'))
  END;

  INSERT INTO public.candidato_reserva_auditoria (
    id_candidato, id_usuario, operador_id, acao, origem,
    status_anterior, status_novo,
    pagamento_status_anterior, pagamento_status_novo,
    motivo
  ) VALUES (
    NEW.id, NEW.id_usuario, v_operator_id, v_action,
    CASE WHEN v_operator_id IS NULL THEN 'sistema' ELSE 'operador' END,
    OLD.status, NEW.status,
    OLD.pagamento_status, NEW.pagamento_status,
    v_reason
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidatos_status_audit ON public.candidatos;
CREATE TRIGGER candidatos_status_audit
AFTER UPDATE OF status, pagamento_status ON public.candidatos
FOR EACH ROW
EXECUTE FUNCTION public.registrar_historico_status_candidato();

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
    (id_candidato, id_usuario, operador_id, acao, origem, status_anterior, status_novo, motivo)
  VALUES
    (v_candidate.id, v_user_id, v_user_id, 'confirmacao_manual', 'operador', v_candidate.status, 'Vaga reservada', btrim(p_motivo))
  RETURNING id INTO v_audit_id;

  PERFORM set_config('app.skip_candidate_reserva_audit', '1', true);
  UPDATE public.candidatos
  SET status = 'Vaga reservada',
      pagamento_status = 'Confirmado manualmente',
      reserva_confirmada_em = now(),
      updated_at = now()
  WHERE id = v_candidate.id;

  RETURN v_audit_id;
END;
$$;
