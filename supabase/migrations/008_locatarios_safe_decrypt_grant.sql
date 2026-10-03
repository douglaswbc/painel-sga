-- locatarios_safe is a security-invoker view and decrypts protected tenant
-- columns. Authenticated callers need EXECUTE for the view to work; table RLS
-- continues to restrict the ciphertext rows to the caller's own locatarios.
REVOKE ALL ON FUNCTION public.decrypt_val(bytea) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_val(bytea) TO authenticated, service_role;

COMMENT ON FUNCTION public.decrypt_val(bytea) IS
  'Descriptografa dados de locatarios_safe; acesso ao ciphertext e limitado por RLS por locador.';
