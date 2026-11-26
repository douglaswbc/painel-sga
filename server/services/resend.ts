const RESEND_API = 'https://api.resend.com';

export type ResendEmailInput = {
  apiKey: string;
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string | null;
};

export type ResendValidation = { valid: boolean; error: string | null };

function sanitize(message: unknown): string {
  if (typeof message !== 'string') return '';
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [ocultado]')
    .replace(/\bre_[A-Za-z0-9_-]{10,}/g, '[chave ocultada]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function formatSender(fromEmail: string, fromName?: string | null): string {
  const name = String(fromName ?? '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 80);
  return name ? `${name} <${fromEmail.trim()}>` : fromEmail.trim();
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message = payload?.message ?? payload?.error ?? payload?.name ?? `HTTP ${response.status}`;
  return sanitize(message) || `HTTP ${response.status}`;
}

export async function validateResendKey(apiKey: string): Promise<ResendValidation> {
  if (!apiKey || apiKey.length < 16) {
    return { valid: false, error: 'Informe uma API Key válida do Resend.' };
  }
  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return { valid: false, error: 'Não foi possível conectar ao Resend agora. Tente novamente.' };
  }
  if (response.ok || response.status === 403) return { valid: true, error: null };
  if (response.status === 401) {
    return { valid: false, error: 'A API Key do Resend não foi aceita. Confira a chave e as permissões.' };
  }
  return { valid: false, error: await readError(response) };
}

export async function sendResendEmail(input: ResendEmailInput): Promise<{ id: string | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: formatSender(input.from, input.fromName),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Não foi possível conectar ao Resend agora.');
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { id: typeof payload?.id === 'string' ? payload.id : null };
}
