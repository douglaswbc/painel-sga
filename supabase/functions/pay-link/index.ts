import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Redirecionador publico do botao "Pagar" dos templates da Meta.
 *
 * O botao de URL da Meta aceita apenas um trecho dinamico no fim da URL fixa,
 * entao o template aponta para /pagar/{{1}} (proxy do Cloudflare Pages) e o
 * valor enviado e o `pay_token` da cobranca. Esta funcao resolve o token e
 * responde com um 302 para o link real do Mercado Pago.
 *
 * Nao exige sessao: o token e o unico segredo e so revela o link daquela
 * cobranca. Nenhum dado do locador e devolvido.
 *
 * O Supabase reescreve respostas `text/html` de Edge Functions para
 * `text/plain`, entao os casos de erro redirecionam para a pagina publica
 * /pagar/aviso/<motivo> do SGA em vez de devolver HTML por aqui.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

const PUBLIC_BASE = (Deno.env.get('SGA_PUBLIC_URL') ?? 'https://painel-sga.pages.dev').replace(/\/+$/, '');

function notice(reason: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...baseHeaders, Location: `${PUBLIC_BASE}/pagar/aviso/${reason}` },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed.', { status: 405, headers: baseHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return notice('indisponivel');

  const token = (new URL(req.url).searchParams.get('t') ?? '').trim();
  if (!UUID_PATTERN.test(token)) return notice('invalido');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await admin
      .from('cobrancas')
      .select('status,payment_link,pix_expires_at,pix_expired_at')
      .eq('pay_token', token)
      .maybeSingle();

    if (error) {
      console.error('pay-link lookup failed:', error.code ?? 'database_error');
      return notice('indisponivel');
    }
    if (!data) return notice('invalido');
    if (data.status === 'pago') return notice('pago');
    if (data.status === 'cancelado') return notice('cancelado');

    const expiresAt = data.pix_expires_at ? new Date(data.pix_expires_at).getTime() : null;
    const expired = Boolean(data.pix_expired_at) || (expiresAt !== null && expiresAt <= Date.now());
    if (expired) return notice('expirado');
    if (typeof data.payment_link !== 'string' || !data.payment_link) return notice('indisponivel');

    let target: URL;
    try {
      target = new URL(data.payment_link);
    } catch {
      return notice('indisponivel');
    }
    if (target.protocol !== 'https:') return notice('indisponivel');

    return new Response(null, {
      status: 302,
      headers: { ...baseHeaders, Location: target.toString() },
    });
  } catch (error) {
    console.error('pay-link unexpected failure:', error instanceof Error ? error.message : 'unknown');
    return notice('indisponivel');
  }
});
