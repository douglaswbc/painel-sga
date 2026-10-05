/** Accept legacy service-role JWTs and the project's default secret API key. */
export function isServiceRequest(req: Request, serviceRoleKey: string): boolean {
  const authorization = req.headers.get('Authorization') || '';
  const bearerToken = authorization.replace(/^Bearer\s+/i, '');
  const apiKey = req.headers.get('apikey') || '';
  if (serviceRoleKey && (bearerToken === serviceRoleKey || apiKey === serviceRoleKey)) return true;

  // The default secret API key may invoke privileged cron handlers only in
  // `apikey`, never as a bearer token.
  try {
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return typeof apiKey === 'string' && Boolean(secretKeys.default) && secretKeys.default === apiKey;
  } catch {
    return false;
  }
}
