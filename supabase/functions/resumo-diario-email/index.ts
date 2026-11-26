/**
 * Daily summary cron handler (runs at 08:00 America/Sao_Paulo / 11:00 UTC).
 *
 * Iterates over landlords with Resend configured, enabled, and
 * `notificar_resumo_diario = true`, sending yesterday's charges and
 * WhatsApp template cost summary to each landlord's account e-mail.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isServiceRequest } from '../_shared/cron-auth.ts';
import { dispatchDailySummaryForOwner, getYesterdayBrtRange } from '../_shared/daily-summary.ts';

type Result = { ownerId: string; status: 'sent' | 'skipped' | 'failed'; reason?: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!isServiceRequest(req, serviceRoleKey)) {
    return json({ error: 'Cron authorization failed.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const range = getYesterdayBrtRange(now);

  const { data: configs, error: configError } = await admin
    .from('email_notificacoes_config')
    .select('*')
    .eq('enabled', true)
    .eq('notificar_resumo_diario', true)
    .not('api_key_ciphertext', 'is', null)
    .not('from_email', 'is', null);

  if (configError) {
    console.error('Failed to load email notification configs:', configError.message);
    return json({ error: 'Could not load email notification configs.' }, 500);
  }

  if (!configs?.length) {
    return json({ referenceDate: range.referenceDate, processed: 0, results: [] });
  }

  const ownerIds = (configs as Array<Record<string, any>>).map((row) => String(row.id_usuario));
  const { data: owners, error: ownersError } = await admin
    .from('usuarios')
    .select('id, email, nome_completo, empresa_nome, role, ativo')
    .in('id', ownerIds);

  if (ownersError) {
    console.error('Failed to load owners for daily summary:', ownersError.message);
    return json({ error: 'Could not load owners.' }, 500);
  }

  type OwnerRow = {
    id: string;
    email: string | null;
    nome_completo?: string | null;
    empresa_nome?: string | null;
    role?: string | null;
    ativo?: boolean | null;
  };
  const ownerMap = new Map((owners as OwnerRow[] ?? []).map((owner) => [owner.id, owner]));
  const results: Result[] = [];

  for (const config of configs as Array<Record<string, any>>) {
    const owner = ownerMap.get(String(config.id_usuario));
    if (!owner || owner.role !== 'locador' || owner.ativo !== true || !owner.email) {
      results.push({ ownerId: String(config.id_usuario), status: 'skipped', reason: 'inactive_or_missing_email' });
      continue;
    }

    try {
      const result = await dispatchDailySummaryForOwner(
        admin,
        {
          id: owner.id,
          email: owner.email,
          nome_completo: owner.nome_completo ?? null,
          empresa_nome: owner.empresa_nome ?? null,
        },
        config,
        { manual: false, now },
      );
      if (result.sent) {
        results.push({ ownerId: owner.id, status: 'sent' });
      } else if (result.skipped) {
        results.push({ ownerId: owner.id, status: 'skipped', reason: result.reason });
      } else {
        results.push({ ownerId: owner.id, status: 'failed', reason: result.reason });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Daily summary failed for owner ${owner.id}:`, message);
      results.push({ ownerId: owner.id, status: 'failed', reason: message });
    }
  }

  return json({
    referenceDate: range.referenceDate,
    processed: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
});
