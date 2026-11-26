import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import {
  billingDate,
  nextContractSchedule,
  parseRecurrence,
  paymentIdempotencyKey,
  reminderStartAt,
} from './billing-helpers.js';
import { blockingAlertOwners } from './meta-alerts.js';
import { getUserMpToken } from './secrets.js';
import { sendChargeReminder, sendPaymentConfirmationForWebhook } from './whatsapp-sender.js';

type JsonRecord = Record<string, any>;

export type BillingOutcome = {
  id: string;
  status: 'ok' | 'skipped_duplicate' | 'error';
  msg?: string;
  proxima_cobranca?: string;
};

async function createMpPixPayment(
  mpToken: string,
  contrato: { id: string; valor: number; locatario_nome: string; locatario_email: string | null },
  expirationDate: Date,
  dueDateCheck: string,
): Promise<{ id: string; ticketUrl: string | null }> {
  const locatarioNome = contrato.locatario_nome?.split(' ').slice(0, 2).join(' ') ?? 'Locatário';
  const mpPayload = {
    description: `Aluguel: ${locatarioNome}`,
    external_reference: contrato.id,
    notification_url: loadEnv().urls.mpWebhook,
    payer: {
      email: contrato.locatario_email || 'financeiro@sga.com',
    },
    payment_method_id: 'pix',
    transaction_amount: Number(contrato.valor),
    date_of_expiration: expirationDate.toISOString(),
  };

  const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mpToken}`,
      'X-Idempotency-Key': paymentIdempotencyKey(contrato.id, dueDateCheck),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mpPayload),
    signal: AbortSignal.timeout(20000),
  });

  const mpData = (await mpResponse.json().catch(() => ({}))) as JsonRecord;
  if (!mpResponse.ok) {
    throw new Error(`Mercado Pago Error [${mpResponse.status}]: ${mpData.message ?? JSON.stringify(mpData)}`);
  }

  return {
    id: String(mpData.id),
    ticketUrl: mpData.point_of_interaction?.transaction_data?.ticket_url ?? null,
  };
}

export async function runAutoBilling(ownerId?: string): Promise<{ results: BillingOutcome[]; message?: string }> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  let sql = `
    SELECT
      c.id, c.id_usuario, c.id_locatario, c.valor, c.recorrencia, c.proxima_cobranca, c.ocorrencias_realizadas,
      u.reminder_stagger_minutes,
      l.nome_completo AS locatario_nome,
      l.email AS locatario_email
    FROM contratos c
    INNER JOIN usuarios u ON u.id = c.id_usuario
    INNER JOIN locatarios l ON l.id = c.id_locatario AND l.id_usuario = c.id_usuario
    WHERE c.status = 'ativo' AND c.proxima_cobranca <= ?
  `;
  const params: string[] = [nowIso];

  if (ownerId) {
    sql += ' AND c.id_usuario = ?';
    params.push(ownerId);
  }

  const contratos = db.prepare(sql).all(...params) as JsonRecord[];
  if (!contratos.length) {
    return { results: [], message: 'Nada para faturar.' };
  }

  const results: BillingOutcome[] = [];
  const landlordScheduledReminder = new Map<string, Date>();

  for (const contrato of contratos) {
    try {
      const mpToken = getUserMpToken(String(contrato.id_usuario));
      if (!mpToken) throw new Error('Locador sem token do Mercado Pago configurado.');

      const dataAtual = new Date(String(contrato.proxima_cobranca));
      const config = parseRecurrence(contrato.recorrencia, dataAtual);
      const dataVencimentoCheck = billingDate(String(contrato.proxima_cobranca));

      const existingCount = db
        .prepare('SELECT COUNT(*) AS total FROM cobrancas WHERE id_contrato = ? AND ciclo_cobranca = ?')
        .get(contrato.id, dataVencimentoCheck) as { total: number };

      if (existingCount.total > 0) {
        const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config);
        db.prepare(
          `UPDATE contratos
           SET proxima_cobranca = ?, ocorrencias_realizadas = ?, status = ?
           WHERE id = ? AND proxima_cobranca = ?`,
        ).run(
          schedule.proxima_cobranca,
          schedule.ocorrencias_realizadas,
          schedule.status,
          contrato.id,
          contrato.proxima_cobranca,
        );
        results.push({ id: String(contrato.id), status: 'skipped_duplicate' });
        continue;
      }

      const createdAt = new Date();
      const expirationDate = new Date(createdAt.getTime() + (config.expiracao || 4) * 60 * 60 * 1000);
      const staggerIntervalMinutes = Number(contrato.reminder_stagger_minutes ?? 2);
      let firstReminderAt = reminderStartAt(createdAt, config.horario_cobranca || '20:00', expirationDate);

      if (!landlordScheduledReminder.has(String(contrato.id_usuario))) {
        const latestPending = db
          .prepare(
            `SELECT next_reminder_at FROM cobrancas
             WHERE id_usuario = ? AND status IN ('pendente', 'atrasado') AND tipo <> 'despesa'
               AND next_reminder_at > ?
             ORDER BY next_reminder_at DESC LIMIT 1`,
          )
          .get(contrato.id_usuario, createdAt.toISOString()) as { next_reminder_at?: string } | undefined;
        if (latestPending?.next_reminder_at) {
          landlordScheduledReminder.set(String(contrato.id_usuario), new Date(latestPending.next_reminder_at));
        }
      }

      const lastScheduled = landlordScheduledReminder.get(String(contrato.id_usuario));
      if (lastScheduled) {
        const candidate = new Date(lastScheduled.getTime() + Math.max(1, staggerIntervalMinutes) * 60000);
        if (candidate.getTime() < expirationDate.getTime()) {
          firstReminderAt = candidate;
        }
      }
      landlordScheduledReminder.set(String(contrato.id_usuario), firstReminderAt);

      const mpData = await createMpPixPayment(
        mpToken,
        {
          id: String(contrato.id),
          valor: Number(contrato.valor),
          locatario_nome: String(contrato.locatario_nome),
          locatario_email: contrato.locatario_email ? String(contrato.locatario_email) : null,
        },
        expirationDate,
        dataVencimentoCheck,
      );

      try {
        db.prepare(
          `INSERT INTO cobrancas (
            id, id_contrato, id_locatario, id_usuario, valor, data_vencimento, ciclo_cobranca,
            status, mercado_pago_id, payment_link, pix_expires_at, next_reminder_at,
            reminder_interval_minutes, pay_token
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?)`,
        ).run(
          crypto.randomUUID(),
          contrato.id,
          contrato.id_locatario,
          contrato.id_usuario,
          Number(contrato.valor),
          dataVencimentoCheck,
          dataVencimentoCheck,
          mpData.id,
          mpData.ticketUrl,
          expirationDate.toISOString(),
          firstReminderAt.toISOString(),
          config.intervalo_lembrete_minutos || 30,
          crypto.randomUUID(),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('UNIQUE constraint failed')) {
          results.push({ id: String(contrato.id), status: 'skipped_duplicate' });
          continue;
        }
        throw err;
      }

      const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config);
      db.prepare(
        `UPDATE contratos SET proxima_cobranca = ?, ocorrencias_realizadas = ?, status = ? WHERE id = ?`,
      ).run(schedule.proxima_cobranca, schedule.ocorrencias_realizadas, schedule.status, contrato.id);

      results.push({ id: String(contrato.id), status: 'ok', proxima_cobranca: schedule.proxima_cobranca });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: String(contrato.id), status: 'error', msg });
    }
  }

  return { results };
}

export async function billContractById(ownerId: string, contratoId: string): Promise<BillingOutcome> {
  const db = getDb();

  const contrato = db
    .prepare(
      `SELECT
        c.id, c.id_usuario, c.id_locatario, c.valor, c.recorrencia, c.proxima_cobranca, c.ocorrencias_realizadas,
        u.reminder_stagger_minutes,
        l.nome_completo AS locatario_nome,
        l.email AS locatario_email
      FROM contratos c
      INNER JOIN usuarios u ON u.id = c.id_usuario
      INNER JOIN locatarios l ON l.id = c.id_locatario AND l.id_usuario = c.id_usuario
      WHERE c.id = ? AND c.id_usuario = ? AND c.status = 'ativo'
      LIMIT 1`,
    )
    .get(contratoId, ownerId) as JsonRecord | undefined;

  if (!contrato) {
    return { id: contratoId, status: 'error', msg: 'Contrato nao encontrado ou nao esta ativo.' };
  }

  const mpToken = getUserMpToken(ownerId);
  if (!mpToken) {
    throw new Error('O locador não configurou o token do Mercado Pago.');
  }

  const dataAtual = new Date(String(contrato.proxima_cobranca));
  const config = parseRecurrence(contrato.recorrencia, dataAtual);
  const dataVencimentoCheck = billingDate(dataAtual);

  const existingCount = db
    .prepare('SELECT COUNT(*) AS total FROM cobrancas WHERE id_contrato = ? AND ciclo_cobranca = ?')
    .get(contrato.id, dataVencimentoCheck) as { total: number };

  if (existingCount.total > 0) {
    const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config);
    db.prepare(
      `UPDATE contratos
       SET proxima_cobranca = ?, ocorrencias_realizadas = ?, status = ?
       WHERE id = ? AND proxima_cobranca = ?`,
    ).run(
      schedule.proxima_cobranca,
      schedule.ocorrencias_realizadas,
      schedule.status,
      contrato.id,
      contrato.proxima_cobranca,
    );
    return {
      id: contratoId,
      status: 'skipped_duplicate',
      msg: `Já existe uma cobrança ativa para ${dataVencimentoCheck}.`,
    };
  }

  const createdAt = new Date();
  const expirationDate = new Date(createdAt.getTime() + (config.expiracao || 4) * 60 * 60 * 1000);
  const staggerIntervalMinutes = Number(contrato.reminder_stagger_minutes ?? 2);
  let firstReminderAt = reminderStartAt(createdAt, config.horario_cobranca || '20:00', expirationDate);

  const latestPending = db
    .prepare(
      `SELECT next_reminder_at FROM cobrancas
       WHERE id_usuario = ? AND status IN ('pendente', 'atrasado') AND tipo <> 'despesa'
         AND next_reminder_at > ?
       ORDER BY next_reminder_at DESC LIMIT 1`,
    )
    .get(ownerId, createdAt.toISOString()) as { next_reminder_at?: string } | undefined;

  if (latestPending?.next_reminder_at) {
    const latestDate = new Date(latestPending.next_reminder_at);
    if (firstReminderAt.getTime() <= latestDate.getTime()) {
      const candidate = new Date(latestDate.getTime() + Math.max(1, staggerIntervalMinutes) * 60000);
      if (candidate.getTime() < expirationDate.getTime()) {
        firstReminderAt = candidate;
      }
    }
  }

  const mpData = await createMpPixPayment(
    mpToken,
    {
      id: String(contrato.id),
      valor: Number(contrato.valor),
      locatario_nome: String(contrato.locatario_nome),
      locatario_email: contrato.locatario_email ? String(contrato.locatario_email) : null,
    },
    expirationDate,
    dataVencimentoCheck,
  );

  try {
    db.prepare(
      `INSERT INTO cobrancas (
        id, id_contrato, id_locatario, id_usuario, valor, data_vencimento, ciclo_cobranca,
        status, mercado_pago_id, payment_link, pix_expires_at, next_reminder_at,
        reminder_interval_minutes, pay_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      contrato.id,
      contrato.id_locatario,
      ownerId,
      Number(contrato.valor),
      dataVencimentoCheck,
      dataVencimentoCheck,
      mpData.id,
      mpData.ticketUrl,
      expirationDate.toISOString(),
      firstReminderAt.toISOString(),
      config.intervalo_lembrete_minutos || 30,
      crypto.randomUUID(),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE constraint failed')) {
      const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config);
      db.prepare(
        `UPDATE contratos
         SET proxima_cobranca = ?, ocorrencias_realizadas = ?, status = ?
         WHERE id = ? AND proxima_cobranca = ?`,
      ).run(
        schedule.proxima_cobranca,
        schedule.ocorrencias_realizadas,
        schedule.status,
        contrato.id,
        contrato.proxima_cobranca,
      );
      return {
        id: contratoId,
        status: 'skipped_duplicate',
        msg: 'Já existe uma cobrança ativa para este contrato e vencimento.',
      };
    }
    throw err;
  }

  const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config);
  db.prepare(`UPDATE contratos SET proxima_cobranca = ?, ocorrencias_realizadas = ?, status = ? WHERE id = ?`).run(
    schedule.proxima_cobranca,
    schedule.ocorrencias_realizadas,
    schedule.status,
    contrato.id,
  );

  return {
    id: contratoId,
    status: 'ok',
    msg: 'Cobranca gerada com sucesso.',
    proxima_cobranca: schedule.proxima_cobranca,
  };
}

export async function runChargeReminders(): Promise<void> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE cobrancas
     SET pix_expired_at = ?, next_reminder_at = NULL
     WHERE status IN ('pendente', 'atrasado')
       AND tipo <> 'despesa'
       AND pix_expires_at IS NOT NULL
       AND pix_expires_at <= ?
       AND pix_expired_at IS NULL`,
  ).run(nowIso, nowIso);

  const charges = db
    .prepare(
      `SELECT id, id_usuario, tentativas_envio
       FROM cobrancas
       WHERE status IN ('pendente', 'atrasado')
         AND tipo <> 'despesa'
         AND next_reminder_at IS NOT NULL
         AND next_reminder_at <= ?
         AND pix_expires_at > ?
       ORDER BY next_reminder_at ASC
       LIMIT 15`,
    )
    .all(nowIso, nowIso) as Array<{ id: string; id_usuario: string; tentativas_envio: number }>;

  if (!charges.length) return;

  const ownerIds = [...new Set(charges.map((c) => c.id_usuario))];
  const placeholders = ownerIds.map(() => '?').join(', ');
  const owners = db
    .prepare(`SELECT id, reminder_dispatch_delay_seconds FROM usuarios WHERE id IN (${placeholders})`)
    .all(...ownerIds) as Array<{ id: string; reminder_dispatch_delay_seconds?: number }>;
  const ownerDelayMap = new Map(owners.map((o) => [o.id, Number(o.reminder_dispatch_delay_seconds ?? 5)]));

  const integrations = db
    .prepare(`SELECT id_usuario, provider FROM zernio_integracoes WHERE id_usuario IN (${placeholders})`)
    .all(...ownerIds) as Array<{ id_usuario: string; provider?: string }>;
  const metaOwners = integrations.filter((r) => r.provider === 'meta').map((r) => r.id_usuario);
  const blockedOwners = blockingAlertOwners(metaOwners);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < charges.length; i++) {
    const charge = charges[i];
    if (blockedOwners.has(charge.id_usuario)) continue;

    try {
      await sendChargeReminder(charge.id_usuario, charge.id, {
        serviceCall: true,
        reminderSequence: Number(charge.tentativas_envio || 0) + 1,
      });
    } catch (err) {
      console.error(`[cron:lembretes] Falha ao enviar lembrete da cobrança ${charge.id}:`, err);
    }

    if (i < charges.length - 1) {
      const delaySec = ownerDelayMap.get(charge.id_usuario) ?? 5;
      if (delaySec > 0) await sleep(delaySec * 1000);
    }
  }
}

export async function handleMercadoPagoWebhook(payload: JsonRecord, queryId?: string): Promise<{ status: number; body: JsonRecord }> {
  if (payload?.action !== 'payment.updated' && payload?.type !== 'payment' && payload?.topic !== 'payment') {
    return { status: 200, body: { success: true, ignored: true } };
  }

  const resourceId =
    typeof payload.resource === 'string'
      ? payload.resource.split('/').filter(Boolean).pop()
      : (payload.resource ?? '');
  const paymentId = String(payload.data?.id || resourceId || queryId || '').trim();
  if (!paymentId) {
    return { status: 400, body: { error: 'paymentId não encontrado no payload' } };
  }

  const db = getDb();
  const charge = db
    .prepare(
      `SELECT c.*, l.nome_completo AS loc_nome, l.whatsapp AS loc_whatsapp
       FROM cobrancas c
       LEFT JOIN locatarios l ON l.id = c.id_locatario
       WHERE c.mercado_pago_id = ?`,
    )
    .get(paymentId) as JsonRecord | undefined;

  const reservationAttempt = !charge
    ? (db.prepare('SELECT * FROM candidato_reserva_pagamentos WHERE mercado_pago_id = ?').get(paymentId) as
        | JsonRecord
        | undefined)
    : undefined;

  const candidate = !charge
    ? (db
        .prepare(
          `SELECT * FROM candidatos WHERE ${reservationAttempt ? 'id = ?' : 'pagamento_id = ?'}`,
        )
        .get(reservationAttempt ? reservationAttempt.id_candidato : paymentId) as JsonRecord | undefined)
    : undefined;

  if (!charge && !candidate) {
    return { status: 404, body: { error: `Pagamento ${paymentId} não localizado no sistema` } };
  }

  const ownerId = String(charge ? charge.id_usuario : candidate!.id_usuario);
  const accessToken = getUserMpToken(ownerId);
  if (!accessToken) {
    throw new Error('Locador sem Access Token configurado.');
  }

  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const mpPayment = (await mpResponse.json().catch(() => ({}))) as JsonRecord;
  if (!mpResponse.ok) {
    throw new Error(`Mercado Pago retornou HTTP ${mpResponse.status}`);
  }

  if (candidate) {
    const paymentStatus = String(mpPayment.status ?? '').toLowerCase();
    const detail = String(mpPayment.status_detail ?? '').toLowerCase();
    const statusMap: Record<string, string> = {
      approved: 'Confirmado',
      pending: 'Pendente',
      in_process: 'Processando',
      authorized: 'Autorizado',
      rejected: 'Rejeitado',
      cancelled: detail.includes('expired') ? 'Expirado' : 'Cancelado',
      refunded: 'Reembolsado',
      charged_back: 'Contestado',
      in_mediation: 'Em disputa',
    };
    const candidatePaymentStatus = statusMap[paymentStatus];
    if (!candidatePaymentStatus) {
      return { status: 200, body: { success: true, ignored: true, paymentStatus } };
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO candidato_reserva_pagamentos (
        id, id_candidato, id_usuario, mercado_pago_id, status, status_detalhe, valor, expira_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (mercado_pago_id) DO UPDATE SET
        status = excluded.status,
        status_detalhe = excluded.status_detalhe,
        valor = excluded.valor,
        expira_em = excluded.expira_em,
        atualizado_em = excluded.atualizado_em`,
    ).run(
      crypto.randomUUID(),
      candidate.id,
      ownerId,
      paymentId,
      candidatePaymentStatus,
      mpPayment.status_detail ?? null,
      Number(mpPayment.transaction_amount ?? reservationAttempt?.valor ?? 0),
      mpPayment.date_of_expiration ?? reservationAttempt?.expira_em ?? null,
      now,
    );

    const currentPayment = String(candidate.pagamento_id ?? '') === paymentId;
    const currentCandidateStatus = String(candidate.status ?? '').trim().toLocaleLowerCase('pt-BR');
    const manuallyConfirmed =
      String(candidate.pagamento_status ?? '').trim().toLocaleLowerCase('pt-BR') === 'confirmado manualmente';
    const alreadyConfirmed =
      String(candidate.pagamento_status ?? '').trim().toLocaleLowerCase('pt-BR') === 'confirmado' &&
      ['vaga reservada', 'reserva confirmada'].includes(currentCandidateStatus);

    let candidateUpdate: Record<string, unknown> | null = null;
    if (paymentStatus === 'approved') {
      if (!alreadyConfirmed) {
        candidateUpdate = {
          status: 'Vaga reservada',
          pagamento_status: 'Confirmado',
          reserva_confirmada_em: mpPayment.date_approved ?? now,
          updated_at: now,
        };
      }
    } else if (currentPayment && paymentStatus === 'refunded' && !manuallyConfirmed) {
      candidateUpdate = {
        status: 'Pré-aprovado',
        pagamento_status: candidatePaymentStatus,
        pagamento_id: null,
        pix_qr_code: null,
        pix_copia_e_cola: null,
        pix_url: null,
        reserva_expira_em: null,
        reserva_idempotency_key: null,
        reserva_confirmada_em: null,
        updated_at: now,
      };
    } else if (
      currentPayment &&
      !manuallyConfirmed &&
      !['vaga reservada', 'reserva confirmada'].includes(currentCandidateStatus)
    ) {
      if (['rejected', 'cancelled'].includes(paymentStatus)) {
        candidateUpdate = {
          status: 'Pré-aprovado',
          pagamento_status: candidatePaymentStatus,
          pagamento_id: null,
          pix_qr_code: null,
          pix_copia_e_cola: null,
          pix_url: null,
          reserva_expira_em: null,
          reserva_idempotency_key: null,
          reserva_confirmada_em: null,
          updated_at: now,
        };
      } else {
        candidateUpdate = {
          status: 'Aguardando reserva',
          pagamento_status: candidatePaymentStatus,
          updated_at: now,
        };
      }
    } else if (currentPayment && ['charged_back', 'in_mediation'].includes(paymentStatus)) {
      candidateUpdate = { pagamento_status: candidatePaymentStatus, updated_at: now };
    }

    if (candidateUpdate) {
      const entries = Object.entries(candidateUpdate);
      const setClause = entries.map(([col]) => `${col} = ?`).join(', ');
      const vals = entries.map(([, val]) => val as string | number | null);
      const whereClause = paymentStatus !== 'approved' ? 'WHERE id = ? AND pagamento_id = ?' : 'WHERE id = ?';
      const whereVals = paymentStatus !== 'approved' ? [candidate.id, paymentId] : [candidate.id];

      const upd = db.prepare(`UPDATE candidatos SET ${setClause} ${whereClause}`).run(...vals, ...whereVals);
      if (upd.changes > 0) {
        const nextStatus = String(candidateUpdate.status ?? candidate.status ?? '');
        const nextPaymentStatus = String(candidateUpdate.pagamento_status ?? candidate.pagamento_status ?? '');
        const changedPayment = nextPaymentStatus !== String(candidate.pagamento_status ?? '');
        db.prepare(
          `INSERT INTO candidato_reserva_auditoria (
            id, id_candidato, id_usuario, operador_id, acao, origem,
            status_anterior, status_novo, pagamento_status_anterior, pagamento_status_novo, motivo
          ) VALUES (?, ?, ?, NULL, ?, 'sistema', ?, ?, ?, ?, ?)`,
        ).run(
          crypto.randomUUID(),
          candidate.id,
          ownerId,
          changedPayment ? 'atualizacao_pagamento' : 'alteracao_status',
          candidate.status,
          nextStatus,
          candidate.pagamento_status,
          nextPaymentStatus,
          changedPayment
            ? `Pagamento: ${candidate.pagamento_status ?? 'sem status'} → ${nextPaymentStatus}`
            : `Status: ${candidate.status ?? 'sem status'} → ${nextStatus}`,
        );

        if (paymentStatus === 'approved') {
          await sendPaymentConfirmationForWebhook(
            ownerId,
            paymentId,
            candidate,
            Number(mpPayment.transaction_amount ?? 0),
            String(candidateUpdate.reserva_confirmada_em),
            'id_candidato',
            String(candidate.id),
          );
        }
      }
    }
  } else if (mpPayment.status === 'approved' && charge && charge.status !== 'pago') {
    const paidAt = new Date().toISOString();
    const upd = db
      .prepare(
        `UPDATE cobrancas SET status = 'pago', data_pagamento = ?, next_reminder_at = NULL
         WHERE id = ? AND status <> 'pago'`,
      )
      .run(paidAt, charge.id);

    if (upd.changes > 0) {
      await sendPaymentConfirmationForWebhook(
        ownerId,
        paymentId,
        { nome_completo: charge.loc_nome, whatsapp: charge.loc_whatsapp },
        Number(charge.valor),
        paidAt,
        'id_cobranca',
        String(charge.id),
      );
    }
  }

  return { status: 200, body: { success: true } };
}
