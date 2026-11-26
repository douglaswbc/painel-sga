import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { normalizeSegmentConfig, normalizeSegmentId } from '../config/segments.js';
import { getDb } from '../db/database.js';
import { sha256Hex } from '../utils/crypto.js';
import { getUserMpToken } from './secrets.js';
import { PublicError } from './whatsapp-sender.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVACY_NOTICE_VERSION = '2026-10-v1';
const DEFAULT_RESERVATION_AMOUNT_CENTS = 2500;
const MIN_RESERVATION_AMOUNT_CENTS = 100;
const MAX_RESERVATION_AMOUNT_CENTS = 1000000;
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const DAILY_QUOTA_LIMIT = 50;

type JsonRecord = Record<string, any>;

function normalizeStatusText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function canonicalStatus(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = normalizeStatusText(raw);
  const aliases: Record<string, string> = {
    'aguardando processamento': 'Em análise',
    'em analise': 'Em análise',
    'pre-aprovado': 'Pré-aprovado',
    'aguardando reserva': 'Aguardando reserva',
    'reserva confirmada': 'Vaga reservada',
    'vaga reservada': 'Vaga reservada',
    reprovado: 'Reprovado',
  };
  return aliases[normalized] || raw || 'Em análise';
}

function sqlBoolToJs(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  return Number(val) === 1;
}

function jsBoolToSql(val: unknown): number | null {
  if (typeof val === 'boolean') return val ? 1 : 0;
  return null;
}

function parseExtrasJson(raw: unknown): Record<string, string | number | boolean> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number | boolean>;
    }
  } catch {
    // Mantém nulo se não for JSON válido
  }
  return null;
}

function serializeExtrasJson(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    const key = k.trim().slice(0, 48);
    if (!key) continue;
    if (typeof v === 'string') {
      const trimmed = v.trim().slice(0, 240);
      if (trimmed) clean[key] = trimmed;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      clean[key] = v;
    }
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
}

export function formatCandidateRow(row: JsonRecord) {
  return {
    ...row,
    tem_220v: sqlBoolToJs(row.tem_220v),
    trabalha_em_app: sqlBoolToJs(row.trabalha_em_app),
    possui_processos_criminais: sqlBoolToJs(row.possui_processos_criminais),
    respostas_extras: parseExtrasJson(row.respostas_extras_json),
  };
}

export function validCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let total = 0;
    for (let i = 0; i < length; i += 1) total += Number(cpf[i]) * (length + 1 - i);
    const rem = (total * 10) % 11;
    return rem === 10 ? 0 : rem;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function amountToCents(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return null;
  return Math.round(amount * 100);
}

export function listCandidates(userId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM candidatos
       WHERE id_usuario = ?
       ORDER BY (score_formulario IS NULL) ASC, score_formulario DESC, created_at DESC`,
    )
    .all(userId) as JsonRecord[];

  return rows.map(formatCandidateRow);
}

export function updateCandidate(userId: string, candidateId: string, body: JsonRecord) {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM candidatos WHERE id = ? AND id_usuario = ?')
    .get(candidateId, userId) as JsonRecord | undefined;

  if (!existing) {
    throw new PublicError('Candidato não encontrado.', 404);
  }

  const allowedFields = [
    'status',
    'pagamento_status',
    'score_formulario',
    'score_credito',
    'email',
    'telefone',
    'reserva_valor',
  ] as const;

  const nextValues: Record<string, string | number | null> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      nextValues[field] = body[field] as string | number | null;
    }
  }

  if (nextValues.status !== undefined) {
    const currentCanonical = canonicalStatus(existing.status);
    const nextCanonical = canonicalStatus(nextValues.status);
    if (nextCanonical !== currentCanonical) {
      const allowedTransitions: Record<string, string[]> = {
        'Em análise': ['Pré-aprovado', 'Reprovado'],
        'Pré-aprovado': ['Reprovado'],
        'Aguardando reserva': [],
        'Vaga reservada': [],
        Reprovado: [],
      };
      const allowed = allowedTransitions[currentCanonical] || [];
      if (!allowed.includes(nextCanonical)) {
        throw new PublicError('Transição de status não permitida para este candidato.', 400);
      }
      nextValues.status = nextCanonical;
    }
  }

  if (Object.keys(nextValues).length === 0) {
    return formatCandidateRow(existing);
  }

  const now = new Date().toISOString();
  nextValues.updated_at = now;

  db.exec('BEGIN IMMEDIATE');
  try {
    const cols = Object.keys(nextValues);
    const setSql = cols.map((c) => `${c} = ?`).join(', ');
    const vals = cols.map((c) => nextValues[c]);

    db.prepare(`UPDATE candidatos SET ${setSql} WHERE id = ? AND id_usuario = ?`).run(
      ...vals,
      candidateId,
      userId,
    );

    const nextStatus = nextValues.status !== undefined ? String(nextValues.status) : existing.status;
    const nextPaymentStatus =
      nextValues.pagamento_status !== undefined ? String(nextValues.pagamento_status) : existing.pagamento_status;

    const statusChanged = (nextStatus ?? null) !== (existing.status ?? null);
    const paymentStatusChanged = (nextPaymentStatus ?? null) !== (existing.pagamento_status ?? null);

    if (statusChanged || paymentStatusChanged) {
      const action = paymentStatusChanged ? 'atualizacao_pagamento' : 'alteracao_status';
      const reason = paymentStatusChanged
        ? `Pagamento: ${existing.pagamento_status ?? 'sem status'} → ${nextPaymentStatus ?? 'sem status'}`
        : `Status: ${existing.status ?? 'sem status'} → ${nextStatus ?? 'sem status'}`;

      db.prepare(
        `INSERT INTO candidato_reserva_auditoria (
          id, id_candidato, id_usuario, operador_id, acao, origem,
          status_anterior, status_novo, pagamento_status_anterior, pagamento_status_novo, motivo
        ) VALUES (?, ?, ?, ?, ?, 'operador', ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        candidateId,
        userId,
        userId,
        action,
        existing.status ?? null,
        nextStatus ?? 'Em análise',
        existing.pagamento_status ?? null,
        nextPaymentStatus ?? null,
        reason,
      );
    }

    const updated = db
      .prepare('SELECT * FROM candidatos WHERE id = ? AND id_usuario = ?')
      .get(candidateId, userId) as JsonRecord;

    db.exec('COMMIT');
    return formatCandidateRow(updated);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getCandidateReservationHistory(userId: string, candidateId: string) {
  const db = getDb();
  const exists = db
    .prepare('SELECT id FROM candidatos WHERE id = ? AND id_usuario = ?')
    .get(candidateId, userId);

  if (!exists) {
    throw new PublicError('Candidato não encontrado.', 404);
  }

  const audit = db
    .prepare(
      `SELECT * FROM candidato_reserva_auditoria
       WHERE id_candidato = ? AND id_usuario = ?
       ORDER BY criado_em DESC`,
    )
    .all(candidateId, userId) as JsonRecord[];

  const payments = db
    .prepare(
      `SELECT * FROM candidato_reserva_pagamentos
       WHERE id_candidato = ? AND id_usuario = ?
       ORDER BY criado_em DESC`,
    )
    .all(candidateId, userId) as JsonRecord[];

  return { audit, payments };
}

function existingReusablePix(candidate: JsonRecord, now: Date) {
  const expiresAt = candidate.reserva_expira_em ? new Date(String(candidate.reserva_expira_em)) : null;
  if (
    !candidate.pagamento_id ||
    !candidate.pix_qr_code ||
    !candidate.pix_copia_e_cola ||
    !expiresAt ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= now
  ) {
    return null;
  }

  return {
    paymentId: String(candidate.pagamento_id),
    qrCode: String(candidate.pix_qr_code),
    copyPaste: String(candidate.pix_copia_e_cola),
    ticketUrl: candidate.pix_url ? String(candidate.pix_url) : null,
    expiresAt: expiresAt.toISOString(),
    amount: Number(candidate.reserva_valor ?? 25),
    alreadyExists: true,
  };
}

export async function createReservationPix(
  userId: string,
  candidateId: string,
  body: { email?: unknown; valorCentavos?: unknown },
) {
  if (!UUID_REGEX.test(candidateId)) {
    throw new PublicError('Candidato inválido.', 400);
  }

  const requestedAmountCents = body.valorCentavos == null ? null : body.valorCentavos;
  if (
    requestedAmountCents !== null &&
    (typeof requestedAmountCents !== 'number' ||
      !Number.isInteger(requestedAmountCents) ||
      requestedAmountCents < MIN_RESERVATION_AMOUNT_CENTS ||
      requestedAmountCents > MAX_RESERVATION_AMOUNT_CENTS)
  ) {
    throw new PublicError('Informe uma taxa entre R$ 1,00 e R$ 10.000,00, com até duas casas decimais.', 400);
  }

  const db = getDb();
  let candidate = db
    .prepare(
      `SELECT id, id_usuario, nome, cpf, email, status, pagamento_id, pagamento_status,
              pix_qr_code, pix_copia_e_cola, pix_url, reserva_expira_em, reserva_idempotency_key, reserva_valor
       FROM candidatos
       WHERE id = ? AND id_usuario = ?`,
    )
    .get(candidateId, userId) as JsonRecord | undefined;

  if (!candidate) {
    throw new PublicError('Candidato não encontrado.', 404);
  }

  const statusNorm = normalizeStatusText(candidate.status);
  if (['vaga reservada', 'reserva confirmada'].includes(statusNorm) || normalizeStatusText(candidate.pagamento_status) === 'confirmado') {
    throw new PublicError('A reserva deste candidato já está confirmada.', 409);
  }
  if (statusNorm === 'reprovado') {
    throw new PublicError('Candidatos reprovados não podem gerar uma reserva.', 409);
  }

  const now = new Date();
  const reusable = existingReusablePix(candidate, now);
  if (reusable) return reusable;

  if (candidate.pagamento_id) {
    const expired = candidate.reserva_expira_em && new Date(String(candidate.reserva_expira_em)) <= now;
    throw new PublicError(
      expired
        ? 'O PIX anterior expirou. A emissão de uma nova cobrança precisa ser feita após a etapa de reconciliação do pagamento.'
        : 'Já existe um pagamento associado, mas os dados necessários para recuperá-lo estão incompletos. Revise o candidato antes de tentar novamente.',
      409,
    );
  }

  if (!['pre-aprovado', 'aguardando reserva'].includes(statusNorm)) {
    throw new PublicError('Aprove o perfil antes de gerar a reserva PIX.', 409);
  }
  if (statusNorm === 'aguardando reserva' && !candidate.reserva_idempotency_key) {
    throw new PublicError(
      'A reserva está aguardando pagamento, mas não possui chave de recuperação. Revise o candidato antes de tentar novamente.',
      409,
    );
  }

  let reservationAmountCents: number;
  if (candidate.reserva_idempotency_key) {
    const savedAmountCents = amountToCents(candidate.reserva_valor) ?? DEFAULT_RESERVATION_AMOUNT_CENTS;
    if (requestedAmountCents !== null && requestedAmountCents !== savedAmountCents) {
      const formatted = (savedAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      throw new PublicError(
        `Já existe uma tentativa de cobrança de ${formatted}. Aguarde a conclusão antes de alterar o valor.`,
        409,
      );
    }
    reservationAmountCents = savedAmountCents;
  } else {
    reservationAmountCents =
      (requestedAmountCents as number | null) ?? amountToCents(candidate.reserva_valor) ?? DEFAULT_RESERVATION_AMOUNT_CENTS;
  }

  const requestedEmail = typeof body.email === 'string' ? body.email.trim() : '';
  let payerEmail: string;
  if (candidate.reserva_idempotency_key) {
    if (!isEmail(candidate.email)) {
      throw new PublicError(
        'A tentativa PIX anterior não tem um e-mail válido associado. Revise o cadastro antes de continuar.',
        409,
      );
    }
    if (isEmail(requestedEmail) && requestedEmail.toLowerCase() !== candidate.email.toLowerCase()) {
      throw new PublicError(
        'Já existe uma tentativa em andamento com outro e-mail. Aguarde a resposta do Mercado Pago para evitar uma cobrança duplicada.',
        409,
      );
    }
    payerEmail = candidate.email;
  } else {
    payerEmail = isEmail(requestedEmail) ? requestedEmail : String(candidate.email ?? '').trim();
    if (!isEmail(payerEmail)) {
      throw new PublicError('Informe um e-mail válido do candidato para gerar o PIX.', 400);
    }
  }

  const cpf = String(candidate.cpf ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) {
    throw new PublicError('O CPF do candidato precisa ter 11 dígitos para gerar o PIX.', 400);
  }

  const accessToken = getUserMpToken(userId);
  if (!accessToken) {
    throw new PublicError('Configure e valide a credencial do Mercado Pago antes de gerar o PIX.', 409);
  }

  const notificationUrl = loadEnv().urls.mpWebhook;
  try {
    const parsedUrl = new URL(notificationUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('invalid');
  } catch {
    throw new PublicError('O webhook do Mercado Pago não está configurado corretamente.', 503);
  }

  if (!candidate.reserva_idempotency_key) {
    const idempotencyKey = crypto.randomUUID();
    const claim = db
      .prepare(
        `UPDATE candidatos
         SET email = ?, reserva_idempotency_key = ?, reserva_valor = ?, updated_at = ?
         WHERE id = ? AND id_usuario = ? AND status = ? AND reserva_idempotency_key IS NULL`,
      )
      .run(
        payerEmail,
        idempotencyKey,
        reservationAmountCents / 100,
        now.toISOString(),
        candidate.id,
        userId,
        candidate.status,
      );

    if (claim.changes > 0) {
      candidate = {
        ...candidate,
        email: payerEmail,
        reserva_idempotency_key: idempotencyKey,
        reserva_valor: reservationAmountCents / 100,
      };
    } else {
      const refreshed = db
        .prepare(
          `SELECT id, id_usuario, nome, cpf, email, status, pagamento_id, pagamento_status,
                  pix_qr_code, pix_copia_e_cola, pix_url, reserva_expira_em, reserva_idempotency_key, reserva_valor
           FROM candidatos WHERE id = ? AND id_usuario = ?`,
        )
        .get(candidate.id, userId) as JsonRecord | undefined;

      if (!refreshed?.reserva_idempotency_key || !isEmail(refreshed.email)) {
        throw new PublicError('A reserva está sendo iniciada. Atualize a fila e tente novamente.', 409);
      }
      candidate = refreshed;
      const refreshedStatus = normalizeStatusText(candidate.status);
      if (refreshedStatus !== 'pre-aprovado' && refreshedStatus !== 'aguardando reserva') {
        throw new PublicError('O status do candidato mudou. Atualize a fila antes de continuar.', 409);
      }
      if (String(candidate.email).toLowerCase() !== payerEmail.toLowerCase()) {
        throw new PublicError(
          'Outra tentativa iniciou a reserva com um e-mail diferente. Atualize a fila e confirme o e-mail salvo.',
          409,
        );
      }
      const savedAmountCents = amountToCents(candidate.reserva_valor) ?? DEFAULT_RESERVATION_AMOUNT_CENTS;
      if (savedAmountCents !== reservationAmountCents) {
        const formatted = (savedAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        throw new PublicError(
          `Outra tentativa iniciou a cobrança de ${formatted}. Atualize a fila antes de tentar novamente.`,
          409,
        );
      }
      reservationAmountCents = savedAmountCents;
      payerEmail = String(candidate.email);
    }
  }

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
  const firstName = String(candidate.nome || '').trim().split(/\s+/)[0] || 'Candidato';

  let mpResponse: Response;
  try {
    mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': String(candidate.reserva_idempotency_key),
      },
      body: JSON.stringify({
        transaction_amount: reservationAmountCents / 100,
        description: 'Taxa de reserva de vaga',
        external_reference: candidate.id,
        notification_url: notificationUrl,
        date_of_expiration: expiresAt.toISOString(),
        payment_method_id: 'pix',
        payer: {
          email: payerEmail,
          first_name: firstName,
          identification: { type: 'CPF', number: cpf },
        },
        metadata: { id_candidato: candidate.id, id_usuario: userId },
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new PublicError(
      'Não foi possível conectar ao Mercado Pago. Tente novamente; a tentativa continuará protegida contra duplicidade.',
      502,
    );
  }

  const payment = (await mpResponse.json().catch(() => ({}))) as JsonRecord;
  if (!mpResponse.ok) {
    if ([400, 401, 403, 422].includes(mpResponse.status)) {
      db.prepare(
        `UPDATE candidatos
         SET reserva_idempotency_key = NULL, updated_at = ?
         WHERE id = ? AND id_usuario = ? AND reserva_idempotency_key = ? AND pagamento_id IS NULL`,
      ).run(new Date().toISOString(), candidate.id, userId, candidate.reserva_idempotency_key);
    }
    throw new PublicError(
      'O Mercado Pago não conseguiu gerar o PIX. Tente novamente; a tentativa continuará protegida contra duplicidade.',
      502,
    );
  }

  const transactionData = payment.point_of_interaction?.transaction_data ?? {};
  const qrCode = typeof transactionData.qr_code_base64 === 'string' ? transactionData.qr_code_base64 : '';
  const copyPaste = typeof transactionData.qr_code === 'string' ? transactionData.qr_code : '';
  const paymentId = payment.id == null ? '' : String(payment.id);
  if (!paymentId || !qrCode || !copyPaste) {
    throw new PublicError('O Mercado Pago retornou dados incompletos para o PIX. Tente novamente.', 502);
  }

  const actualExpiresAt = typeof payment.date_of_expiration === 'string' ? payment.date_of_expiration : expiresAt.toISOString();
  const ticketUrl = typeof transactionData.ticket_url === 'string' ? transactionData.ticket_url : null;
  const persistNow = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO candidato_reserva_pagamentos (
        id, id_candidato, id_usuario, mercado_pago_id, status, status_detalhe, valor, expira_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (mercado_pago_id) DO NOTHING`,
    ).run(
      crypto.randomUUID(),
      candidate.id,
      userId,
      paymentId,
      String(payment.status ?? 'pending'),
      payment.status_detail ?? null,
      Number(payment.transaction_amount ?? reservationAmountCents / 100),
      actualExpiresAt,
      persistNow,
    );

    const upd = db
      .prepare(
        `UPDATE candidatos
         SET pagamento_id = ?, pagamento_status = 'Pendente', status = 'Aguardando reserva',
             pix_qr_code = ?, pix_copia_e_cola = ?, pix_url = ?, reserva_expira_em = ?, updated_at = ?
         WHERE id = ? AND id_usuario = ? AND reserva_idempotency_key = ?
           AND lower(trim(coalesce(status, ''))) IN ('pré-aprovado', 'pre-aprovado', 'aguardando reserva')`,
      )
      .run(
        paymentId,
        qrCode,
        copyPaste,
        ticketUrl,
        actualExpiresAt,
        persistNow,
        candidate.id,
        userId,
        candidate.reserva_idempotency_key,
      );

    if (upd.changes > 0 && (candidate.pagamento_status !== 'Pendente' || candidate.status !== 'Aguardando reserva')) {
      db.prepare(
        `INSERT INTO candidato_reserva_auditoria (
          id, id_candidato, id_usuario, operador_id, acao, origem,
          status_anterior, status_novo, pagamento_status_anterior, pagamento_status_novo, motivo
        ) VALUES (?, ?, ?, ?, 'atualizacao_pagamento', 'operador', ?, 'Aguardando reserva', ?, 'Pendente', ?)`,
      ).run(
        crypto.randomUUID(),
        candidate.id,
        userId,
        userId,
        candidate.status ?? null,
        candidate.pagamento_status ?? null,
        `Pagamento: ${candidate.pagamento_status ?? 'sem status'} → Pendente`,
      );
    }

    db.exec('COMMIT');

    if (upd.changes === 0) {
      const current = db
        .prepare('SELECT pagamento_id, pix_qr_code, pix_copia_e_cola, pix_url, reserva_expira_em FROM candidatos WHERE id = ? AND id_usuario = ?')
        .get(candidate.id, userId) as JsonRecord | undefined;
      if (!current || current.pagamento_id !== paymentId) {
        throw new PublicError('O candidato mudou durante a criação do PIX. Atualize a fila antes de continuar.', 409);
      }
      return {
        paymentId: String(current.pagamento_id),
        qrCode: String(current.pix_qr_code),
        copyPaste: String(current.pix_copia_e_cola),
        ticketUrl: current.pix_url ? String(current.pix_url) : null,
        expiresAt: String(current.reserva_expira_em),
        amount: Number(payment.transaction_amount ?? reservationAmountCents / 100),
        alreadyExists: true,
      };
    }

    return {
      paymentId,
      qrCode,
      copyPaste,
      ticketUrl,
      expiresAt: actualExpiresAt,
      amount: Number(payment.transaction_amount ?? reservationAmountCents / 100),
      alreadyExists: false,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function confirmReservationManually(userId: string, candidateId: string, motivo: unknown) {
  const trimmedReason = typeof motivo === 'string' ? motivo.trim() : '';
  if (trimmedReason.length < 10 || trimmedReason.length > 1000) {
    throw new PublicError('Informe um motivo entre 10 e 1000 caracteres.', 400);
  }

  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const candidate = db
      .prepare('SELECT * FROM candidatos WHERE id = ? AND id_usuario = ?')
      .get(candidateId, userId) as JsonRecord | undefined;

    if (!candidate) {
      throw new PublicError('Candidato não encontrado.', 404);
    }

    const statusNorm = normalizeStatusText(candidate.status);
    if (!['aguardando reserva', 'pre-aprovado'].includes(statusNorm)) {
      throw new PublicError('O status atual não permite confirmar a reserva.', 400);
    }

    const paymentStatusNorm = normalizeStatusText(candidate.pagamento_status);
    const activeStatuses = new Set(['pendente', 'processando', 'autorizado', 'em analise', 'em disputa']);
    const expiresAtMs = candidate.reserva_expira_em ? new Date(String(candidate.reserva_expira_em)).getTime() : null;
    if (activeStatuses.has(paymentStatusNorm) && (expiresAtMs === null || expiresAtMs > Date.now())) {
      throw new PublicError(
        'Há um pagamento PIX ainda ativo; aguarde a reconciliação antes da confirmação manual.',
        409,
      );
    }

    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO candidato_reserva_auditoria (
        id, id_candidato, id_usuario, operador_id, acao, origem, status_anterior, status_novo,
        pagamento_status_anterior, pagamento_status_novo, motivo
      ) VALUES (?, ?, ?, ?, 'confirmacao_manual', 'operador', ?, 'Vaga reservada', ?, 'Confirmado manualmente', ?)`,
    ).run(
      auditId,
      candidate.id,
      userId,
      userId,
      candidate.status ?? null,
      candidate.pagamento_status ?? null,
      trimmedReason,
    );

    db.prepare(
      `UPDATE candidatos
       SET status = 'Vaga reservada',
           pagamento_status = 'Confirmado manualmente',
           reserva_confirmada_em = ?,
           updated_at = ?
       WHERE id = ? AND id_usuario = ?`,
    ).run(now, now, candidate.id, userId);

    const updated = db
      .prepare('SELECT * FROM candidatos WHERE id = ? AND id_usuario = ?')
      .get(candidate.id, userId) as JsonRecord;

    db.exec('COMMIT');
    return { auditId, data: formatCandidateRow(updated) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getApplicationLinkStatus(userId: string) {
  const db = getDb();
  const link = db
    .prepare('SELECT ativo, expires_at FROM candidate_application_links WHERE id_usuario = ?')
    .get(userId) as { ativo: number; expires_at: string } | undefined;

  return {
    exists: Boolean(link),
    active: Boolean(link && Number(link.ativo) === 1 && new Date(link.expires_at).getTime() > Date.now()),
    expiresAt: link?.expires_at ?? null,
  };
}

export function createApplicationLink(userId: string, requestOrigin?: string) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();

  db.prepare(
    `INSERT INTO candidate_application_links (
      id, id_usuario, token_hash, ativo, expires_at, requests_day, requests_today, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, NULL, 0, ?, ?)
    ON CONFLICT (id_usuario) DO UPDATE SET
      token_hash = excluded.token_hash,
      ativo = 1,
      expires_at = excluded.expires_at,
      requests_day = NULL,
      requests_today = 0,
      updated_at = excluded.updated_at`,
  ).run(crypto.randomUUID(), userId, tokenHash, expiresAt, now, now);

  const baseUrl = requestOrigin || loadEnv().urls.sgaApp;
  return {
    token: rawToken,
    expiresAt,
    url: `${baseUrl.replace(/\/+$/, '')}/inscricao/${rawToken}`,
  };
}

export function deactivateApplicationLink(userId: string) {
  const db = getDb();
  db.prepare('UPDATE candidate_application_links SET ativo = 0, updated_at = ? WHERE id_usuario = ?').run(
    new Date().toISOString(),
    userId,
  );
  return { success: true };
}

export function getPublicApplicationMeta(rawToken: string) {
  const token = typeof rawToken === 'string' ? rawToken.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new PublicError('Este link de inscrição é inválido ou expirou.', 404);
  }

  const nowIso = new Date().toISOString();
  const row = getDb()
    .prepare(
      `SELECT u.empresa_nome, u.segmento, u.segmento_config_json
       FROM candidate_application_links l
       JOIN usuarios u ON u.id = l.id_usuario
       WHERE l.token_hash = ? AND l.ativo = 1 AND l.expires_at > ?`,
    )
    .get(sha256Hex(token), nowIso) as
    | { empresa_nome: string | null; segmento: string | null; segmento_config_json: string | null }
    | undefined;

  if (!row) {
    throw new PublicError('Este link de inscrição é inválido ou expirou.', 404);
  }

  return {
    valid: true,
    empresa_nome: row.empresa_nome ? String(row.empresa_nome) : null,
    segmento: normalizeSegmentId(row.segmento),
    segmento_config: normalizeSegmentConfig(row.segmento_config_json),
  };
}

export function submitPublicCandidateApplication(body: JsonRecord, contentLength = 0) {
  if (contentLength > 16000) {
    throw new PublicError('Inscrição muito grande.', 413);
  }

  const token = typeof body.token === 'string' ? body.token.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new PublicError('Este link de inscrição é inválido ou expirou.', 404);
  }

  const form =
    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? (body.answers as JsonRecord)
      : null;
  if (!form) {
    throw new PublicError('Preencha os dados da inscrição.', 400);
  }

  if (typeof body.website === 'string' && body.website.trim()) {
    return { success: true };
  }

  const startedAt = Number(body.startedAt);
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 2500 || elapsed > 4 * 60 * 60 * 1000) {
    throw new PublicError('Aguarde um instante e envie a inscrição novamente.', 400);
  }

  if (body.privacyNoticeRead !== true) {
    throw new PublicError('Leia e confirme o aviso de privacidade para continuar.', 400);
  }

  const nome = typeof form.nome === 'string' ? form.nome.trim().replace(/\s+/g, ' ') : '';
  const cpf = typeof form.cpf === 'string' ? form.cpf.replace(/\D/g, '') : '';
  const telefone = typeof form.telefone === 'string' ? form.telefone.replace(/\D/g, '') : '';
  const email = typeof form.email === 'string' ? form.email.trim().toLowerCase() : '';

  if (nome.length < 3 || nome.length > 120) {
    throw new PublicError('Informe seu nome completo.', 400);
  }
  if (!validCpf(cpf)) {
    throw new PublicError('Informe um CPF válido.', 400);
  }
  if (telefone.length < 10 || telefone.length > 13) {
    throw new PublicError('Informe um telefone com DDD válido.', 400);
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PublicError('Informe um e-mail válido.', 400);
  }

  const idadeFaixa =
    typeof form.idade_faixa === 'string' && form.idade_faixa.length <= 32 ? form.idade_faixa.trim() || null : null;
  const caucao =
    typeof form.caucao_disponivel === 'string' && form.caucao_disponivel.length <= 120
      ? form.caucao_disponivel.trim() || null
      : null;
  const extrasJson = serializeExtrasJson(form.respostas_extras);

  const tokenHash = sha256Hex(token);
  const nowIso = new Date().toISOString();
  const todayUtc = nowIso.slice(0, 10);
  const db = getDb();

  db.exec('BEGIN IMMEDIATE');
  try {
    const link = db
      .prepare(
        `SELECT id, id_usuario FROM candidate_application_links
         WHERE token_hash = ? AND ativo = 1 AND expires_at > ?`,
      )
      .get(tokenHash, nowIso) as { id: string; id_usuario: string } | undefined;

    if (!link) {
      throw new PublicError('Este link de inscrição é inválido ou expirou.', 404);
    }

    const quotaUpdate = db
      .prepare(
        `UPDATE candidate_application_links
         SET requests_day = ?,
             requests_today = CASE WHEN requests_day IS NOT ? THEN 1 ELSE requests_today + 1 END,
             updated_at = ?
         WHERE id = ?
           AND ativo = 1
           AND expires_at > ?
           AND (requests_day IS NOT ? OR requests_today < ?)`,
      )
      .run(todayUtc, todayUtc, nowIso, link.id, nowIso, todayUtc, DAILY_QUOTA_LIMIT);

    if (quotaUpdate.changes === 0) {
      throw new PublicError(
        'Este link atingiu o limite diário de inscrições. Tente novamente amanhã ou fale com o responsável.',
        429,
      );
    }

    const duplicate = db
      .prepare('SELECT id FROM candidatos WHERE id_usuario = ? AND cpf = ?')
      .get(link.id_usuario, cpf);
    if (duplicate) {
      throw new PublicError('Já recebemos uma inscrição com este CPF para esta oportunidade.', 409);
    }

    const candidateId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO candidatos (
        id, id_usuario, id_link_inscricao, nome, cpf, telefone, email, idade_faixa,
        tem_220v, trabalha_em_app, caucao_disponivel, possui_processos_criminais, respostas_extras_json,
        status, aviso_privacidade_versao, aviso_privacidade_lido_em, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Em análise', ?, ?, ?, ?)`,
    ).run(
      candidateId,
      link.id_usuario,
      link.id,
      nome,
      cpf,
      telefone,
      email,
      idadeFaixa,
      jsBoolToSql(form.tem_220v),
      jsBoolToSql(form.trabalha_em_app),
      caucao,
      jsBoolToSql(form.possui_processos_criminais),
      extrasJson,
      PRIVACY_NOTICE_VERSION,
      nowIso,
      nowIso,
      nowIso,
    );

    db.prepare(
      `INSERT INTO candidato_reserva_auditoria (
        id, id_candidato, id_usuario, operador_id, acao, origem,
        status_anterior, status_novo, pagamento_status_anterior, pagamento_status_novo, motivo
      ) VALUES (?, ?, ?, NULL, 'inscricao_recebida', 'sistema', NULL, 'Em análise', NULL, NULL, ?)`,
    ).run(crypto.randomUUID(), candidateId, link.id_usuario, 'Inscrição pública recebida pelo link do locador.');

    db.exec('COMMIT');
    return { success: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
