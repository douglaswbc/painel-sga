/**
 * Meta operational alerts and the e-mail notification that follows them.
 *
 * Every actionable error returned by the WhatsApp Cloud API is classified in
 * one of the alert types below. The alert is persisted per landlord, shown in
 * the SGA banner and, at most once every 24 hours, sent to the landlord's
 * account e-mail through their own Resend account.
 */

import { MetaApiError, sanitizeProviderMessage } from './meta-graph.ts';
import { decryptSecret } from './crypto.ts';
import { sendResendEmail } from './resend.ts';

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
  /** Absolute URL or a path relative to the SGA public URL. */
  actionUrl: string;
  /** Column in email_notificacoes_config that enables this alert. */
  preference: string;
};

export const META_ALERT_DEFINITIONS: Record<MetaAlertType, MetaAlertDefinition> = {
  pagamento: {
    type: 'pagamento',
    severity: 'critical',
    blocking: true,
    title: 'Pagamento da Meta pendente',
    description: 'A Meta recusou o envio por problema no método de pagamento da conta WhatsApp Business. Regularize para retomar os envios.',
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
    description: 'A Meta restringiu ou bloqueou a conta WhatsApp Business. Confira a saúde da conta no WhatsApp Manager.',
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
    description: 'A Meta não aceitou mais o token de acesso. Gere um novo token e salve em Configurações.',
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
    description: 'A Meta recusou a operação por falta de permissão no token. Confira as permissões whatsapp_business_management e whatsapp_business_messaging.',
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
    description: 'A Meta recusou ou pausou um template usado pelo SGA. Revise o template em Mensagens.',
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
    description: 'A Meta limitou temporariamente o volume de mensagens. Aguarde e confira a qualidade do número no WhatsApp Manager.',
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
    description: 'A Meta recusou o envio porque o número ou a conta ainda precisa de um ajuste de configuração.',
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

export type MetaAlertClassification = {
  type: MetaAlertType;
  severity: MetaAlertSeverity;
  code: number | null;
  detail: string;
};

function classification(type: MetaAlertType, code: number | null, detail: string): MetaAlertClassification {
  return {
    type,
    severity: META_ALERT_DEFINITIONS[type].severity,
    code,
    detail: detail.slice(0, 300),
  };
}

/**
 * Classifies a synchronous Cloud API error. Generic validation errors are
 * intentionally ignored: they are shown in the interface and do not need an
 * e-mail. Only actionable errors become alerts.
 */
export function classifyMetaError(error: unknown): MetaAlertClassification | null {
  if (!(error instanceof MetaApiError)) return null;
  const code = error.code;
  const detail = sanitizeProviderMessage(error.userMessage || error.message) || 'Falha informada pela Meta.';

  if (code === 131042) return classification('pagamento', code, detail);
  if (code === 131044 || code === 368 || code === 131031 || code === 130497) {
    return classification('conta_bloqueada', code, detail);
  }
  if (error.status === 401 || code === 190 || code === 102) {
    return classification('token_invalido', code, detail);
  }
  if (error.status === 403 || code === 3 || code === 10 || code === 131005) {
    return classification('permissao', code, detail);
  }
  if ([132001, 132007, 132012, 132015, 132016, 2388019].includes(Number(code))) {
    return classification('template', code, detail);
  }
  if ([130429, 131048, 131049, 131050, 131056, 131064].includes(Number(code))) {
    return classification('limite_envio', code, detail);
  }
  if ([131037, 131045, 131057, 133010].includes(Number(code))) {
    return classification('integracao', code, detail);
  }
  if (error.status === 429) return classification('limite_envio', code, detail);
  return null;
}

/** Builds a MetaApiError from the error object delivered by a webhook status. */
export function classifyMetaWebhookError(status: number, payload: Record<string, any> | null | undefined): MetaAlertClassification | null {
  if (!payload) return null;
  const code = typeof payload.code === 'number' ? payload.code : null;
  const message = String(payload.message ?? payload.title ?? 'Falha na entrega informada pela Meta.');
  const userMessage = typeof payload.error_data?.details === 'string'
    ? payload.error_data.details
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

export type MetaAlertRow = Record<string, any>;

/** Returns the active alerts of one landlord, highest severity first. */
export async function activeMetaAlerts(admin: any, ownerId: string): Promise<MetaAlertRow[]> {
  const { data, error } = await admin.from('meta_alertas')
    .select('*')
    .eq('id_usuario', ownerId)
    .eq('status', 'ativo');
  if (error) throw error;
  return (data ?? []).sort((left: MetaAlertRow, right: MetaAlertRow) =>
    (SEVERITY_ORDER[left.severidade as MetaAlertSeverity] ?? 9) - (SEVERITY_ORDER[right.severidade as MetaAlertSeverity] ?? 9));
}

/** Public projection consumed by the browser. */
export function publicMetaAlert(row: MetaAlertRow): Record<string, any> | null {
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
    primeiraOcorrencia: row.primeira_ocorrencia,
    ultimaOcorrencia: row.ultima_ocorrencia,
    ultimaNotificacaoAt: row.ultima_notificacao_at,
  };
}

export function publicMetaAlerts(rows: MetaAlertRow[]): Record<string, any>[] {
  return rows.map(publicMetaAlert).filter((row): row is Record<string, any> => Boolean(row));
}

/**
 * Creates or refreshes the active alert of a type. Reopening a resolved alert
 * resets its notification window so the landlord is warned about the new
 * incident immediately.
 */
export async function recordMetaAlert(
  admin: any,
  ownerId: string,
  meta: MetaAlertClassification,
): Promise<MetaAlertRow | null> {
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await admin.from('meta_alertas')
    .select('id,status,ocorrencias')
    .eq('id_usuario', ownerId)
    .eq('tipo', meta.type)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const reactivated = existing.status !== 'ativo';
    const patch: Record<string, any> = {
      status: 'ativo',
      severidade: meta.severity,
      codigo: meta.code,
      detalhe: meta.detail,
      ultima_ocorrencia: now,
      updated_at: now,
      ocorrencias: reactivated ? 1 : Number(existing.ocorrencias ?? 0) + 1,
    };
    if (reactivated) {
      patch.primeira_ocorrencia = now;
      patch.resolvido_at = null;
      patch.ultima_notificacao_at = null;
    }
    const { data } = await admin.from('meta_alertas')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    return data ?? null;
  }

  const { data, error } = await admin.from('meta_alertas')
    .insert({
      id_usuario: ownerId,
      tipo: meta.type,
      severidade: meta.severity,
      status: 'ativo',
      codigo: meta.code,
      detalhe: meta.detail,
      ocorrencias: 1,
      primeira_ocorrencia: now,
      ultima_ocorrencia: now,
      updated_at: now,
    })
    .select('*')
    .maybeSingle();
  if (!error) return data ?? null;
  if (error.code !== '23505') throw error;

  // Another worker inserted the same alert between the read and the insert.
  const { data: raced } = await admin.from('meta_alertas')
    .update({
      status: 'ativo',
      severidade: meta.severity,
      codigo: meta.code,
      detalhe: meta.detail,
      ultima_ocorrencia: now,
      updated_at: now,
    })
    .eq('id_usuario', ownerId)
    .eq('tipo', meta.type)
    .select('*')
    .maybeSingle();
  return raced ?? null;
}

/** Marks the active alerts as resolved. */
export async function resolveMetaAlerts(admin: any, ownerId: string, types?: MetaAlertType[]): Promise<void> {
  const now = new Date().toISOString();
  let query = admin.from('meta_alertas')
    .update({ status: 'resolvido', resolvido_at: now, updated_at: now, ultima_notificacao_at: null })
    .eq('id_usuario', ownerId)
    .eq('status', 'ativo');
  if (types?.length) query = query.in('tipo', types);
  const { error } = await query;
  if (error) throw error;
}

/** Owners with at least one active blocking alert. */
export async function blockingAlertOwners(admin: any, ownerIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(ownerIds.filter((id) => typeof id === 'string' && id))];
  if (!unique.length) return new Set();
  const { data, error } = await admin.from('meta_alertas')
    .select('id_usuario')
    .in('id_usuario', unique)
    .eq('status', 'ativo')
    .in('tipo', BLOCKING_ALERT_TYPES);
  if (error) throw error;
  return new Set((data ?? []).map((row: MetaAlertRow) => row.id_usuario));
}

/** The type of alert can be disabled per landlord in the Resend settings. */
function alertEnabled(config: MetaAlertRow | null, type: MetaAlertType): boolean {
  if (!config?.enabled) return false;
  const preference = META_ALERT_DEFINITIONS[type].preference;
  return config[preference] !== false;
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

function formatDateTime(value: string): string {
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
  const occurredAt = formatDateTime(input.occurredAt);
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
  ].filter((line) => line !== null).join('\n');

  return { subject: definition.subject, html, text };
}

/**
 * Sends the alert e-mail when the landlord has Resend configured, the alert
 * type is enabled and the 24-hour window has passed. Failures never propagate:
 * the alert remains visible in the panel and the next send can retry.
 */
export async function notifyMetaAlert(
  admin: any,
  ownerId: string,
  meta: MetaAlertClassification,
  alert: MetaAlertRow | null,
  occurredAt = new Date().toISOString(),
): Promise<{ sent: boolean; reason?: string }> {
  if (!alert || alert.status !== 'ativo') return { sent: false, reason: 'inactive' };

  const lastNotification = alert.ultima_notificacao_at ? new Date(alert.ultima_notificacao_at).getTime() : 0;
  if (lastNotification && Date.now() - lastNotification < 24 * 60 * 60 * 1000) {
    return { sent: false, reason: 'deduplicated' };
  }

  const { data: owner } = await admin.from('usuarios')
    .select('email,nome_completo,empresa_nome')
    .eq('id', ownerId)
    .maybeSingle();
  if (!owner?.email) return { sent: false, reason: 'missing_email' };

  const { data: config } = await admin.from('email_notificacoes_config')
    .select('*')
    .eq('id_usuario', ownerId)
    .maybeSingle();
  if (!config || !alertEnabled(config, meta.type)) return { sent: false, reason: 'disabled' };
  if (!config.api_key_ciphertext || !config.from_email) return { sent: false, reason: 'not_configured' };

  let apiKey: string;
  try {
    apiKey = await decryptSecret(config.api_key_ciphertext, ownerId);
  } catch {
    await admin.from('email_notificacoes_config').update({
      key_status: 'invalid',
      last_error: 'Não foi possível descriptografar a API Key do Resend. Salve a chave novamente.',
      updated_at: new Date().toISOString(),
    }).eq('id_usuario', ownerId);
    return { sent: false, reason: 'decrypt_failed' };
  }

  const { data: integration } = await admin.from('zernio_integracoes')
    .select('meta_display_phone_number,whatsapp_phone_number')
    .eq('id_usuario', ownerId)
    .maybeSingle();

  const email = buildMetaAlertEmail({
    type: meta.type,
    ownerName: owner.nome_completo,
    companyName: owner.empresa_nome,
    phoneNumber: integration?.meta_display_phone_number ?? integration?.whatsapp_phone_number ?? null,
    detail: meta.detail,
    code: meta.code,
    occurredAt,
    appUrl: Deno.env.get('SGA_APP_URL') ?? Deno.env.get('SGA_PUBLIC_URL') ?? Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '',
  });

  const day = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  try {
    await sendResendEmail({
      apiKey,
      from: config.from_email,
      fromName: config.from_name,
      to: owner.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `sga-meta-alert-${ownerId}-${meta.type}-${day}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Falha ao enviar e-mail pelo Resend.';
    const keyInvalid = /\b401\b|api key/i.test(message);
    await admin.from('email_notificacoes_config').update({
      last_error: message,
      ...(keyInvalid ? { key_status: 'invalid' } : {}),
      updated_at: now,
    }).eq('id_usuario', ownerId);
    console.error('Meta alert e-mail failed:', message);
    return { sent: false, reason: 'send_failed' };
  }

  await admin.from('meta_alertas')
    .update({ ultima_notificacao_at: now, updated_at: now })
    .eq('id', alert.id);
  await admin.from('email_notificacoes_config').update({
    last_sent_at: now,
    last_error: null,
    key_status: 'valid',
    updated_at: now,
  }).eq('id_usuario', ownerId);

  return { sent: true };
}

/** Records the alert and tries the e-mail without breaking the caller. */
export async function recordAndNotifyMetaAlert(
  admin: any,
  ownerId: string,
  meta: MetaAlertClassification,
  occurredAt = new Date().toISOString(),
): Promise<void> {
  try {
    const alert = await recordMetaAlert(admin, ownerId, meta);
    await notifyMetaAlert(admin, ownerId, meta, alert, occurredAt);
  } catch (error) {
    console.error('Could not record or notify Meta alert:', error instanceof Error ? error.message : error);
  }
}
