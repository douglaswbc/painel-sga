import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { decryptSecret } from '../utils/crypto.js';
import { MetaApiError, sanitizeProviderMessage } from './meta-graph.js';
import { sendResendEmail } from './resend.js';

export type MetaAlertType =
  | 'pagamento'
  | 'conta_bloqueada'
  | 'token_invalido'
  | 'permissao'
  | 'template'
  | 'limite_envio'
  | 'integracao';

export type MetaAlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export type MetaAlertDefinition = {
  type: MetaAlertType;
  severity: MetaAlertSeverity;
  blocking: boolean;
  title: string;
  description: string;
  subject: string;
  actionLabel: string;
  actionUrl: string;
  preference: string;
};

export const ALLOWED_META_ALERT_TYPES: MetaAlertType[] = [
  'pagamento',
  'conta_bloqueada',
  'token_invalido',
  'permissao',
  'template',
  'limite_envio',
  'integracao',
];

export const META_ALERT_DEFINITIONS: Record<MetaAlertType, MetaAlertDefinition> = {
  pagamento: {
    type: 'pagamento',
    severity: 'critical',
    blocking: true,
    title: 'Pagamento da Meta pendente',
    description:
      'A Meta recusou o envio por problema no método de pagamento da conta WhatsApp Business. Regularize para retomar os envios.',
    subject: 'Ação necessária: pagamento da Meta pendente — envios de WhatsApp pausados',
    actionLabel: 'Abrir cobrança da Meta',
    actionUrl: 'https://business.facebook.com/billing_hub/accounts',
    preference: 'notificar_pagamento',
  },
  conta_bloqueada: {
    type: 'conta_bloqueada',
    severity: 'critical',
    blocking: true,
    title: 'Conta WhatsApp Business bloqueada',
    description:
      'A Meta restringiu ou bloqueou a conta WhatsApp Business. Confira a saúde da conta no WhatsApp Manager.',
    subject: 'Ação necessária: conta WhatsApp Business bloqueada ou restrita',
    actionLabel: 'Abrir WhatsApp Manager',
    actionUrl: 'https://business.facebook.com/wa/manage/phone-numbers/',
    preference: 'notificar_conta_bloqueada',
  },
  token_invalido: {
    type: 'token_invalido',
    severity: 'critical',
    blocking: true,
    title: 'Token da Meta inválido ou expirado',
    description:
      'A Meta não aceitou mais o token de acesso. Gere um novo token e salve em Configurações.',
    subject: 'Ação necessária: token da Meta expirou ou foi invalidado',
    actionLabel: 'Reconectar a Meta',
    actionUrl: '/configuracoes',
    preference: 'notificar_token_invalido',
  },
  permissao: {
    type: 'permissao',
    severity: 'error',
    blocking: false,
    title: 'Permissão da Meta recusada',
    description:
      'A Meta recusou a operação por falta de permissão no token. Confira as permissões whatsapp_business_management e whatsapp_business_messaging.',
    subject: 'Atenção: permissão da Meta recusada no SGA',
    actionLabel: 'Revisar integração',
    actionUrl: '/configuracoes',
    preference: 'notificar_permissao',
  },
  template: {
    type: 'template',
    severity: 'warning',
    blocking: false,
    title: 'Template do WhatsApp com problema',
    description:
      'A Meta recusou ou pausou um template usado pelo SGA. Revise o template em Mensagens.',
    subject: 'Atenção: template do WhatsApp precisa de revisão',
    actionLabel: 'Abrir templates',
    actionUrl: '/mensagens',
    preference: 'notificar_template',
  },
  limite_envio: {
    type: 'limite_envio',
    severity: 'warning',
    blocking: false,
    title: 'Limite de envio de mensagens atingido',
    description:
      'A Meta limitou temporariamente o volume de mensagens. Aguarde e confira a qualidade do número no WhatsApp Manager.',
    subject: 'Atenção: limite de envio de mensagens da Meta atingido',
    actionLabel: 'Abrir WhatsApp Manager',
    actionUrl: 'https://business.facebook.com/wa/manage/phone-numbers/',
    preference: 'notificar_limite_envio',
  },
  integracao: {
    type: 'integracao',
    severity: 'warning',
    blocking: false,
    title: 'Número do WhatsApp precisa de configuração',
    description:
      'A Meta recusou o envio porque o número ou a conta ainda precisa de um ajuste de configuração.',
    subject: 'Atenção: número do WhatsApp precisa de configuração na Meta',
    actionLabel: 'Revisar integração',
    actionUrl: '/configuracoes',
    preference: 'notificar_integracao',
  },
};

export const BLOCKING_ALERT_TYPES: MetaAlertType[] = [
  'pagamento',
  'conta_bloqueada',
  'token_invalido',
];

const SEVERITY_ORDER: Record<MetaAlertSeverity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export type MetaAlertRow = {
  id: string;
  id_usuario: string;
  tipo: MetaAlertType;
  severidade: MetaAlertSeverity;
  status: string;
  codigo: number | null;
  detalhe: string | null;
  ocorrencias: number;
  primeira_ocorrencia: string;
  ultima_ocorrencia: string;
  ultima_notificacao_at: string | null;
  resolvido_at: string | null;
};

export type MetaAlertClassification = {
  type: MetaAlertType;
  severity: MetaAlertSeverity;
  code: number | null;
  detail: string;
};

export function activeMetaAlerts(ownerId: string): MetaAlertRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM meta_alertas WHERE id_usuario = ? AND status = 'ativo'`,
    )
    .all(ownerId) as MetaAlertRow[];

  return rows.sort(
    (left, right) =>
      (SEVERITY_ORDER[left.severidade] ?? 9) - (SEVERITY_ORDER[right.severidade] ?? 9),
  );
}

export function publicMetaAlert(
  row: Omit<Partial<MetaAlertRow>, 'tipo' | 'severidade'> & { id: string; tipo: string; severidade: string },
): Record<string, unknown> | null {
  const definition = META_ALERT_DEFINITIONS[row.tipo as MetaAlertType];
  if (!definition) return null;
  return {
    id: row.id,
    tipo: row.tipo,
    severidade: row.severidade,
    titulo: definition.title,
    descricao: definition.description,
    acaoLabel: definition.actionLabel,
    acaoUrl: definition.actionUrl,
    bloqueante: definition.blocking,
    codigo: row.codigo ?? null,
    detalhe: row.detalhe ?? null,
    ocorrencias: Number(row.ocorrencias ?? 1),
    primeiraOcorrencia: row.primeira_ocorrencia ?? null,
    ultimaOcorrencia: row.ultima_ocorrencia ?? null,
    ultimaNotificacaoAt: row.ultima_notificacao_at ?? null,
  };
}

export function publicMetaAlerts(
  rows: Array<Omit<Partial<MetaAlertRow>, 'tipo' | 'severidade'> & { id: string; tipo: string; severidade: string }>,
): Record<string, unknown>[] {
  return rows
    .map((row) => publicMetaAlert(row))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

export function resolveMetaAlerts(ownerId: string, types?: MetaAlertType[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  if (types && types.length > 0) {
    const placeholders = types.map(() => '?').join(', ');
    db.prepare(
      `UPDATE meta_alertas
       SET status = 'resolvido', resolvido_at = ?, updated_at = ?, ultima_notificacao_at = NULL
       WHERE id_usuario = ? AND status = 'ativo' AND tipo IN (${placeholders})`,
    ).run(now, now, ownerId, ...types);
    return;
  }

  db.prepare(
    `UPDATE meta_alertas
     SET status = 'resolvido', resolvido_at = ?, updated_at = ?, ultima_notificacao_at = NULL
     WHERE id_usuario = ? AND status = 'ativo'`,
  ).run(now, now, ownerId);
}

export function recordMetaAlert(ownerId: string, meta: MetaAlertClassification): MetaAlertRow {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT id, status, ocorrencias FROM meta_alertas WHERE id_usuario = ? AND tipo = ?')
    .get(ownerId, meta.type) as { id: string; status: string; ocorrencias: number } | undefined;

  if (existing) {
    const reactivated = existing.status !== 'ativo';
    const ocorrencias = reactivated ? 1 : Number(existing.ocorrencias ?? 0) + 1;

    db.prepare(
      `UPDATE meta_alertas
       SET status = 'ativo',
           severidade = ?,
           codigo = ?,
           detalhe = ?,
           ultima_ocorrencia = ?,
           updated_at = ?,
           ocorrencias = ?,
           primeira_ocorrencia = CASE WHEN ? = 1 THEN ? ELSE primeira_ocorrencia END,
           resolvido_at = CASE WHEN ? = 1 THEN NULL ELSE resolvido_at END,
           ultima_notificacao_at = CASE WHEN ? = 1 THEN NULL ELSE ultima_notificacao_at END
       WHERE id = ?`,
    ).run(
      meta.severity,
      meta.code,
      meta.detail,
      now,
      now,
      ocorrencias,
      reactivated ? 1 : 0,
      now,
      reactivated ? 1 : 0,
      reactivated ? 1 : 0,
      existing.id,
    );

    return db.prepare('SELECT * FROM meta_alertas WHERE id = ?').get(existing.id) as MetaAlertRow;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO meta_alertas (
      id, id_usuario, tipo, severidade, status, codigo, detalhe, ocorrencias,
      primeira_ocorrencia, ultima_ocorrencia, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'ativo', ?, ?, 1, ?, ?, ?, ?)`,
  ).run(id, ownerId, meta.type, meta.severity, meta.code, meta.detail, now, now, now, now);

  return db.prepare('SELECT * FROM meta_alertas WHERE id = ?').get(id) as MetaAlertRow;
}

export function blockingAlertOwners(ownerIds: string[]): Set<string> {
  const unique = [...new Set(ownerIds.filter((id) => typeof id === 'string' && id))];
  if (!unique.length) return new Set();

  const db = getDb();
  const ownerPlaceholders = unique.map(() => '?').join(', ');
  const typePlaceholders = BLOCKING_ALERT_TYPES.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT DISTINCT id_usuario FROM meta_alertas
       WHERE id_usuario IN (${ownerPlaceholders})
         AND status = 'ativo'
         AND tipo IN (${typePlaceholders})`,
    )
    .all(...unique, ...BLOCKING_ALERT_TYPES) as Array<{ id_usuario: string }>;

  return new Set(rows.map((r) => r.id_usuario));
}

function makeClassification(type: MetaAlertType, code: number | null, detail: string): MetaAlertClassification {
  return {
    type,
    severity: META_ALERT_DEFINITIONS[type].severity,
    code,
    detail: detail.slice(0, 300),
  };
}

export function classifyMetaError(error: unknown): MetaAlertClassification | null {
  if (!(error instanceof MetaApiError)) return null;
  const code = error.code;
  const detail = sanitizeProviderMessage(error.userMessage || error.message) || 'Falha informada pela Meta.';

  if (code === 131042) return makeClassification('pagamento', code, detail);
  if (code === 131044 || code === 368 || code === 131031 || code === 130497) {
    return makeClassification('conta_bloqueada', code, detail);
  }
  if (error.status === 401 || code === 190 || code === 102) {
    return makeClassification('token_invalido', code, detail);
  }
  if (error.status === 403 || code === 3 || code === 10 || code === 131005) {
    return makeClassification('permissao', code, detail);
  }
  if ([132001, 132007, 132012, 132015, 132016, 2388019].includes(Number(code))) {
    return makeClassification('template', code, detail);
  }
  if ([130429, 131048, 131049, 131050, 131056, 131064].includes(Number(code))) {
    return makeClassification('limite_envio', code, detail);
  }
  if ([131037, 131045, 131057, 133010].includes(Number(code))) {
    return makeClassification('integracao', code, detail);
  }
  if (error.status === 429) return makeClassification('limite_envio', code, detail);
  return null;
}

export function classifyMetaWebhookError(
  status: number,
  payload: Record<string, unknown> | null | undefined,
): MetaAlertClassification | null {
  if (!payload) return null;
  const code = typeof payload.code === 'number' ? payload.code : null;
  const message = String(payload.message ?? payload.title ?? 'Falha na entrega informada pela Meta.');
  const errorData = payload.error_data as Record<string, unknown> | undefined;
  const userMessage =
    typeof errorData?.details === 'string'
      ? errorData.details
      : typeof payload.message === 'string'
        ? payload.message
        : null;
  const error = new MetaApiError(
    status || (code ? 400 : 500),
    message,
    code,
    null,
    typeof payload.type === 'string' ? payload.type : null,
    userMessage,
  );
  return classifyMetaError(error);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(appUrl: string, value: string): string {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (!appUrl) return '';
  return `${appUrl.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
}

function formatDateTimeBrt(value: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export type MetaAlertEmailInput = {
  type: MetaAlertType;
  ownerName?: string | null;
  companyName?: string | null;
  phoneNumber?: string | null;
  detail?: string | null;
  code?: number | null;
  occurredAt: string;
  appUrl?: string | null;
};

export function buildMetaAlertEmail(input: MetaAlertEmailInput): { subject: string; html: string; text: string } {
  const definition = META_ALERT_DEFINITIONS[input.type];
  const firstName = String(input.ownerName ?? '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Olá, ${firstName}.` : 'Olá.';
  const company = String(input.companyName ?? '').trim();
  const phone = String(input.phoneNumber ?? '').trim();
  const occurredAt = formatDateTimeBrt(input.occurredAt);
  const detail = String(input.detail ?? '').trim();
  const code = input.code ? `Código ${input.code}` : '';
  const link = absoluteUrl(String(input.appUrl ?? ''), definition.actionUrl);

  const rows = [
    company ? `Empresa: ${escapeHtml(company)}` : '',
    phone ? `Número conectado: ${escapeHtml(phone)}` : '',
    `Quando: ${escapeHtml(occurredAt)}`,
    code ? `Erro: ${escapeHtml(code)}` : '',
    detail ? `Detalhe da Meta: ${escapeHtml(detail)}` : '',
  ].filter(Boolean);

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e0e0;border-radius:18px;padding:28px;">
            <tr><td>
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a7a7a;">Painel SGA · Aviso da Meta</p>
              <h1 style="margin:0 0 14px;font-size:21px;line-height:1.25;color:#1d1d1f;">${escapeHtml(definition.title)}</h1>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#333333;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#333333;">${escapeHtml(definition.description)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafc;border:1px solid #e0e0e0;border-radius:12px;padding:14px;margin:0 0 18px;">
                <tr><td style="font-size:13px;line-height:1.7;color:#4b4b4d;">${rows.map((row) => `<div>${row}</div>`).join('')}</td></tr>
              </table>
              ${link ? `<p style="margin:0 0 18px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0066cc;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:999px;">${escapeHtml(definition.actionLabel)}</a></p>` : ''}
              <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#333333;">Depois de regularizar, volte ao SGA e clique em <strong>Já regularizei</strong> no aviso exibido no painel. Os lembretes automáticos são retomados assim que a Meta voltar a aceitar os envios.</p>
              <p style="margin:18px 0 0;font-size:11px;line-height:1.5;color:#7a7a7a;">Você recebeu este e-mail porque ativou as notificações por e-mail em Configurações &gt; Notificações. Para desativar, ajuste as preferências nessa tela.</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    'Painel SGA · Aviso da Meta',
    '',
    definition.title,
    '',
    greeting,
    definition.description,
    '',
    ...rows.map((row) => row.replace(/<[^>]+>/g, '')),
    '',
    link ? `${definition.actionLabel}: ${link}` : '',
    '',
    'Depois de regularizar, volte ao SGA e clique em "Já regularizei" no aviso exibido no painel.',
    'Você recebeu este e-mail porque ativou as notificações por e-mail em Configurações > Notificações.',
  ].join('\n');

  return { subject: definition.subject, html, text };
}

export async function notifyMetaAlert(
  ownerId: string,
  meta: MetaAlertClassification,
  alert: MetaAlertRow,
  occurredAt = new Date().toISOString(),
): Promise<{ sent: boolean; reason?: string }> {
  const db = getDb();
  const definition = META_ALERT_DEFINITIONS[meta.type];
  if (!definition) return { sent: false, reason: 'unknown_type' };

  if (alert.ultima_notificacao_at) {
    const last = new Date(alert.ultima_notificacao_at).getTime();
    if (Number.isFinite(last) && Date.now() - last < 24 * 60 * 60 * 1000) {
      return { sent: false, reason: 'throttled' };
    }
  }

  const owner = db
    .prepare('SELECT email, nome_completo, empresa_nome FROM usuarios WHERE id = ?')
    .get(ownerId) as { email?: string; nome_completo?: string; empresa_nome?: string } | undefined;
  if (!owner?.email) return { sent: false, reason: 'missing_email' };

  const config = db
    .prepare('SELECT * FROM email_notificacoes_config WHERE id_usuario = ?')
    .get(ownerId) as Record<string, unknown> | undefined;

  if (!config || Number(config.enabled) !== 1 || Number(config[definition.preference] ?? 1) === 0) {
    return { sent: false, reason: 'disabled' };
  }
  if (!config.api_key_ciphertext || !config.from_email) {
    return { sent: false, reason: 'not_configured' };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(String(config.api_key_ciphertext), ownerId);
  } catch {
    db.prepare(
      `UPDATE email_notificacoes_config
       SET key_status = 'invalid', last_error = ?, updated_at = ?
       WHERE id_usuario = ?`,
    ).run(
      'Não foi possível descriptografar a API Key do Resend. Salve a chave novamente.',
      new Date().toISOString(),
      ownerId,
    );
    return { sent: false, reason: 'decrypt_failed' };
  }

  const integration = db
    .prepare('SELECT meta_display_phone_number FROM zernio_integracoes WHERE id_usuario = ?')
    .get(ownerId) as { meta_display_phone_number?: string | null } | undefined;

  const email = buildMetaAlertEmail({
    type: meta.type,
    ownerName: owner.nome_completo ?? null,
    companyName: owner.empresa_nome ?? null,
    phoneNumber: integration?.meta_display_phone_number ?? null,
    detail: meta.detail,
    code: meta.code,
    occurredAt,
    appUrl: loadEnv().urls.sgaApp,
  });

  const day = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  try {
    await sendResendEmail({
      apiKey,
      from: String(config.from_email),
      fromName: config.from_name ? String(config.from_name) : null,
      to: owner.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `sga-meta-alert-${ownerId}-${meta.type}-${day}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Falha ao enviar e-mail pelo Resend.';
    const keyInvalid = /\b401\b|api key/i.test(message);
    db.prepare(
      `UPDATE email_notificacoes_config
       SET last_error = ?, key_status = CASE WHEN ? = 1 THEN 'invalid' ELSE key_status END, updated_at = ?
       WHERE id_usuario = ?`,
    ).run(message, keyInvalid ? 1 : 0, now, ownerId);
    return { sent: false, reason: 'send_failed' };
  }

  db.prepare('UPDATE meta_alertas SET ultima_notificacao_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    alert.id,
  );
  db.prepare(
    `UPDATE email_notificacoes_config
     SET last_sent_at = ?, last_error = NULL, key_status = 'valid', updated_at = ?
     WHERE id_usuario = ?`,
  ).run(now, now, ownerId);

  void occurredAt;
  return { sent: true };
}

export async function recordAndNotifyMetaAlert(
  ownerId: string,
  meta: MetaAlertClassification,
  occurredAt = new Date().toISOString(),
): Promise<void> {
  try {
    const alert = recordMetaAlert(ownerId, meta);
    await notifyMetaAlert(ownerId, meta, alert, occurredAt);
  } catch (error) {
    console.error('[meta-alerts] Falha ao registrar/notificar alerta:', error instanceof Error ? error.message : error);
  }
}
