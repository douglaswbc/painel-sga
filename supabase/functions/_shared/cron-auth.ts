/** Accept the legacy service-role bearer and the service key sent in `apikey` by Cron. */
export function isServiceRequest(req: Request, serviceRoleKey: string): boolean {
  if (!serviceRoleKey) return false;

  const authorization = req.headers.get('Authorization') || '';
  const bearerToken = authorization.replace(/^Bearer\s+/i, '');
  const apiKey = req.headers.get('apikey') || '';

  return bearerToken === serviceRoleKey || apiKey === serviceRoleKey;
}
