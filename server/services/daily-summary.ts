import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { decryptSecret } from '../utils/crypto.js';
import { sendResendEmail } from './resend.js';

export const META_BR_RATES_BRL: Record<string, number> = {
  MARKETING: 0.3217,
  UTILITY: 0.035,
  AUTHENTICATION: 0.035,
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade (Utility)',
  AUTHENTICATION: 'Autenticação',
  UNKNOWN: 'Outra / Não identificada',
};

const MAX_LISTED_ITEMS = 25;

export type ChargeRecord = {
  id: string;
  valor: number | string;
  status: string;
  tipo?: string | null;
  categoria?: string | null;
  data_pagamento?: string | null;
  locatarios?: { nome_completo?: string | null } | Array<{ nome_completo?: string | null }> | null;
};

export type ActivityLogRecord = {
  status?: string | null;
  category?: string | null;
  recipient_phone?: string | null;
};

export type ChargeSummaryItem = {
  id: string;
  tenantName: string;
  category: string;
  value: number;
  status: string;
  paidAt: string | null;
};

export type WhatsappBreakdownItem = {
  category: string;
  categoryLabel: string;
  country: string;
  volume: number;
  cost: number;
};

export type DailySummaryData = {
  referenceDate: string;
  referenceDateLabel: string;
  expectedTotal: number;
  paid: {
    count: number;
    total: number;
    items: ChargeSummaryItem[];
  };
  pending: {
    count: number;
    total: number;
    items: ChargeSummaryItem[];
  };
  whatsapp: {
    totalSent: number;
    totalCostBrl: number;
    hasUnpricedForeign: boolean;
    byCategory: WhatsappBreakdownItem[];
  };
};

export type BrtYesterdayRange = {
  referenceDate: string;
  todayDate: string;
  startIso: string;
  endIso: string;
};

export function getYesterdayBrtRange(now = new Date()): BrtYesterdayRange {
  const todayDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const todayNoonUtc = new Date(`${todayDate}T12:00:00Z`);
  const yesterdayDate = new Date(todayNoonUtc.getTime() - 86_400_000).toISOString().slice(0, 10);

  return {
    referenceDate: yesterdayDate,
    todayDate,
    startIso: new Date(`${yesterdayDate}T00:00:00-03:00`).toISOString(),
    endIso: new Date(`${todayDate}T00:00:00-03:00`).toISOString(),
  };
}

export function formatDateBr(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatCurrencyBrl(value: number, maxFractionDigits = 2): string {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tenantNameFrom(row: ChargeRecord): string {
  const rel = Array.isArray(row.locatarios) ? row.locatarios[0] : row.locatarios;
  return String(rel?.nome_completo ?? '').trim() || 'Locatário sem identificação';
}

function categoryLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'Aluguel';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function summarizeDailyData(
  referenceDate: string,
  chargeRows: ChargeRecord[],
  activityRows: ActivityLogRecord[],
): DailySummaryData {
  const paidItems: ChargeSummaryItem[] = [];
  const pendingItems: ChargeSummaryItem[] = [];

  for (const row of chargeRows) {
    if (row.tipo === 'despesa' || row.status === 'cancelado') continue;
    const item: ChargeSummaryItem = {
      id: row.id,
      tenantName: tenantNameFrom(row),
      category: categoryLabel(row.categoria),
      value: Number(row.valor || 0),
      status: String(row.status || 'pendente'),
      paidAt: row.data_pagamento ?? null,
    };

    if (item.status === 'pago') {
      paidItems.push(item);
    } else if (item.status === 'pendente' || item.status === 'atrasado') {
      pendingItems.push(item);
    }
  }

  paidItems.sort((a, b) => b.value - a.value || a.tenantName.localeCompare(b.tenantName, 'pt-BR'));
  pendingItems.sort((a, b) => b.value - a.value || a.tenantName.localeCompare(b.tenantName, 'pt-BR'));

  const paidTotal = paidItems.reduce((sum, item) => sum + item.value, 0);
  const pendingTotal = pendingItems.reduce((sum, item) => sum + item.value, 0);

  const grouped = new Map<string, WhatsappBreakdownItem>();
  let totalSent = 0;
  let totalCostBrl = 0;
  let hasUnpricedForeign = false;

  for (const row of activityRows) {
    if (row.status !== 'sent') continue;
    totalSent += 1;

    const digits = String(row.recipient_phone || '').replace(/\D/g, '');
    const country = digits.startsWith('55') || digits.length === 10 || digits.length === 11 ? 'BR' : 'UNKNOWN';
    const rawCat = String(row.category || '').toUpperCase();
    const category = Object.hasOwn(META_BR_RATES_BRL, rawCat) ? rawCat : 'UNKNOWN';

    const key = `${category}:${country}`;
    const current = grouped.get(key) || {
      category,
      categoryLabel: CATEGORY_LABELS[category] ?? category,
      country,
      volume: 0,
      cost: 0,
    };
    current.volume += 1;

    if (country === 'BR' && META_BR_RATES_BRL[category]) {
      current.cost += META_BR_RATES_BRL[category];
      totalCostBrl += META_BR_RATES_BRL[category];
    } else if (country !== 'BR') {
      hasUnpricedForeign = true;
    }

    grouped.set(key, current);
  }

  const byCategory = [...grouped.values()].sort((a, b) => b.cost - a.cost || b.volume - a.volume);

  return {
    referenceDate,
    referenceDateLabel: formatDateBr(referenceDate),
    expectedTotal: paidTotal + pendingTotal,
    paid: {
      count: paidItems.length,
      total: paidTotal,
      items: paidItems,
    },
    pending: {
      count: pendingItems.length,
      total: pendingTotal,
      items: pendingItems,
    },
    whatsapp: {
      totalSent,
      totalCostBrl,
      hasUnpricedForeign,
      byCategory,
    },
  };
}

export type DailySummaryEmailInput = {
  ownerName?: string | null;
  companyName?: string | null;
  summary: DailySummaryData;
  appUrl?: string | null;
};

function renderChargesSectionHtml(
  title: string,
  accentColor: string,
  badgeBg: string,
  items: ChargeSummaryItem[],
  emptyText: string,
): string {
  const visible = items.slice(0, MAX_LISTED_ITEMS);
  const remaining = items.length - visible.length;

  const rowsHtml = visible.length
    ? visible
        .map(
          (item) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #ececef;font-size:13px;color:#1d1d1f;">
          <strong>${escapeHtml(item.tenantName)}</strong>
          <div style="font-size:11px;color:#6e6e73;">${escapeHtml(item.category)}${item.status === 'atrasado' ? ' · <span style="color:#b91c1c;">Em atraso</span>' : ''}</div>
        </td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid #ececef;font-size:13px;font-weight:600;color:#1d1d1f;white-space:nowrap;">
          ${escapeHtml(formatCurrencyBrl(item.value))}
        </td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="2" style="padding:12px 10px;font-size:13px;color:#6e6e73;">${escapeHtml(emptyText)}</td></tr>`;

  const moreRow =
    remaining > 0
      ? `<tr><td colspan="2" style="padding:8px 10px;font-size:12px;color:#6e6e73;">… e mais ${remaining} cobrança(s) no painel.</td></tr>`
      : '';

  return `
    <div style="margin:0 0 18px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${accentColor};">
        <span style="display:inline-block;background:${badgeBg};padding:3px 10px;border-radius:999px;">${escapeHtml(title)} (${items.length})</span>
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e5ea;border-radius:12px;border-collapse:separate;overflow:hidden;background:#ffffff;">
        ${rowsHtml}
        ${moreRow}
      </table>
    </div>`;
}

export function buildDailySummaryEmail(input: DailySummaryEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { summary } = input;
  const firstName = String(input.ownerName ?? '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Olá, ${firstName}.` : 'Olá.';
  const company = String(input.companyName ?? '').trim();
  const baseUrl = String(input.appUrl ?? '').replace(/\/$/, '');
  const chargesUrl = baseUrl ? `${baseUrl}/cobrancas` : '';
  const messagesUrl = baseUrl ? `${baseUrl}/mensagens` : '';

  const subject = `Resumo diário SGA (${summary.referenceDateLabel}): ${formatCurrencyBrl(summary.paid.total)} pagos · ${formatCurrencyBrl(summary.pending.total)} pendentes`;

  const whatsappRowsHtml = summary.whatsapp.byCategory.length
    ? summary.whatsapp.byCategory
        .map(
          (row) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #ececef;font-size:13px;color:#1d1d1f;">
          ${escapeHtml(row.categoryLabel)}
          <span style="font-size:11px;color:#6e6e73;">(${row.country === 'BR' ? 'Brasil' : 'Outro país'})</span>
        </td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid #ececef;font-size:13px;color:#333333;white-space:nowrap;">
          ${row.volume}
        </td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid #ececef;font-size:13px;font-weight:600;color:#1d1d1f;white-space:nowrap;">
          ${row.country === 'BR' ? escapeHtml(formatCurrencyBrl(row.cost, 4)) : '—'}
        </td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" style="padding:12px 10px;font-size:13px;color:#6e6e73;">Nenhum template aceito foi enviado ontem.</td></tr>`;

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e0e0e0;border-radius:18px;padding:28px;">
            <tr><td>
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a7a7a;">
                Painel SGA · Resumo diário${company ? ` · ${escapeHtml(company)}` : ''}
              </p>
              <h1 style="margin:0 0 12px;font-size:21px;line-height:1.25;color:#1d1d1f;">
                Movimento de ${escapeHtml(summary.referenceDateLabel)}
              </h1>
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#333333;">
                ${escapeHtml(greeting)} Confira abaixo o fechamento das cobranças com vencimento ontem e a estimativa de custo dos templates WhatsApp enviados no dia.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                <tr>
                  <td width="32%" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:12px;vertical-align:top;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#065f46;">Pagas</div>
                    <div style="margin-top:4px;font-size:18px;font-weight:700;color:#047857;">${escapeHtml(formatCurrencyBrl(summary.paid.total))}</div>
                    <div style="margin-top:2px;font-size:11px;color:#065f46;">${summary.paid.count} cobrança(s)</div>
                  </td>
                  <td width="2%"></td>
                  <td width="32%" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px;vertical-align:top;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#92400e;">Pendentes</div>
                    <div style="margin-top:4px;font-size:18px;font-weight:700;color:#b45309;">${escapeHtml(formatCurrencyBrl(summary.pending.total))}</div>
                    <div style="margin-top:2px;font-size:11px;color:#92400e;">${summary.pending.count} cobrança(s)</div>
                  </td>
                  <td width="2%"></td>
                  <td width="32%" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:12px;vertical-align:top;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#3730a3;">WhatsApp (est.)</div>
                    <div style="margin-top:4px;font-size:18px;font-weight:700;color:#4338ca;">${escapeHtml(formatCurrencyBrl(summary.whatsapp.totalCostBrl, 4))}</div>
                    <div style="margin-top:2px;font-size:11px;color:#3730a3;">${summary.whatsapp.totalSent} template(s)</div>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-size:15px;color:#1d1d1f;border-bottom:1px solid #ececef;padding-bottom:6px;">
                Cobranças com vencimento em ${escapeHtml(summary.referenceDateLabel)}
              </h2>
              ${renderChargesSectionHtml(
                'Pagas',
                '#047857',
                '#ecfdf5',
                summary.paid.items,
                'Nenhuma cobrança com vencimento ontem foi paga até o momento.',
              )}
              ${renderChargesSectionHtml(
                'Pendentes / Em atraso',
                '#b45309',
                '#fffbeb',
                summary.pending.items,
                'Nenhuma cobrança com vencimento ontem ficou pendente.',
              )}

              <h2 style="margin:22px 0 10px;font-size:15px;color:#1d1d1f;border-bottom:1px solid #ececef;padding-bottom:6px;">
                Custo estimado de templates WhatsApp (${escapeHtml(summary.referenceDateLabel)})
              </h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e5ea;border-radius:12px;border-collapse:separate;overflow:hidden;background:#ffffff;margin:0 0 10px;">
                <thead>
                  <tr style="background:#f5f5f7;">
                    <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Categoria</th>
                    <th align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Envios</th>
                    <th align="right" style="padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Custo aprox.</th>
                  </tr>
                </thead>
                <tbody>
                  ${whatsappRowsHtml}
                </tbody>
              </table>
              <p style="margin:0 0 20px;font-size:11px;line-height:1.5;color:#6e6e73;">
                Estimativa baseada nos envios aceitos registrados no SGA em ${escapeHtml(summary.referenceDateLabel)} e nas tarifas Meta Brasil (Utilidade/Autenticação R$ 0,035; Marketing R$ 0,3217). A cobrança real na fatura da Meta pode variar.${summary.whatsapp.hasUnpricedForeign ? ' Envios para números fora do Brasil aparecem apenas no volume.' : ''}
              </p>

              ${
                chargesUrl || messagesUrl
                  ? `
              <p style="margin:0 0 18px;">
                ${chargesUrl ? `<a href="${escapeHtml(chargesUrl)}" style="display:inline-block;background:#0066cc;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:11px 18px;border-radius:999px;margin-right:8px;">Ver cobranças</a>` : ''}
                ${messagesUrl ? `<a href="${escapeHtml(messagesUrl)}" style="display:inline-block;background:#f5f5f7;color:#1d1d1f;border:1px solid #d2d2d7;text-decoration:none;font-weight:600;font-size:13px;padding:11px 18px;border-radius:999px;">Custos e operação</a>` : ''}
              </p>`
                  : ''
              }

              <p style="margin:18px 0 0;font-size:11px;line-height:1.5;color:#7a7a7a;">
                Você recebeu este e-mail automático às 08h00 porque ativou o Resumo Diário em Configurações &gt; Notificações.
              </p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const formatTextList = (items: ChargeSummaryItem[], emptyText: string) => {
    if (!items.length) return `  - ${emptyText}`;
    const lines = items.slice(0, MAX_LISTED_ITEMS).map(
      (item) =>
        `  - ${item.tenantName} (${item.category}): ${formatCurrencyBrl(item.value)}${item.status === 'atrasado' ? ' [Em atraso]' : ''}`,
    );
    if (items.length > MAX_LISTED_ITEMS) {
      lines.push(`  ... e mais ${items.length - MAX_LISTED_ITEMS} cobrança(s) no painel.`);
    }
    return lines.join('\n');
  };

  const whatsappTextLines = summary.whatsapp.byCategory.length
    ? summary.whatsapp.byCategory.map(
        (row) =>
          `  - ${row.categoryLabel} (${row.country === 'BR' ? 'Brasil' : 'Outro país'}): ${row.volume} envio(s) · ${row.country === 'BR' ? formatCurrencyBrl(row.cost, 4) : '—'}`,
      )
    : ['  - Nenhum template aceito foi enviado ontem.'];

  const text = [
    `Painel SGA · Resumo diário (${summary.referenceDateLabel})`,
    company ? `Empresa: ${company}` : '',
    '',
    greeting,
    `Fechamento das cobranças com vencimento em ${summary.referenceDateLabel}:`,
    `- Pagas: ${summary.paid.count} (${formatCurrencyBrl(summary.paid.total)})`,
    `- Pendentes/Atrasadas: ${summary.pending.count} (${formatCurrencyBrl(summary.pending.total)})`,
    `- Templates WhatsApp aceitos: ${summary.whatsapp.totalSent} · Custo estimado: ${formatCurrencyBrl(summary.whatsapp.totalCostBrl, 4)}`,
    '',
    'COBRANÇAS PAGAS:',
    formatTextList(summary.paid.items, 'Nenhuma cobrança com vencimento ontem foi paga até o momento.'),
    '',
    'COBRANÇAS PENDENTES / EM ATRASO:',
    formatTextList(summary.pending.items, 'Nenhuma cobrança com vencimento ontem ficou pendente.'),
    '',
    'CUSTO ESTIMADO WHATSAPP:',
    ...whatsappTextLines,
    '',
    chargesUrl ? `Ver cobranças: ${chargesUrl}` : '',
    messagesUrl ? `Custos e operação: ${messagesUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

export type DispatchDailySummaryOptions = {
  manual?: boolean;
  now?: Date;
};

export type DispatchDailySummaryResult = {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  summary?: DailySummaryData;
  messageId?: string | null;
};

export async function dispatchDailySummaryForOwner(
  owner: { id: string; email: string; nome_completo?: string | null; empresa_nome?: string | null },
  config: Record<string, any>,
  options: DispatchDailySummaryOptions = {},
): Promise<DispatchDailySummaryResult> {
  if (!config?.api_key_ciphertext || !config?.from_email) {
    return { sent: false, skipped: true, reason: 'not_configured' };
  }

  const now = options.now ?? new Date();
  const range = getYesterdayBrtRange(now);

  if (!options.manual && config.last_daily_summary_date === range.referenceDate) {
    return { sent: false, skipped: true, reason: 'already_sent_for_date' };
  }

  const db = getDb();
  let apiKey: string;
  try {
    apiKey = decryptSecret(String(config.api_key_ciphertext), owner.id);
  } catch {
    db.prepare(
      `UPDATE email_notificacoes_config
       SET key_status = 'invalid', last_error = ?, updated_at = ?
       WHERE id_usuario = ?`,
    ).run(
      'Não foi possível descriptografar a API Key do Resend. Salve a chave novamente.',
      now.toISOString(),
      owner.id,
    );
    return { sent: false, reason: 'decrypt_failed' };
  }

  const rawCharges = db
    .prepare(
      `SELECT c.id, c.valor, c.status, c.tipo, c.categoria, c.data_pagamento,
              l.nome_completo AS locatario_nome
       FROM cobrancas c
       LEFT JOIN locatarios l ON l.id = c.id_locatario AND l.id_usuario = c.id_usuario
       WHERE c.id_usuario = ? AND c.data_vencimento = ?`,
    )
    .all(owner.id, range.referenceDate) as Array<{
    id: string;
    valor: number;
    status: string;
    tipo: string | null;
    categoria: string | null;
    data_pagamento: string | null;
    locatario_nome: string | null;
  }>;

  const chargeRows: ChargeRecord[] = rawCharges.map((r) => ({
    id: r.id,
    valor: r.valor,
    status: r.status,
    tipo: r.tipo,
    categoria: r.categoria,
    data_pagamento: r.data_pagamento,
    locatarios: r.locatario_nome ? { nome_completo: r.locatario_nome } : null,
  }));

  const activityRows = db
    .prepare(
      `SELECT status, category, recipient_phone
       FROM zernio_whatsapp_activity_log
       WHERE id_usuario = ? AND status = 'sent' AND occurred_at >= ? AND occurred_at < ?`,
    )
    .all(owner.id, range.startIso, range.endIso) as ActivityLogRecord[];

  const summary = summarizeDailyData(range.referenceDate, chargeRows, activityRows);
  const appUrl = loadEnv().urls.sgaApp;

  const email = buildDailySummaryEmail({
    ownerName: owner.nome_completo,
    companyName: owner.empresa_nome,
    summary,
    appUrl,
  });

  const sentAt = new Date().toISOString();
  const idempotencyKey = options.manual
    ? `sga-daily-summary-manual-${owner.id}-${Date.now()}`
    : `sga-daily-summary-${owner.id}-${range.referenceDate}`;

  try {
    const res = await sendResendEmail({
      apiKey,
      from: String(config.from_email),
      fromName: config.from_name ? String(config.from_name) : null,
      to: owner.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey,
    });

    if (!options.manual) {
      db.prepare(
        `UPDATE email_notificacoes_config
         SET last_sent_at = ?,
             last_daily_summary_sent_at = ?,
             last_daily_summary_date = ?,
             last_error = NULL,
             key_status = 'valid',
             updated_at = ?
         WHERE id_usuario = ?`,
      ).run(sentAt, sentAt, range.referenceDate, sentAt, owner.id);
    } else {
      db.prepare(
        `UPDATE email_notificacoes_config
         SET last_sent_at = ?,
             last_daily_summary_sent_at = ?,
             last_error = NULL,
             key_status = 'valid',
             updated_at = ?
         WHERE id_usuario = ?`,
      ).run(sentAt, sentAt, sentAt, owner.id);
    }

    return { sent: true, summary, messageId: res.id };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Falha ao enviar resumo diário pelo Resend.';
    const keyInvalid = /\b401\b|api key/i.test(message);
    db.prepare(
      `UPDATE email_notificacoes_config
       SET last_error = ?,
           key_status = CASE WHEN ? = 1 THEN 'invalid' ELSE key_status END,
           updated_at = ?
       WHERE id_usuario = ?`,
    ).run(message, keyInvalid ? 1 : 0, sentAt, owner.id);
    throw new Error(message);
  }
}

export type DailySummaryCronResult = {
  referenceDate: string;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  results: Array<{ ownerId: string; status: 'sent' | 'skipped' | 'failed'; reason?: string }>;
};

export async function runDailySummaryCron(now = new Date()): Promise<DailySummaryCronResult> {
  const db = getDb();
  const range = getYesterdayBrtRange(now);

  const configs = db
    .prepare(
      `SELECT c.*, u.email AS owner_email, u.nome_completo AS owner_nome_completo,
              u.empresa_nome AS owner_empresa_nome, u.role AS owner_role, u.ativo AS owner_ativo
       FROM email_notificacoes_config c
       JOIN usuarios u ON u.id = c.id_usuario
       WHERE c.enabled = 1
         AND c.notificar_resumo_diario = 1
         AND c.api_key_ciphertext IS NOT NULL
         AND c.from_email IS NOT NULL`,
    )
    .all() as Array<Record<string, any>>;

  const results: DailySummaryCronResult['results'] = [];

  for (const row of configs) {
    const ownerId = String(row.id_usuario);
    if (row.owner_role !== 'locador' || Number(row.owner_ativo) !== 1 || !row.owner_email) {
      results.push({ ownerId, status: 'skipped', reason: 'inactive_or_missing_email' });
      continue;
    }

    try {
      const result = await dispatchDailySummaryForOwner(
        {
          id: ownerId,
          email: String(row.owner_email),
          nome_completo: row.owner_nome_completo ?? null,
          empresa_nome: row.owner_empresa_nome ?? null,
        },
        row,
        { manual: false, now },
      );

      if (result.sent) {
        results.push({ ownerId, status: 'sent' });
      } else if (result.skipped) {
        results.push({ ownerId, status: 'skipped', reason: result.reason });
      } else {
        results.push({ ownerId, status: 'failed', reason: result.reason });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[resumo-diario] Falha para locador ${ownerId}:`, message);
      results.push({ ownerId, status: 'failed', reason: message });
    }
  }

  return {
    referenceDate: range.referenceDate,
    processed: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}
