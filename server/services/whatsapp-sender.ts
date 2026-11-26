import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { decryptSecret } from '../utils/crypto.js';
import { dueDatePtBr } from './billing-helpers.js';
import {
  classifyMetaError,
  recordAndNotifyMetaAlert,
  resolveMetaAlerts,
} from './meta-alerts.js';
import {
  MetaApiError,
  describeMetaError,
  listMessageTemplates,
  metaErrorDetail,
} from './meta-graph.js';
import { sendMetaTemplateMessage } from './meta-messages.js';
import { getUserMpToken } from './secrets.js';

export const ZERNIO_API = 'https://zernio.com/api/v1';
export type WhatsappProvider = 'zernio' | 'meta';
type JsonRecord = Record<string, any>;

export class PublicError extends Error {
  status: number;
  extra?: Record<string, unknown>;

  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export class ZernioError extends Error {
  status: number;
  code: string | null;
  param: string | null;
  providerMessage: string | null;

  constructor(status: number, code: string | null = null, param: string | null = null, providerMessage: string | null = null) {
    super('Zernio request failed');
    this.status = status;
    this.code = code;
    this.param = param;
    this.providerMessage = providerMessage;
  }
}

export type Channel = {
  provider: WhatsappProvider;
  accountId: string;
  wabaId: string | null;
  token: string;
  label: string;
  phoneNumber: string | null;
};

const TEMPLATE_STATUSES = new Set([
  'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL',
  'PENDING_DELETION', 'PENDING_DEPRECATION', 'LIMIT_EXCEEDED', 'DEPRECATED',
  'ARCHIVED', 'DELETED', 'EXPIRED',
]);

export function normalizeProvider(value: unknown): WhatsappProvider {
  return value === 'meta' ? 'meta' : 'zernio';
}

export function publicChannel(channel: Channel) {
  return {
    provider: channel.provider,
    providerLabel: channel.provider === 'meta' ? 'Meta Cloud API' : 'Zernio',
    accountId: channel.accountId,
    phoneNumber: channel.phoneNumber,
    label: channel.label,
  };
}

export function phoneForWhatsApp(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) throw new PublicError('O locatário não possui WhatsApp válido cadastrado.', 409);
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function safeProviderMessage(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .trim()
    .replace(/Bearer\s+\S+/gi, 'Bearer [ocultado]')
    .replace(/\b(?:zrk|sk)_[A-Za-z0-9_-]{8,}/gi, '[chave ocultada]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 400);
}

export async function zernioRequest(
  path: string,
  apiKey: string,
  options: { method?: string; body?: JsonRecord; idempotencyKey?: string } = {},
): Promise<JsonRecord> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new PublicError('Não foi possível conectar à Zernio agora. Tente novamente.', 503);
  }

  let payload: JsonRecord = {};
  try {
    payload = await response.json();
  } catch {
    // Algumas respostas 204/200 vêm sem corpo
  }

  if (!response.ok) {
    const rawCode = payload?.code ?? payload?.error?.code;
    const code = typeof rawCode === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : null;
    const rawParam = payload?.param;
    const param = typeof rawParam === 'string' && /^[A-Za-z0-9_.[\]-]{1,100}$/.test(rawParam) ? rawParam : null;
    const platformError = payload?.platformError;
    const providerMessage = safeProviderMessage(
      platformError?.error_user_msg ??
        platformError?.error_user_title ??
        platformError?.error?.message ??
        platformError?.error?.error_user_msg ??
        platformError?.details?.[0]?.message ??
        payload?.details?.errors?.[0]?.message ??
        platformError?.message ??
        payload?.error,
    );
    throw new ZernioError(response.status, code, param, providerMessage);
  }
  return payload;
}

export function safeZernioError(error: ZernioError): PublicError {
  if (error.status === 401) {
    return new PublicError('A chave da Zernio está inválida ou expirada. Atualize em Configurações.', 401);
  }
  if (error.status === 429) {
    return new PublicError('A Zernio limitou temporariamente o ritmo de envios. Tente novamente em instantes.', 429);
  }
  return new PublicError(error.providerMessage || 'A Zernio recusou a operação no WhatsApp.', 400);
}

export function resolveChannel(ownerId: string): Channel {
  const db = getDb();
  const integration = db
    .prepare('SELECT * FROM zernio_integracoes WHERE id_usuario = ?')
    .get(ownerId) as Record<string, any> | undefined;

  const provider = normalizeProvider(integration?.provider);
  if (provider === 'meta') {
    if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id || !integration?.meta_waba_id) {
      throw new PublicError('Conecte um número oficial da Meta em Configurações antes de usar o WhatsApp.', 409);
    }
    if (integration.meta_status === 'invalid') {
      throw new PublicError('A credencial da Meta precisa ser revalidada em Configurações.', 409);
    }
    const token = decryptSecret(String(integration.meta_access_token_ciphertext), ownerId);
    const phone = integration.meta_display_phone_number ? String(integration.meta_display_phone_number) : null;
    const name = integration.meta_verified_name ? String(integration.meta_verified_name) : null;
    return {
      provider: 'meta',
      accountId: String(integration.meta_phone_number_id),
      wabaId: String(integration.meta_waba_id),
      token,
      phoneNumber: phone,
      label: name || phone || 'Meta Cloud API',
    };
  }

  if (!integration?.api_key_ciphertext || integration?.key_status !== 'valid' || !integration?.whatsapp_account_id) {
    throw new PublicError('Conecte um canal WhatsApp pela Zernio em Configurações antes de usar os templates.', 409);
  }
  const token = decryptSecret(String(integration.api_key_ciphertext), ownerId);
  const phone = integration.whatsapp_phone_number ? String(integration.whatsapp_phone_number) : null;
  const name = integration.whatsapp_account_name ? String(integration.whatsapp_account_name) : null;
  return {
    provider: 'zernio',
    accountId: String(integration.whatsapp_account_id),
    wabaId: null,
    token,
    phoneNumber: phone,
    label: name || phone || 'Zernio',
  };
}

export function templateParameterCount(components: JsonRecord[] = []): number {
  const ordered = [
    ...components.filter((component) => String(component.type).toUpperCase() === 'HEADER'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BODY'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BUTTONS'),
  ];
  let count = 0;
  for (const component of ordered) {
    const texts =
      String(component.type).toUpperCase() === 'BUTTONS'
        ? (Array.isArray(component.buttons) ? component.buttons : []).map((button: JsonRecord) => button.url)
        : [component.text];
    for (const text of texts) {
      const variables = [
        ...new Set([...String(text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]))),
      ].sort((a, b) => a - b);
      if (variables.some((value, index) => value !== index + 1)) return -1;
      count += variables.length;
    }
  }
  return count;
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function syncChannelTemplates(channel: Channel, ownerId: string): Promise<JsonRecord[]> {
  const db = getDb();
  let remoteTemplates: JsonRecord[] = [];

  if (channel.provider === 'meta') {
    const templates = await listMessageTemplates(channel.wabaId as string, channel.token);
    remoteTemplates = templates.map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components,
      rejected_reason: t.rejectionReason,
    }));
  } else {
    const query = new URLSearchParams({ accountId: channel.accountId });
    const payload = await zernioRequest(`/whatsapp/templates?${query.toString()}`, channel.token);
    remoteTemplates = Array.isArray(payload?.templates)
      ? payload.templates
      : Array.isArray(payload?.data?.templates)
        ? payload.data.templates
        : [];
  }

  const existingRows = db
    .prepare('SELECT * FROM zernio_whatsapp_templates WHERE id_usuario = ? AND provider = ? AND account_id = ?')
    .all(ownerId, channel.provider, channel.accountId) as JsonRecord[];

  const now = new Date().toISOString();
  const upsertStmt = db.prepare(`
    INSERT INTO zernio_whatsapp_templates (
      id, id_usuario, provider, account_id, meta_template_id, name, language, category, status,
      rejection_reason, components, variable_mapping, purpose, is_default, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id_usuario, provider, account_id, name, language) DO UPDATE SET
      meta_template_id = excluded.meta_template_id,
      category = excluded.category,
      status = excluded.status,
      rejection_reason = excluded.rejection_reason,
      components = excluded.components,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `);

  for (const tmpl of remoteTemplates) {
    const remoteId = tmpl.id ?? tmpl._id;
    if (typeof remoteId !== 'string' || !tmpl.name || !tmpl.language) continue;
    const existing = existingRows.find((r) => r.name === tmpl.name && r.language === tmpl.language);
    const statusUpper = String(tmpl.status ?? 'PENDING').toUpperCase();
    const status = TEMPLATE_STATUSES.has(statusUpper) ? statusUpper : 'PENDING';
    const catUpper = String(tmpl.category ?? 'UTILITY').toUpperCase();
    const category = ['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(catUpper) ? catUpper : 'UTILITY';
    const rejectionReason = tmpl.reason ?? tmpl.rejected_reason ?? tmpl.rejectionReason ?? null;
    const componentsJson = JSON.stringify(Array.isArray(tmpl.components) ? tmpl.components : []);
    const mappingJson = existing?.variable_mapping ? String(existing.variable_mapping) : '[]';

    try {
      upsertStmt.run(
        existing?.id ?? crypto.randomUUID(),
        ownerId,
        channel.provider,
        channel.accountId,
        remoteId,
        String(tmpl.name),
        String(tmpl.language),
        category,
        status,
        rejectionReason ? String(rejectionReason) : null,
        componentsJson,
        mappingJson,
        existing?.purpose ?? 'general',
        existing?.is_default ? 1 : 0,
        now,
        existing?.created_at ?? now,
        now,
      );
    } catch (err) {
      console.error('[whatsapp] Erro ao sincronizar template:', tmpl.name, err);
    }
  }

  if (channel.provider === 'meta' && remoteTemplates.length > 0) {
    const remoteKeys = new Set(remoteTemplates.map((t) => `${t.name}\u0000${t.language}`));
    const stale = existingRows.filter(
      (row) => !remoteKeys.has(`${row.name}\u0000${row.language}`) && String(row.status ?? '').toUpperCase() !== 'DELETED',
    );
    if (stale.length > 0) {
      const ids = stale.map((s) => String(s.id));
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(`DELETE FROM zernio_whatsapp_template_usages WHERE id_usuario = ? AND template_id IN (${placeholders})`).run(
        ownerId,
        ...ids,
      );
      db.prepare(`UPDATE zernio_whatsapp_templates SET status = 'DELETED', updated_at = ? WHERE id_usuario = ? AND id IN (${placeholders})`).run(
        now,
        ownerId,
        ...ids,
      );
    }
  }

  const rows = db
    .prepare(
      `SELECT id, meta_template_id, name, language, category, status, rejection_reason,
              components, variable_mapping, purpose, is_default, last_synced_at, provider
       FROM zernio_whatsapp_templates
       WHERE id_usuario = ? AND provider = ? AND account_id = ?
       ORDER BY name ASC, language ASC`,
    )
    .all(ownerId, channel.provider, channel.accountId) as JsonRecord[];

  const usages = db
    .prepare(
      `SELECT template_id, purpose, variable_mapping, is_default, reminder_order
       FROM zernio_whatsapp_template_usages
       WHERE id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .all(ownerId, channel.provider, channel.accountId) as JsonRecord[];

  return rows.map((row) => ({
    ...row,
    is_default: Number(row.is_default) === 1,
    components: parseJsonColumn(row.components, []),
    variable_mapping: parseJsonColumn(row.variable_mapping, []),
    usages: usages
      .filter((u) => u.template_id === row.id)
      .map((u) => ({
        ...u,
        is_default: Number(u.is_default) === 1,
        variable_mapping: parseJsonColumn(u.variable_mapping, []),
      })),
  }));
}

function billingTemplateParams(
  template: JsonRecord,
  mapping: JsonRecord[],
  tenantName: string,
  amount: number,
  dueDate: string,
  paymentLink: string,
  payToken: string,
): string[] {
  const values: Record<string, string> = {
    tenant_first_name: tenantName.trim().split(/\s+/)[0] || 'Olá',
    amount: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount),
    due_date: dueDatePtBr(dueDate),
    payment_link: paymentLink,
    payment_token: payToken,
  };

  const orderedMapping = [...mapping].sort((a, b) => a.position - b.position);
  const components = parseJsonColumn<JsonRecord[]>(template.components, []);
  const expectedCount = templateParameterCount(components);

  if (
    orderedMapping.length !== expectedCount ||
    orderedMapping.some((item, index) => item.position !== index + 1 || !Object.hasOwn(values, item.field))
  ) {
    throw new PublicError(
      'O mapeamento das variáveis deste template de cobrança está incompleto. Configure novamente na aba Templates Meta.',
      409,
    );
  }

  return orderedMapping.map((item) => {
    const value = values[item.field];
    if (item.field === 'payment_token' && !String(value ?? '').trim()) {
      throw new PublicError(
        'Não foi possível montar o botão de pagamento: esta cobrança está sem o código público do link.',
        409,
      );
    }
    return value;
  });
}

async function generateChargePixLink(ownerId: string, charge: JsonRecord, tenant: JsonRecord): Promise<string> {
  const token = getUserMpToken(ownerId);
  if (!token) {
    throw new PublicError('Cadastre um Access Token válido do Mercado Pago antes de gerar o link PIX.', 409);
  }

  const rawCpf = tenant.cpf_enc ? decryptSecret(String(tenant.cpf_enc), ownerId) : String(tenant.cpf ?? '');
  const document = rawCpf.replace(/\D/g, '');
  const names = String(tenant.nome_completo ?? '').trim().split(/\s+/);
  const payer: JsonRecord = {
    email: tenant.email || 'financeiro@sga.com',
    first_name: names[0] || 'Locatário',
    last_name: names.slice(1).join(' ') || names[0] || 'SGA',
  };
  if (document.length === 11 || document.length === 14) {
    payer.identification = { type: document.length === 14 ? 'CNPJ' : 'CPF', number: document };
  }

  const pixExpiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
  let response: Response;
  try {
    response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `sga-charge-${charge.id}`,
      },
      body: JSON.stringify({
        transaction_amount: Number(charge.valor),
        description: `Aluguel - ${tenant.nome_completo}`,
        payment_method_id: 'pix',
        date_of_expiration: pixExpiresAt.toISOString(),
        notification_url: loadEnv().urls.mpWebhook,
        payer,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new PublicError('Não foi possível conectar ao Mercado Pago para gerar o PIX.', 503);
  }

  const result = (await response.json().catch(() => ({}))) as JsonRecord;
  const paymentLink = result?.point_of_interaction?.transaction_data?.ticket_url;
  if (!response.ok || typeof paymentLink !== 'string' || !paymentLink) {
    throw new PublicError('O Mercado Pago não conseguiu gerar o link PIX. Confira a conta e os dados do locatário.', 502);
  }

  const db = getDb();
  db.prepare(
    `UPDATE cobrancas
     SET mercado_pago_id = ?, payment_link = ?, pix_expires_at = ?, pix_expired_at = NULL
     WHERE id = ? AND id_usuario = ?`,
  ).run(String(result.id), paymentLink, pixExpiresAt.toISOString(), charge.id, ownerId);

  return paymentLink;
}

export async function sendChargeReminder(
  ownerId: string,
  chargeId: string,
  options: { serviceCall?: boolean; reminderSequence?: number } = {},
) {
  const db = getDb();
  const channel = resolveChannel(ownerId);

  const charge = db
    .prepare(
      `SELECT id, id_usuario, id_locatario, id_contrato, valor, data_vencimento, status, tipo,
              payment_link, pay_token, mercado_pago_id, tentativas_envio, created_at,
              pix_expires_at, pix_expired_at, reminder_interval_minutes
       FROM cobrancas
       WHERE id = ? AND id_usuario = ?`,
    )
    .get(chargeId, ownerId) as JsonRecord | undefined;

  if (!charge) throw new PublicError('Cobrança não encontrada para este locador.', 404);
  if (!['pendente', 'atrasado'].includes(String(charge.status)) || charge.tipo === 'despesa') {
    throw new PublicError('Somente cobranças de receita pendentes ou atrasadas podem ser enviadas.', 409);
  }

  const storedPixExpiry =
    charge.pix_expires_at ||
    new Date(new Date(String(charge.created_at)).getTime() + 4 * 60 * 60 * 1000).toISOString();
  if (charge.pix_expired_at || new Date(String(storedPixExpiry)).getTime() <= Date.now()) {
    throw new PublicError('O PIX desta cobrança expirou. Gere um novo PIX antes de enviar outro lembrete.', 409);
  }
  if (!Number.isFinite(Number(charge.valor)) || Number(charge.valor) <= 0) {
    throw new PublicError('O valor desta cobrança precisa ser maior que zero.', 409);
  }

  if (charge.mercado_pago_id && charge.payment_link) {
    const mpToken = getUserMpToken(ownerId);
    if (mpToken) {
      try {
        const paymentResponse = await fetch(
          `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(charge.mercado_pago_id))}`,
          {
            headers: { Authorization: `Bearer ${mpToken}` },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (paymentResponse.ok) {
          const payment = (await paymentResponse.json()) as JsonRecord;
          if (payment.status === 'approved') {
            db.prepare(
              `UPDATE cobrancas SET status = 'pago', data_pagamento = ?, next_reminder_at = NULL
               WHERE id = ? AND id_usuario = ?`,
            ).run(new Date().toISOString(), charge.id, ownerId);
            throw new PublicError('O Mercado Pago já confirmou esta cobrança como paga.', 409);
          }
          if (!['pending', 'in_process'].includes(String(payment.status))) {
            throw new PublicError(
              'O pagamento PIX não está pendente no Mercado Pago. Atualize ou recrie a cobrança antes do envio.',
              409,
            );
          }
        }
      } catch (err) {
        if (err instanceof PublicError) throw err;
      }
    }
  }

  if (!charge.id_locatario) {
    throw new PublicError('Esta cobrança não tem locatário vinculado. Atualize o cadastro da cobrança.', 409);
  }

  const tenant = db
    .prepare('SELECT id, nome_completo, whatsapp, email, cpf, cpf_enc FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(charge.id_locatario, ownerId) as JsonRecord | undefined;
  if (!tenant || !tenant.whatsapp) {
    throw new PublicError('O locatário não possui WhatsApp válido cadastrado.', 409);
  }

  const requestedSequence =
    options.serviceCall && Number.isInteger(Number(options.reminderSequence)) && Number(options.reminderSequence) > 0
      ? Number(options.reminderSequence)
      : Number(charge.tentativas_envio || 0) + 1;

  const lastSent = db
    .prepare(
      `SELECT sequence_no FROM zernio_whatsapp_deliveries
       WHERE id_usuario = ? AND id_cobranca = ? AND status = 'sent'
       ORDER BY sequence_no DESC LIMIT 1`,
    )
    .get(ownerId, charge.id) as { sequence_no?: number } | undefined;

  const reminderSequence = Math.max(requestedSequence, Number(lastSent?.sequence_no || 0) + 1);

  const reminderUsages = db
    .prepare(
      `SELECT template_id, variable_mapping, reminder_order
       FROM zernio_whatsapp_template_usages
       WHERE id_usuario = ? AND provider = ? AND account_id = ? AND is_default = 1 AND purpose = 'charge'
       ORDER BY reminder_order ASC`,
    )
    .all(ownerId, channel.provider, channel.accountId) as JsonRecord[];

  if (!reminderUsages.length) {
    throw new PublicError(
      'Selecione um ou mais templates aprovados para lembretes na aba Templates Meta de /mensagens.',
      409,
    );
  }

  const selectedUsage = reminderUsages[(reminderSequence - 1) % reminderUsages.length];
  const selectedTemplate = db
    .prepare(
      `SELECT * FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .get(selectedUsage.template_id, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;

  if (!selectedTemplate) {
    throw new PublicError('O template padrão de cobrança não foi encontrado neste canal.', 409);
  }

  const liveTemplates = await syncChannelTemplates(channel, ownerId);
  const liveTemplate = liveTemplates.find(
    (item) => item.name === selectedTemplate.name && item.language === selectedTemplate.language,
  );
  if (!liveTemplate || liveTemplate.status !== 'APPROVED' || liveTemplate.meta_template_id !== selectedTemplate.meta_template_id) {
    throw new PublicError('O template padrão não está aprovado pela Meta. Atualize a lista e escolha um template APPROVED.', 409);
  }

  const paymentLink = charge.payment_link || (await generateChargePixLink(ownerId, charge, tenant));
  const pixExpiresAt = String(charge.pix_expires_at || storedPixExpiry);
  const participantId = phoneForWhatsApp(String(tenant.whatsapp));
  const mapping = parseJsonColumn<JsonRecord[]>(selectedUsage.variable_mapping, []);
  const params = billingTemplateParams(
    selectedTemplate,
    mapping,
    String(tenant.nome_completo),
    Number(charge.valor),
    String(charge.data_vencimento),
    String(paymentLink),
    String(charge.pay_token ?? ''),
  );

  const existing = db
    .prepare(
      `SELECT * FROM zernio_whatsapp_deliveries
       WHERE id_usuario = ? AND id_cobranca = ? AND sequence_no = ?`,
    )
    .get(ownerId, charge.id, reminderSequence) as JsonRecord | undefined;

  if (existing?.status === 'sent') {
    return { success: true, alreadySent: true, messageId: existing.message_id };
  }
  if (existing?.status === 'sending' && new Date(String(existing.updated_at)).getTime() > Date.now() - 120000) {
    throw new PublicError('O envio deste lembrete já está em processamento. Aguarde alguns instantes.', 409);
  }

  const deliveryId = existing?.id ? String(existing.id) : crypto.randomUUID();
  const idempotencyKey = existing?.idempotency_key
    ? String(existing.idempotency_key)
    : `sga-charge-${charge.id}-${reminderSequence}`;
  const nowIso = new Date().toISOString();

  if (existing) {
    const upd = db
      .prepare(
        `UPDATE zernio_whatsapp_deliveries
         SET status = 'sending', template_id = ?, account_id = ?, meta_template_id = ?,
             template_name = ?, template_language = ?, safe_error = NULL, error_code = NULL, updated_at = ?
         WHERE id = ? AND status = ?`,
      )
      .run(
        selectedTemplate.id,
        channel.accountId,
        selectedTemplate.meta_template_id,
        selectedTemplate.name,
        selectedTemplate.language,
        nowIso,
        deliveryId,
        existing.status,
      );
    if (upd.changes === 0) {
      throw new PublicError('O envio está sendo processado por outra solicitação. Aguarde e atualize a tela.', 409);
    }
  } else {
    try {
      db.prepare(
        `INSERT INTO zernio_whatsapp_deliveries (
          id, id_usuario, id_cobranca, template_id, account_id, provider,
          idempotency_key, sequence_no, status, meta_template_id, template_name, template_language
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)`,
      ).run(
        deliveryId,
        ownerId,
        charge.id,
        selectedTemplate.id,
        channel.accountId,
        channel.provider,
        idempotencyKey,
        reminderSequence,
        selectedTemplate.meta_template_id,
        selectedTemplate.name,
        selectedTemplate.language,
      );
    } catch {
      throw new PublicError('Não foi possível reservar este lembrete. Atualize e tente novamente.', 409);
    }
  }

  let messageId: string;
  let conversationId: string | null = null;
  try {
    if (channel.provider === 'meta') {
      const sent = await sendMetaTemplateMessage({
        phoneNumberId: channel.accountId,
        token: channel.token,
        to: participantId,
        templateName: String(selectedTemplate.name),
        templateLanguage: String(selectedTemplate.language),
        templateParams: params,
        components: parseJsonColumn(selectedTemplate.components, []),
      });
      messageId = sent.messageId;
      resolveMetaAlerts(ownerId);
    } else {
      const sendPayload = await zernioRequest('/inbox/conversations', channel.token, {
        method: 'POST',
        idempotencyKey,
        body: {
          accountId: channel.accountId,
          participantId,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language,
          templateParams: params,
        },
      });
      const sentData = sendPayload.data ?? sendPayload;
      const sentMessageId = sentData.messageId ?? sentData.message?.id;
      const sentConversationId = sentData.conversationId ?? sentData.conversation?.id;
      if (typeof sentMessageId !== 'string' || !sentMessageId) {
        throw new PublicError('A Zernio aceitou o envio, mas não retornou o identificador da mensagem.', 502);
      }
      messageId = sentMessageId;
      conversationId = typeof sentConversationId === 'string' ? sentConversationId : null;
    }
  } catch (error) {
    let safeMessage = error instanceof Error ? error.message.slice(0, 160) : 'send_failed';
    let code = 'send_failed';
    if (error instanceof ZernioError) {
      const safe = safeZernioError(error);
      safeMessage = safe.message;
      code = error.code || 'send_failed';
    } else if (error instanceof MetaApiError) {
      safeMessage = describeMetaError(error);
      const meta = classifyMetaError(error);
      if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
    }

    db.prepare(
      `UPDATE zernio_whatsapp_deliveries
       SET status = 'failed', error_code = ?, safe_error = ?, updated_at = ?
       WHERE id = ? AND status = 'sending'`,
    ).run(code, safeMessage, new Date().toISOString(), deliveryId);

    if (error instanceof MetaApiError) {
      throw new PublicError(safeMessage, error.status === 429 ? 429 : 400, {
        detail: metaErrorDetail(error) ?? undefined,
      });
    }
    if (error instanceof ZernioError) throw safeZernioError(error);
    throw error;
  }

  const sentAt = new Date().toISOString();
  db.prepare(
    `UPDATE zernio_whatsapp_deliveries
     SET status = 'sent', message_id = ?, conversation_id = ?, safe_error = NULL, error_code = NULL,
         sent_at = ?, updated_at = ?
     WHERE id = ? AND status = 'sending'`,
  ).run(messageId, conversationId, sentAt, sentAt, deliveryId);

  let nextReminderDate = new Date(new Date(sentAt).getTime() + Number(charge.reminder_interval_minutes || 30) * 60000);
  const colliding = db
    .prepare(
      `SELECT id, next_reminder_at FROM cobrancas
       WHERE id_usuario = ? AND id <> ? AND status IN ('pendente', 'atrasado') AND tipo <> 'despesa'
         AND next_reminder_at >= ? AND next_reminder_at <= ?
       LIMIT 1`,
    )
    .get(
      ownerId,
      charge.id,
      new Date(nextReminderDate.getTime() - 45000).toISOString(),
      new Date(nextReminderDate.getTime() + 45000).toISOString(),
    ) as { next_reminder_at?: string } | undefined;

  if (colliding?.next_reminder_at) {
    nextReminderDate = new Date(nextReminderDate.getTime() + 60000);
  }

  const nextReminder =
    nextReminderDate.getTime() < new Date(pixExpiresAt).getTime() ? nextReminderDate.toISOString() : null;

  db.prepare(
    `UPDATE cobrancas
     SET tentativas_envio = ?, ultimo_lembrete_at = ?, next_reminder_at = ?, pix_expires_at = ?
     WHERE id = ? AND id_usuario = ? AND status IN ('pendente', 'atrasado')`,
  ).run(reminderSequence, sentAt, nextReminder, pixExpiresAt, charge.id, ownerId);

  return {
    success: true,
    message: 'Link PIX enviado por um template aprovado da Meta.',
    messageId,
    paymentLink,
  };
}

export async function sendPaymentConfirmationByCharge(ownerId: string, chargeId: string) {
  const db = getDb();
  const channel = resolveChannel(ownerId);

  const charge = db
    .prepare(
      `SELECT id, id_usuario, id_locatario, valor, data_vencimento, data_pagamento, status, tipo
       FROM cobrancas WHERE id = ? AND id_usuario = ?`,
    )
    .get(chargeId, ownerId) as JsonRecord | undefined;
  if (!charge) throw new PublicError('Cobrança não encontrada para este locador.', 404);
  if (!charge.id_locatario) throw new PublicError('Esta cobrança não tem locatário vinculado.', 409);

  const tenant = db
    .prepare('SELECT id, nome_completo, whatsapp FROM locatarios WHERE id = ? AND id_usuario = ?')
    .get(charge.id_locatario, ownerId) as JsonRecord | undefined;
  if (!tenant || !tenant.whatsapp) {
    throw new PublicError('O locatário não possui WhatsApp válido cadastrado.', 409);
  }

  const usage = db
    .prepare(
      `SELECT template_id, variable_mapping
       FROM zernio_whatsapp_template_usages
       WHERE id_usuario = ? AND provider = ? AND account_id = ?
         AND purpose = 'payment_confirmation' AND is_default = 1`,
    )
    .get(ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;

  if (!usage) {
    throw new PublicError('Nenhum template de confirmação de pagamento está configurado para este canal.', 409, {
      needsTemplate: true,
      channel: publicChannel(channel),
    });
  }

  const template = db
    .prepare(
      `SELECT id, meta_template_id, name, language, status, components, account_id
       FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .get(usage.template_id, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;
  if (!template) throw new PublicError('O template de confirmação de pagamento não foi encontrado neste canal.', 404);
  if (template.status !== 'APPROVED') {
    throw new PublicError('O template de confirmação de pagamento não está aprovado pela Meta.', 409);
  }

  const paidAt = charge.data_pagamento || new Date().toISOString();
  const values: Record<string, string> = {
    tenant_first_name: String(tenant.nome_completo ?? '').trim().split(/\s+/)[0] || 'Olá',
    amount: Number(charge.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    paid_at: new Date(String(paidAt)).toLocaleDateString('pt-BR'),
  };

  const mapping = [...parseJsonColumn<JsonRecord[]>(usage.variable_mapping, [])].sort(
    (a, b) => a.position - b.position,
  );
  const components = parseJsonColumn<JsonRecord[]>(template.components, []);
  const expectedCount = templateParameterCount(components);
  if (
    !mapping.length ||
    mapping.length !== expectedCount ||
    mapping.some((item, index) => item.position !== index + 1 || !Object.hasOwn(values, item.field) || !values[item.field])
  ) {
    throw new PublicError(
      'O mapeamento das variáveis do template de confirmação está incompleto. Reconfigure em Templates Meta.',
      409,
    );
  }

  const params = mapping.map((item) => values[item.field]);
  const idempotencyKey = `sga-payment-confirm-${charge.id}`;
  const deliveryId = crypto.randomUUID();

  try {
    db.prepare(
      `INSERT INTO zernio_whatsapp_manual_deliveries (
        id, id_usuario, id_locatario, template_id, account_id, provider,
        idempotency_key, template_name, template_language, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending')`,
    ).run(
      deliveryId,
      ownerId,
      tenant.id,
      template.id,
      channel.accountId,
      channel.provider,
      idempotencyKey,
      template.name,
      template.language,
    );
  } catch {
    const previous = db
      .prepare('SELECT status, message_id FROM zernio_whatsapp_manual_deliveries WHERE idempotency_key = ?')
      .get(idempotencyKey) as { status?: string; message_id?: string } | undefined;
    if (previous?.status === 'sent') {
      return {
        success: true,
        alreadySent: true,
        messageId: previous.message_id,
        templateName: template.name,
        channel: publicChannel(channel),
      };
    }
    throw new PublicError('Não foi possível registrar a tentativa de envio.', 409);
  }

  let messageId: string;
  try {
    if (channel.provider === 'meta') {
      const sent = await sendMetaTemplateMessage({
        phoneNumberId: channel.accountId,
        token: channel.token,
        to: phoneForWhatsApp(String(tenant.whatsapp)),
        templateName: String(template.name),
        templateLanguage: String(template.language),
        templateParams: params,
        components,
      });
      messageId = sent.messageId;
      resolveMetaAlerts(ownerId);
    } else {
      const sentPayload = await zernioRequest('/inbox/conversations', channel.token, {
        method: 'POST',
        idempotencyKey,
        body: {
          accountId: channel.accountId,
          participantId: phoneForWhatsApp(String(tenant.whatsapp)),
          templateName: template.name,
          templateLanguage: template.language,
          ...(params.length ? { templateParams: params } : {}),
        },
      });
      const sentData = sentPayload.data ?? sentPayload;
      const sentMessageId = sentData.messageId ?? sentData.message?.id;
      if (typeof sentMessageId !== 'string' || !sentMessageId) {
        throw new PublicError('A Zernio não retornou a identificação da mensagem enviada.', 502);
      }
      messageId = sentMessageId;
    }
  } catch (error) {
    const safeError = error instanceof MetaApiError
      ? describeMetaError(error)
      : error instanceof ZernioError
        ? safeZernioError(error).message
        : error instanceof Error
          ? error.message.slice(0, 160)
          : 'send_failed';

    db.prepare(
      `UPDATE zernio_whatsapp_manual_deliveries
       SET status = 'failed', safe_error = ?, updated_at = ?
       WHERE id = ? AND status = 'sending'`,
    ).run(safeError, new Date().toISOString(), deliveryId);

    if (error instanceof MetaApiError) {
      const meta = classifyMetaError(error);
      if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
      throw new PublicError(safeError, error.status === 429 ? 429 : 400);
    }
    if (error instanceof ZernioError) throw safeZernioError(error);
    throw error;
  }

  const sentAt = new Date().toISOString();
  db.prepare(
    `UPDATE zernio_whatsapp_manual_deliveries
     SET status = 'sent', message_id = ?, sent_at = ?, updated_at = ?, safe_error = NULL, error_code = NULL
     WHERE id = ? AND status = 'sending'`,
  ).run(messageId, sentAt, sentAt, deliveryId);

  return {
    success: true,
    messageId,
    templateName: template.name,
    channel: publicChannel(channel),
  };
}

export async function sendPaymentConfirmationForWebhook(
  ownerId: string,
  paymentId: string,
  target: JsonRecord | null | undefined,
  amountValue: number,
  paidAt: string,
  targetColumn: 'id_cobranca' | 'id_candidato',
  targetId: string,
): Promise<void> {
  const phoneValue = target?.whatsapp ?? target?.telefone;
  if (!phoneValue) return;

  let channel: Channel;
  try {
    channel = resolveChannel(ownerId);
  } catch {
    return;
  }

  const db = getDb();
  const usage = db
    .prepare(
      `SELECT template_id, variable_mapping
       FROM zernio_whatsapp_template_usages
       WHERE id_usuario = ? AND provider = ? AND account_id = ?
         AND purpose = 'payment_confirmation' AND is_default = 1`,
    )
    .get(ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;
  if (!usage) return;

  const template = db
    .prepare(
      `SELECT name, language, account_id, components, status
       FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ? AND status = 'APPROVED'`,
    )
    .get(usage.template_id, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;
  if (!template) return;

  const idempotencyKey = `sga-payment-${paymentId}`;
  let attemptId: string | null = null;
  try {
    attemptId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO zernio_payment_notifications (
        id, mercado_pago_id, ${targetColumn}, id_usuario, idempotency_key, status
      ) VALUES (?, ?, ?, ?, ?, 'sending')`,
    ).run(attemptId, paymentId, targetId, ownerId, idempotencyKey);
  } catch {
    const existing = db
      .prepare('SELECT id, status, attempts FROM zernio_payment_notifications WHERE mercado_pago_id = ?')
      .get(paymentId) as { id: string; status: string; attempts: number } | undefined;
    if (!existing || existing.status === 'sent' || existing.status === 'sending') return;
    const upd = db
      .prepare(
        `UPDATE zernio_payment_notifications
         SET status = 'sending', attempts = ?, safe_error = NULL, updated_at = ?
         WHERE id = ? AND status = 'failed'`,
      )
      .run(Number(existing.attempts ?? 1) + 1, new Date().toISOString(), existing.id);
    if (upd.changes === 0) return;
    attemptId = existing.id;
  }

  const firstName = String(target?.nome_completo ?? target?.nome ?? '').trim().split(/\s+/)[0] || 'Olá';
  const amount = Number(amountValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const values: Record<string, string> = {
    tenant_first_name: firstName,
    amount,
    paid_at: new Date(paidAt).toLocaleDateString('pt-BR'),
  };

  const mapping = [...parseJsonColumn<JsonRecord[]>(usage.variable_mapping, [])].sort(
    (a, b) => a.position - b.position,
  );
  const components = parseJsonColumn<JsonRecord[]>(template.components, []);
  const expectedCount = templateParameterCount(components);
  if (
    mapping.length !== expectedCount ||
    mapping.some((item, index) => item.position !== index + 1 || !Object.hasOwn(values, item.field) || !values[item.field])
  ) {
    db.prepare(
      `UPDATE zernio_payment_notifications SET status = 'failed', safe_error = 'invalid_template_mapping', updated_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), attemptId);
    return;
  }

  const phoneDigits = String(phoneValue).replace(/\D/g, '');
  const participantId = phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`;
  const templateParams = mapping.map((item) => values[item.field]);

  try {
    let messageId: string | null = null;
    if (channel.provider === 'meta') {
      const sent = await sendMetaTemplateMessage({
        phoneNumberId: channel.accountId,
        token: channel.token,
        to: participantId,
        templateName: String(template.name),
        templateLanguage: String(template.language),
        templateParams,
        components,
      });
      messageId = sent.messageId;
      resolveMetaAlerts(ownerId);
    } else {
      const result = await zernioRequest('/inbox/conversations', channel.token, {
        method: 'POST',
        idempotencyKey,
        body: {
          accountId: channel.accountId,
          participantId,
          templateName: template.name,
          templateLanguage: template.language,
          templateParams,
        },
      });
      messageId = result.message?.id ?? result.data?.message?.id ?? result.id ?? null;
    }

    db.prepare(
      `UPDATE zernio_payment_notifications
       SET status = 'sent', message_id = ?, safe_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(messageId, new Date().toISOString(), attemptId);
  } catch (error) {
    if (error instanceof MetaApiError) {
      const meta = classifyMetaError(error);
      if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
    }
    const safeError = error instanceof Error ? error.message.slice(0, 160) : 'send_failed';
    db.prepare(
      `UPDATE zernio_payment_notifications SET status = 'failed', safe_error = ?, updated_at = ? WHERE id = ?`,
    ).run(safeError, new Date().toISOString(), attemptId);
  }
}
