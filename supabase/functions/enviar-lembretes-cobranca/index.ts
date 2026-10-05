import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Result = { id: string; ownerId: string; status: string; detail?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceRoleKey || req.headers.get('Authorization') !== `Bearer ${serviceRoleKey}`) {
    return json({ error: 'Cron authorization failed.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const nowIso = now.toISOString();
  await admin.from('cobrancas').update({
    pix_expired_at: nowIso,
    next_reminder_at: null,
  })
    .in('status', ['pendente', 'atrasado'])
    .neq('tipo', 'despesa')
    .not('pix_expires_at', 'is', null)
    .lte('pix_expires_at', nowIso)
    .is('pix_expired_at', null);

  const { data: charges, error } = await admin.from('cobrancas')
    .select('id,id_usuario,status,tipo,tentativas_envio')
    .in('status', ['pendente', 'atrasado'])
    .neq('tipo', 'despesa')
    .lte('next_reminder_at', nowIso)
    .gt('pix_expires_at', nowIso)
    .order('next_reminder_at')
    .limit(100);
  if (error) return json({ error: 'Could not load due charges.' }, 500);
  if (!charges?.length) return json({ processed: 0, results: [] });

  const results: Result[] = [];
  for (const charge of charges) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/zernio-whatsapp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'send_charge', ownerId: charge.id_usuario, chargeId: charge.id,
          reminderSequence: Number(charge.tentativas_envio || 0) + 1,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json().catch(() => ({}));
      results.push({
        id: charge.id,
        ownerId: charge.id_usuario,
        status: response.ok && payload?.success ? 'sent' : payload?.alreadySent ? 'already_sent' : 'failed',
        ...(!response.ok ? { detail: typeof payload?.error === 'string' ? payload.error.slice(0, 300) : `HTTP ${response.status}` } : {}),
      });
    } catch (error) {
      results.push({ id: charge.id, ownerId: charge.id_usuario, status: 'failed', detail: error instanceof Error ? error.message.slice(0, 300) : 'Request failed.' });
    }
  }
  return json({ processed: results.length, results });
});
