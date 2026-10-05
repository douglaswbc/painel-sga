CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS TABLE (
  saldo_liquido_mes numeric,
  receita_a_receber numeric,
  total_atrasado numeric,
  contratos_ativos bigint,
  adimplencia_mes numeric,
  cobrancas_vencidas_mes bigint,
  cobrancas_pagas_mes bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH periodo AS (
    SELECT
      date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS inicio_mes,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
      date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS inicio_mes_utc,
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo' AS inicio_proximo_mes_utc
  ),
  cobrancas_usuario AS (
    SELECT c.*
    FROM public.cobrancas AS c
    WHERE c.id_usuario = (SELECT auth.uid())
  ),
  financeiro AS (
    SELECT
      COALESCE(SUM(c.valor) FILTER (
        WHERE c.tipo = 'receita'
          AND c.status = 'pago'
          AND COALESCE(c.data_pagamento, (c.data_vencimento::timestamp + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo') >= p.inicio_mes_utc
          AND COALESCE(c.data_pagamento, (c.data_vencimento::timestamp + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo') < p.inicio_proximo_mes_utc
      ), 0)
      - COALESCE(SUM(c.valor) FILTER (
        WHERE c.tipo = 'despesa'
          AND c.status = 'pago'
          AND COALESCE(c.data_pagamento, (c.data_vencimento::timestamp + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo') >= p.inicio_mes_utc
          AND COALESCE(c.data_pagamento, (c.data_vencimento::timestamp + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo') < p.inicio_proximo_mes_utc
      ), 0) AS saldo_liquido_mes,
      COALESCE(SUM(c.valor) FILTER (
        WHERE c.tipo = 'receita' AND c.status IN ('pendente', 'atrasado')
      ), 0) AS receita_a_receber,
      COALESCE(SUM(c.valor) FILTER (
        WHERE c.tipo = 'receita' AND c.status = 'atrasado'
      ), 0) AS total_atrasado,
      COUNT(*) FILTER (
        WHERE c.tipo = 'receita'
          AND c.status <> 'cancelado'
          AND c.data_vencimento >= p.inicio_mes
          AND c.data_vencimento <= p.hoje
      ) AS cobrancas_vencidas_mes,
      COUNT(*) FILTER (
        WHERE c.tipo = 'receita'
          AND c.status = 'pago'
          AND c.data_vencimento >= p.inicio_mes
          AND c.data_vencimento <= p.hoje
      ) AS cobrancas_pagas_mes
    FROM cobrancas_usuario AS c
    CROSS JOIN periodo AS p
  ),
  contratos_usuario AS (
    SELECT COUNT(*) AS contratos_ativos
    FROM public.contratos AS c
    WHERE c.id_usuario = (SELECT auth.uid()) AND c.status = 'ativo'
  )
  SELECT
    financeiro.saldo_liquido_mes,
    financeiro.receita_a_receber,
    financeiro.total_atrasado,
    contratos_usuario.contratos_ativos,
    CASE
      WHEN financeiro.cobrancas_vencidas_mes = 0 THEN NULL
      ELSE round(financeiro.cobrancas_pagas_mes::numeric * 100 / financeiro.cobrancas_vencidas_mes, 1)
    END AS adimplencia_mes,
    financeiro.cobrancas_vencidas_mes,
    financeiro.cobrancas_pagas_mes
  FROM financeiro
  CROSS JOIN contratos_usuario;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_summary() IS
  'Returns tenant-scoped dashboard totals for the current São Paulo month; paid expenses are only subtracted when settled.';
