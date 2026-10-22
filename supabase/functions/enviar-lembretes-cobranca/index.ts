import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isServiceRequest } from '../_shared/cron-auth.ts';

type Result = { id: string; ownerId: string; status: string; detail?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!isServiceRequest(req, serviceRoleKey)) {
    return json({ error: 'Cron authorization failed.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const nowIso = now.toISOString();
  const { error: expiryError } = await admin.from('cobrancas').update({
    pix_expired_at: nowIso,
    next_reminder_at: null,
  })
    .in('status', ['pendente', 'atrasado'])
    .neq('tipo', 'despesa')
    .not('pix_expires_at', 'is', null)
    .lte('pix_expires_at', nowIso)
    .is('pix_expired_at', null);
  if (expiryError) console.error('Failed to mark expired PIX charges:', expiryError.message);

  const { data: charges, error } = await admin.from('cobrancas')
    .select('id,id_usuario,status,tipo,tentativas_envio')
    .in('status', ['pendente', 'atrasado'])
    .neq('tipo', 'despesa')
    .lte('next_reminder_at', nowIso)
    .gt('pix_expires_at', nowIso)
    .order('next_reminder_at')
    .limit(15);
  if (error) {
    console.error('Could not load due charges:', error.message);
    return json({ error: 'Could not load due charges.' }, 500);
  }
  if (!charges?.length) {
    const { count: waitingCount, error: waitingError } = await admin.from('cobrancas')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pendente', 'atrasado'])
      .neq('tipo', 'despesa')
      .gt('pix_expires_at', nowIso)
      .gt('next_reminder_at', nowIso);
    const { count: unscheduledCount, error: unscheduledError } = await admin.from('cobrancas')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pendente', 'atrasado'])
      .neq('tipo', 'despesa')
      .gt('pix_expires_at', nowIso)
      .is('next_reminder_at', null);
    if (waitingError) console.error('Could not count upcoming reminders:', waitingError.message);
    if (unscheduledError) console.error('Could not count unscheduled reminders:', unscheduledError.message);
    console.log(`No due reminders with active PIX. Waiting for interval: ${waitingCount || 0}; missing reminder schedule: ${unscheduledCount || 0}.`);
    return json({ processed: 0, results: [], waitingForInterval: waitingCount || 0, missingReminderSchedule: unscheduledCount || 0 });
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const ownerIds = [...new Set(charges.map((c) => c.id_usuario))];
  const { data: owners } = await admin.from('usuarios').select('id, reminder_dispatch_delay_seconds').in('id', ownerIds);
  const ownerDelayMap = new Map((owners || []).map((o: { id: string; reminder_dispatch_delay_seconds?: number }) => [o.id, Number(o.reminder_dispatch_delay_seconds ?? 5)]));

  const results: Result[] = [];
  for (let i = 0; i < charges.length; i++) {
    const charge = charges[i];
    if (i > 0) {
      const delaySec = ownerDelayMap.get(charge.id_usuario) ?? 5;
      if (delaySec > 0) {
        const jitterMs = Math.floor(Math.random() * 1500);
        await sleep(delaySec * 1000 + jitterMs);
      }
    }
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
        status: response.ok && payload?.success ? 'sent' : payload?.alreadySent ? 'already_sent' : payload?.skipped ? 'skipped' : 'failed',
        ...(!response.ok ? { detail: typeof payload?.error === 'string' ? payload.error.slice(0, 300) : `HTTP ${response.status}` } : {}),
      });
    } catch (error) {
      results.push({ id: charge.id, ownerId: charge.id_usuario, status: 'failed', detail: error instanceof Error ? error.message.slice(0, 300) : 'Request failed.' });
    }
  }
  const failedByReason = results.reduce<Record<string, number>>((counts, item) => {
    if (item.status === 'failed') {
      const reason = item.detail || 'Unknown error';
      counts[reason] = (counts[reason] || 0) + 1;
    }
    return counts;
  }, {});
  const failureSummary = Object.entries(failedByReason).map(([reason, count]) => `${count} × ${reason}`).join('; ');
  console.log(`Reminder run completed: ${results.filter((item) => item.status === 'sent').length} sent, ${results.filter((item) => item.status === 'already_sent').length} already sent, ${results.filter((item) => item.status === 'skipped').length} skipped, ${results.filter((item) => item.status === 'failed').length} failed.${failureSummary ? ` Failure reasons: ${failureSummary}` : ''}`);
  return json({ processed: results.length, results });
});
