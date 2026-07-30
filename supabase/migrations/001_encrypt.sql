CREATE OR REPLACE FUNCTION public.encrypt_val(input_text text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  enc_key text;
BEGIN
  SELECT value INTO enc_key FROM public.app_config WHERE key = 'encryption_key';
  RETURN pgp_sym_encrypt(input_text, enc_key);
END;
$func$;

CREATE OR REPLACE FUNCTION public.decrypt_val(input_bytea bytea)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  enc_key text;
BEGIN
  SELECT value INTO enc_key FROM public.app_config WHERE key = 'encryption_key';
  RETURN pgp_sym_decrypt(input_bytea, enc_key);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.encrypt_val(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_val(bytea) TO authenticated, service_role, anon;
