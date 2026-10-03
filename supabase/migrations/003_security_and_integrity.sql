-- Phase 2: tenant isolation, relational integrity and least-privilege access.
-- Apply after 002_billing_idempotency.sql. This migration intentionally fails
-- if legacy rows violate the new tenant relationships or contain invalid dates.

-- Validate legacy dates before converting text to DATE. Invalid rows must be
-- reviewed and corrected rather than silently normalized.
DO $date_preflight$
DECLARE
  invalid_ids text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.cobrancas'::regclass
      AND attname = 'data_vencimento'
      AND atttypid = 'text'::regtype
      AND NOT attisdropped
  ) THEN
    BEGIN
      SELECT string_agg(id::text, ', ')
        INTO invalid_ids
      FROM (
        SELECT id
        FROM public.cobrancas
        WHERE data_vencimento IS NULL
           OR data_vencimento !~ '^\d{4}-\d{2}-\d{2}$'
           OR (data_vencimento ~ '^\d{4}-\d{2}-\d{2}$'
               AND data_vencimento::date::text <> data_vencimento)
        ORDER BY id
        LIMIT 20
      ) invalid_rows;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'cobrancas.data_vencimento contém data inválida. Corrija os valores antes de executar a migration. Detalhe: %', SQLERRM;
    END;

    IF invalid_ids IS NOT NULL THEN
      RAISE EXCEPTION 'cobrancas.data_vencimento precisa estar em YYYY-MM-DD. IDs (até 20): %', invalid_ids;
    END IF;
  END IF;
END;
$date_preflight$;

ALTER TABLE public.cobrancas
  ALTER COLUMN data_vencimento TYPE date
  USING data_vencimento::date;

-- Report existing cross-tenant links before adding the foreign keys.
DO $tenant_preflight$
DECLARE bad_ids text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad_ids FROM (
    SELECT c.id FROM public.contratos c
    JOIN public.locatarios l ON l.id = c.id_locatario
    WHERE l.id_usuario <> c.id_usuario
    UNION
    SELECT c.id FROM public.contratos c
    JOIN public.veiculos v ON v.id = c.id_veiculo
    WHERE v.id_usuario <> c.id_usuario
    UNION
    SELECT c.id FROM public.cobrancas c
    JOIN public.contratos k ON k.id = c.id_contrato
    WHERE k.id_usuario <> c.id_usuario
    UNION
    SELECT a.id FROM public.agendamentos_mensagens a
    JOIN public.mensagens_template t ON t.id = a.id_template
    WHERE t.id_usuario <> a.id_usuario
    UNION
    SELECT a.id FROM public.agendamentos_mensagens a
    JOIN public.locatarios l ON l.id = a.id_locatario
    WHERE l.id_usuario <> a.id_usuario
    UNION
    SELECT a.id FROM public.agendamentos_mensagens a
    JOIN public.contratos c ON c.id = a.id_contrato
    WHERE c.id_usuario <> a.id_usuario
    ORDER BY 1
    LIMIT 20
  ) invalid_links;
  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Há relações entre locadores diferentes. Corrija os registros afetados antes de executar a migration. IDs (até 20): %', bad_ids;
  END IF;
END;
$tenant_preflight$;

-- Composite unique indexes let foreign keys enforce that related rows belong
-- to the same landlord, even when requests bypass the application UI.
CREATE UNIQUE INDEX IF NOT EXISTS locatarios_id_usuario_uidx
  ON public.locatarios (id, id_usuario);
CREATE UNIQUE INDEX IF NOT EXISTS veiculos_id_usuario_uidx
  ON public.veiculos (id, id_usuario);
CREATE UNIQUE INDEX IF NOT EXISTS contratos_id_usuario_uidx
  ON public.contratos (id, id_usuario);
CREATE UNIQUE INDEX IF NOT EXISTS mensagens_template_id_usuario_uidx
  ON public.mensagens_template (id, id_usuario);

-- Replace single-column foreign keys with tenant-aware composite foreign keys.
ALTER TABLE public.contratos
  DROP CONSTRAINT IF EXISTS contratos_id_locatario_fkey,
  DROP CONSTRAINT IF EXISTS contratos_id_veiculo_fkey,
  DROP CONSTRAINT IF EXISTS contratos_locatario_mesmo_usuario_fkey,
  DROP CONSTRAINT IF EXISTS contratos_veiculo_mesmo_usuario_fkey;
ALTER TABLE public.contratos
  ADD CONSTRAINT contratos_locatario_mesmo_usuario_fkey
    FOREIGN KEY (id_locatario, id_usuario)
    REFERENCES public.locatarios (id, id_usuario) NOT VALID,
  ADD CONSTRAINT contratos_veiculo_mesmo_usuario_fkey
    FOREIGN KEY (id_veiculo, id_usuario)
    REFERENCES public.veiculos (id, id_usuario) NOT VALID;
ALTER TABLE public.contratos
  VALIDATE CONSTRAINT contratos_locatario_mesmo_usuario_fkey,
  VALIDATE CONSTRAINT contratos_veiculo_mesmo_usuario_fkey;

ALTER TABLE public.cobrancas
  DROP CONSTRAINT IF EXISTS cobrancas_id_contrato_fkey,
  DROP CONSTRAINT IF EXISTS cobrancas_contrato_mesmo_usuario_fkey;
ALTER TABLE public.cobrancas
  ADD CONSTRAINT cobrancas_contrato_mesmo_usuario_fkey
    FOREIGN KEY (id_contrato, id_usuario)
    REFERENCES public.contratos (id, id_usuario) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.cobrancas
  VALIDATE CONSTRAINT cobrancas_contrato_mesmo_usuario_fkey;

ALTER TABLE public.agendamentos_mensagens
  DROP CONSTRAINT IF EXISTS agendamentos_mensagens_template_fkey,
  DROP CONSTRAINT IF EXISTS agendamentos_mensagens_locatario_fkey,
  DROP CONSTRAINT IF EXISTS fk_agendamento_contrato,
  DROP CONSTRAINT IF EXISTS agendamentos_template_mesmo_usuario_fkey,
  DROP CONSTRAINT IF EXISTS agendamentos_locatario_mesmo_usuario_fkey,
  DROP CONSTRAINT IF EXISTS agendamentos_contrato_mesmo_usuario_fkey;
ALTER TABLE public.agendamentos_mensagens
  ADD CONSTRAINT agendamentos_template_mesmo_usuario_fkey
    FOREIGN KEY (id_template, id_usuario)
    REFERENCES public.mensagens_template (id, id_usuario) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT agendamentos_locatario_mesmo_usuario_fkey
    FOREIGN KEY (id_locatario, id_usuario)
    REFERENCES public.locatarios (id, id_usuario) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT agendamentos_contrato_mesmo_usuario_fkey
    FOREIGN KEY (id_contrato, id_usuario)
    REFERENCES public.contratos (id, id_usuario) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.agendamentos_mensagens
  VALIDATE CONSTRAINT agendamentos_template_mesmo_usuario_fkey,
  VALIDATE CONSTRAINT agendamentos_locatario_mesmo_usuario_fkey,
  VALIDATE CONSTRAINT agendamentos_contrato_mesmo_usuario_fkey;

CREATE INDEX IF NOT EXISTS idx_contratos_locatario_usuario
  ON public.contratos (id_locatario, id_usuario);
CREATE INDEX IF NOT EXISTS idx_contratos_veiculo_usuario
  ON public.contratos (id_veiculo, id_usuario);
CREATE INDEX IF NOT EXISTS idx_cobrancas_contrato_usuario
  ON public.cobrancas (id_contrato, id_usuario);
CREATE INDEX IF NOT EXISTS idx_cobrancas_usuario_vencimento
  ON public.cobrancas (id_usuario, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_agendamentos_locatario_usuario
  ON public.agendamentos_mensagens (id_locatario, id_usuario);

-- Restrict the admin predicate and pin name resolution inside its definer context.
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin'
  );
$function$;
REVOKE ALL ON FUNCTION public.check_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated, service_role;

-- User administration goes through these narrowly scoped RPCs; authenticated
-- clients cannot change their own role/status or update another account.
CREATE OR REPLACE FUNCTION public.admin_update_usuario(
  p_user_id uuid,
  p_nome_completo text,
  p_whatsapp text,
  p_role text,
  p_ativo boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.check_is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'locador', 'locatario') THEN
    RAISE EXCEPTION 'Papel de usuário inválido.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.usuarios
  SET nome_completo = p_nome_completo,
      whatsapp = p_whatsapp,
      role = p_role,
      ativo = p_ativo
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_usuario_status(p_user_id uuid, p_ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.check_is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.usuarios SET ativo = p_ativo WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_update_usuario(uuid, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_usuario_status(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_usuario(uuid, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_usuario_status(uuid, boolean) TO authenticated, service_role;

-- The Auth metadata is user controlled. Every new account starts as a landlord;
-- the trusted admin-create-user Edge Function may assign the requested role using
-- its service-role client after the trigger has created the profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.usuarios (id, email, nome_completo, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome_completo', 'locador');
  RETURN NEW;
END;
$function$;

-- Ensure view reads of safe tenant fields obey the caller's underlying RLS.
DO $view_security$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'locatarios_safe' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'ALTER VIEW public.locatarios_safe SET (security_invoker = true)';
  END IF;
END;
$view_security$;

-- Remove pre-existing policies on the covered tables so permissive legacy
-- policies cannot be OR-ed with the tenant policies below.
DO $drop_policies$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'usuarios', 'locatarios', 'veiculos', 'contratos', 'cobrancas',
        'mensagens_template', 'agendamentos_mensagens', 'candidatos',
        'mensalidades', 'fechaduras', 'fechadura_verificacoes',
        'fechadura_comandos', 'fechadura_logs'
      ])
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END;
$drop_policies$;

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendamentos_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechaduras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechadura_verificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechadura_comandos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechadura_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY usuarios_select_own_or_admin ON public.usuarios
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.check_is_admin()));
CREATE POLICY usuarios_update_own ON public.usuarios
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY locatarios_tenant_all ON public.locatarios
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY veiculos_tenant_all ON public.veiculos
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY contratos_tenant_all ON public.contratos
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY cobrancas_tenant_all ON public.cobrancas
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY mensagens_template_tenant_all ON public.mensagens_template
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY agendamentos_tenant_all ON public.agendamentos_mensagens
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY candidatos_tenant_all ON public.candidatos
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY mensalidades_admin_all ON public.mensalidades
  FOR ALL TO authenticated USING ((SELECT public.check_is_admin()))
  WITH CHECK ((SELECT public.check_is_admin()));
CREATE POLICY fechaduras_tenant_all ON public.fechaduras
  FOR ALL TO authenticated USING (id_usuario = (SELECT auth.uid()))
  WITH CHECK (id_usuario = (SELECT auth.uid()));
CREATE POLICY fechadura_logs_tenant_select ON public.fechadura_logs
  FOR SELECT TO authenticated USING (id_usuario = (SELECT auth.uid()));

-- Lock verification/command rows are written by trusted Edge Functions only.
REVOKE ALL ON TABLE
  public.usuarios, public.locatarios, public.veiculos, public.contratos,
  public.cobrancas, public.mensagens_template, public.agendamentos_mensagens,
  public.candidatos, public.mensalidades, public.fechaduras, public.fechadura_logs,
  public.fechadura_verificacoes, public.fechadura_comandos
  FROM anon;
REVOKE ALL ON TABLE public.fechadura_verificacoes, public.fechadura_comandos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.locatarios, public.veiculos, public.contratos, public.cobrancas,
  public.mensagens_template, public.agendamentos_mensagens, public.candidatos,
  public.fechaduras TO authenticated;
GRANT SELECT ON TABLE public.fechadura_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mensalidades TO authenticated;

-- User table contains payment and provider secrets. Never expose those columns
-- through PostgREST; secret RPCs/Edge Functions use service_role instead.
REVOKE ALL ON TABLE public.usuarios FROM anon, authenticated;
GRANT SELECT (id, nome_completo, whatsapp, email, role, empresa_nome, ativo, created_at,
              ryze_instance, mp_notification_url)
  ON TABLE public.usuarios TO authenticated;
GRANT UPDATE (nome_completo, whatsapp) ON TABLE public.usuarios TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

DO $safe_view_grants$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'locatarios_safe' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'REVOKE ALL ON public.locatarios_safe FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON public.locatarios_safe FROM anon';
    EXECUTE 'GRANT SELECT ON public.locatarios_safe TO authenticated';
  END IF;
END;
$safe_view_grants$;

-- Replace the bucket-wide authenticated upload/delete policies. Public reads
-- remain enabled for existing WhatsApp media URLs, but writes are owner-folder
-- scoped to the first path segment: <auth.uid()>/<filename>.
DO $storage_policies$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = ANY (ARRAY[
        'Permitir upload total', 'Permitir consulta total', 'Permitir exclusão total',
        'mensagens_midia_upload_own_folder', 'mensagens_midia_public_read',
        'mensagens_midia_delete_own_folder'
      ])
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END;
$storage_policies$;
CREATE POLICY mensagens_midia_upload_own_folder ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mensagens-midia'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY mensagens_midia_public_read ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'mensagens-midia');
CREATE POLICY mensagens_midia_delete_own_folder ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'mensagens-midia'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- Repair the volatility and ACL declared in 001_encrypt.sql when those routines
-- exist. Encryption keys and legacy secret RPCs are deployment-specific; this
-- migration does not overwrite or delete stored Mercado Pago credentials.
DO $crypto_hardening$
DECLARE crypto_schema text;
BEGIN
  IF to_regclass('public.app_config') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.app_config FROM PUBLIC, anon, authenticated';
  END IF;

  SELECT n.nspname INTO crypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  -- 001_encrypt.sql pins search_path to empty but calls pgcrypto functions
  -- without a schema. Recreate them with qualified, dynamically resolved names
  -- only when the existing key table and extension are present.
  IF crypto_schema IS NOT NULL AND to_regclass('public.app_config') IS NOT NULL THEN
    EXECUTE format($ddl$
      CREATE OR REPLACE FUNCTION public.encrypt_val(input_text text)
      RETURNS bytea
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
      AS $function$
      DECLARE
        enc_key text;
        encrypted_value bytea;
        crypto_schema constant text := %L;
      BEGIN
        IF input_text IS NULL THEN RETURN NULL; END IF;
        SELECT value INTO enc_key FROM public.app_config WHERE key = 'encryption_key';
        IF enc_key IS NULL THEN RAISE EXCEPTION 'Chave de criptografia não configurada.'; END IF;
        EXECUTE format('SELECT %%I.pgp_sym_encrypt($1, $2)', crypto_schema)
          INTO encrypted_value USING input_text, enc_key;
        RETURN encrypted_value;
      END;
      $function$
    $ddl$, crypto_schema);

    EXECUTE format($ddl$
      CREATE OR REPLACE FUNCTION public.decrypt_val(input_bytea bytea)
      RETURNS text
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
      AS $function$
      DECLARE
        enc_key text;
        decrypted_value text;
        crypto_schema constant text := %L;
      BEGIN
        IF input_bytea IS NULL THEN RETURN NULL; END IF;
        SELECT value INTO enc_key FROM public.app_config WHERE key = 'encryption_key';
        IF enc_key IS NULL THEN RAISE EXCEPTION 'Chave de criptografia não configurada.'; END IF;
        EXECUTE format('SELECT %%I.pgp_sym_decrypt($1, $2)', crypto_schema)
          INTO decrypted_value USING input_bytea, enc_key;
        RETURN decrypted_value;
      END;
      $function$
    $ddl$, crypto_schema);
  END IF;

  IF to_regprocedure('public.encrypt_val(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.encrypt_val(text) VOLATILE';
    EXECUTE 'REVOKE ALL ON FUNCTION public.encrypt_val(text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.encrypt_val(text) TO service_role';
  END IF;
  IF to_regprocedure('public.decrypt_val(bytea)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.decrypt_val(bytea) VOLATILE';
    EXECUTE 'REVOKE ALL ON FUNCTION public.decrypt_val(bytea) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.decrypt_val(bytea) TO service_role';
  END IF;
END;
$crypto_hardening$;

COMMENT ON COLUMN public.cobrancas.data_vencimento IS
  'Data local de vencimento da cobrança, armazenada como DATE.';
