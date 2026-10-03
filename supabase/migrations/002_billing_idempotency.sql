-- Give recurring rent invoices an explicit cycle date. This avoids treating a
-- manual maintenance/rent adjustment as the recurring rent invoice.
ALTER TABLE public.cobrancas
  ADD COLUMN IF NOT EXISTS ciclo_cobranca date;

-- Backfill invoices already created through Mercado Pago when their due date
-- is stored in the canonical ISO date format. Keep every historical invoice;
-- if duplicates exist, only one row represents the recurring cycle in the
-- unique index. Prefer a paid row, then the oldest record for stable reruns.
WITH ranked_cycles AS (
  SELECT
    id,
    id_contrato,
    data_vencimento::date AS ciclo,
    row_number() OVER (
      PARTITION BY id_contrato, data_vencimento::date
      ORDER BY (status = 'pago') DESC, created_at ASC, id ASC
    ) AS cycle_rank
  FROM public.cobrancas
  WHERE id_contrato IS NOT NULL
    AND mercado_pago_id IS NOT NULL
    AND data_vencimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
), assigned_cycles AS (
  SELECT id, CASE WHEN cycle_rank = 1 THEN ciclo ELSE NULL END AS ciclo
  FROM ranked_cycles
)
UPDATE public.cobrancas AS c
SET ciclo_cobranca = a.ciclo
FROM assigned_cycles AS a
WHERE c.id = a.id
  AND c.ciclo_cobranca IS DISTINCT FROM a.ciclo;

-- Prevent concurrent automatic/manual recurring runs from creating more than
-- one rent invoice for the same contract cycle. A canceled cycle stays closed;
-- a later explicit retry workflow can introduce a separate generation number.
--
-- Review legacy duplicates before/after migration. The migration preserves all
-- rows and only assigns one cycle marker; verify payment IDs/statuses manually.
-- SELECT id_contrato, data_vencimento::date AS ciclo_cobranca, count(*) AS registros,
--        array_agg(id ORDER BY created_at) AS cobrancas,
--        array_agg(mercado_pago_id ORDER BY created_at) AS pagamentos_mp,
--        array_agg(status ORDER BY created_at) AS status
-- FROM public.cobrancas
-- WHERE id_contrato IS NOT NULL
--   AND mercado_pago_id IS NOT NULL
--   AND data_vencimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
-- GROUP BY id_contrato, data_vencimento::date
-- HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cobrancas_contrato_ciclo_unique
  ON public.cobrancas (id_contrato, ciclo_cobranca)
  WHERE id_contrato IS NOT NULL AND ciclo_cobranca IS NOT NULL;
