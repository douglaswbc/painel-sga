CREATE TABLE IF NOT EXISTS public.zernio_whatsapp_template_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.zernio_whatsapp_templates(id) ON DELETE CASCADE,
  id_usuario uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('charge', 'payment_confirmation')),
  variable_mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, purpose)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_template_usages_one_default
  ON public.zernio_whatsapp_template_usages (id_usuario, account_id, purpose)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_zernio_template_usages_owner_template
  ON public.zernio_whatsapp_template_usages (id_usuario, template_id);

ALTER TABLE public.zernio_whatsapp_template_usages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_whatsapp_template_usages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zernio_whatsapp_template_usages TO service_role;

-- Preserve the current default selections and their mappings during the move.
INSERT INTO public.zernio_whatsapp_template_usages (
  template_id, id_usuario, account_id, purpose, variable_mapping, is_default
)
SELECT id, id_usuario, account_id, purpose, COALESCE(variable_mapping, '[]'::jsonb), true
FROM public.zernio_whatsapp_templates
WHERE purpose IN ('charge', 'payment_confirmation')
  AND is_default = true
  AND status = 'APPROVED'
ON CONFLICT (template_id, purpose) DO UPDATE
SET variable_mapping = EXCLUDED.variable_mapping,
    is_default = true,
    updated_at = now();
