import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { getDb } from '../db/database.js';
import { decryptSecret } from '../utils/crypto.js';
import {
  classifyMetaError,
  recordAndNotifyMetaAlert,
  resolveMetaAlerts,
} from './meta-alerts.js';
import {
  MetaApiError,
  createMessageTemplate,
  deleteMessageTemplate,
  describeMetaError,
  editMessageTemplate,
  getPhoneNumberDetails,
  metaErrorDetail,
} from './meta-graph.js';
import { sendMetaTemplateMessage } from './meta-messages.js';
import {
  PublicError,
  ZernioError,
  normalizeProvider,
  phoneForWhatsApp,
  publicChannel,
  resolveChannel,
  safeZernioError,
  syncChannelTemplates,
  templateParameterCount,
  zernioRequest,
  type Channel,
} from './whatsapp-sender.js';

type JsonRecord = Record<string, any>;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseJsonCol<T>(val: unknown, fallback: T): T {
  if (typeof val !== 'string') return (val as T) ?? fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function assertActiveLandlord(ownerId: string): void {
  const db = getDb();
  const owner = db
    .prepare('SELECT role, ativo FROM usuarios WHERE id = ?')
    .get(ownerId) as { role?: string; ativo?: number } | undefined;

  if (!owner || owner.role !== 'locador' || Number(owner.ativo) !== 1) {
    throw new PublicError('A operação está disponível para contas ativas de locador.', 403);
  }
}

function paymentButtonUrlTemplate(): string {
  return `${loadEnv().urls.sgaApp}/pagar/{{1}}`;
}

function metaCallbackUrl(): string {
  return loadEnv().urls.metaWebhook;
}

function normalizeTemplateComponents(components: JsonRecord[]): JsonRecord[] {
  return components.map((component) => {
    const next: JsonRecord = { ...component, type: String(component.type).toUpperCase() };
    if (next.format) next.format = String(next.format).toUpperCase();
    if (Array.isArray(next.buttons)) {
      next.buttons = next.buttons.map((button: JsonRecord) => ({
        ...button,
        type: String(button.type).toUpperCase(),
      }));
    }
    return next;
  });
}

function assertMetaBodyRules(bodyText: string): void {
  const text = String(bodyText ?? '');
  const variableCount = [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].length;
  if (!variableCount) return;
  if (/^\s*\{\{\d+\}\}/.test(text) || /\{\{\d+\}\}\s*[.,;:!?…]*\s*$/.test(text)) {
    throw new PublicError(
      'A Meta não aceita variáveis no início ou no fim do corpo da mensagem. Reescreva o texto.',
      400,
    );
  }
  const tokens = text.trim().split(/\s+/).filter(Boolean).length;
  const minimum = variableCount * 3 + 1;
  if (tokens < minimum) {
    throw new PublicError(
      `A Meta exige um corpo mais longo: ${variableCount} variável${variableCount > 1 ? 'eis' : ''} precisa de ao menos ${minimum} palavras.`,
      400,
    );
  }
}

function validateTemplateComponents(components: JsonRecord[]): string | null {
  if (components.some((item) => !['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(String(item?.type).toUpperCase()))) {
    return 'O template contém um componente não suportado.';
  }
  const bodyComponents = components.filter((item) => String(item?.type).toUpperCase() === 'BODY');
  if (
    bodyComponents.length !== 1 ||
    typeof bodyComponents[0]?.text !== 'string' ||
    !bodyComponents[0].text.trim() ||
    bodyComponents[0].text.length > 1024
  ) {
    return 'O template precisa ter um corpo de mensagem válido com até 1.024 caracteres.';
  }

  const bodyText = bodyComponents[0].text as string;
  assertMetaBodyRules(bodyText);

  const unparsedVariableText = bodyText.replace(/\{\{\d+\}\}/g, '');
  if (unparsedVariableText.includes('{{') || unparsedVariableText.includes('}}')) {
    return 'Use somente variáveis no formato {{1}}, {{2}}, {{3}}...';
  }
  const bodyVariables = [
    ...new Set([...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
  if (bodyVariables.some((value, index) => value !== index + 1)) {
    return 'As variáveis do corpo precisam ser sequenciais: {{1}}, {{2}}, {{3}}...';
  }
  if (
    bodyVariables.length &&
    (!Array.isArray(bodyComponents[0]?.example?.body_text?.[0]) ||
      bodyComponents[0].example.body_text[0].length !== bodyVariables.length ||
      bodyComponents[0].example.body_text[0].some(
        (value: unknown) => typeof value !== 'string' || !value.trim() || value.length > 60,
      ))
  ) {
    return 'Informe um exemplo de até 60 caracteres para cada variável do corpo.';
  }
  if (components.length > 4) return 'O template contém componentes duplicados ou não suportados.';

  const header = components.find((item) => String(item?.type).toUpperCase() === 'HEADER');
  if (
    components.filter((item) => String(item?.type).toUpperCase() === 'HEADER').length > 1 ||
    components.filter((item) => String(item?.type).toUpperCase() === 'FOOTER').length > 1 ||
    components.filter((item) => String(item?.type).toUpperCase() === 'BUTTONS').length > 1
  ) {
    return 'O template aceita somente um cabeçalho, rodapé e grupo de botões.';
  }
  if (header && !['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(String(header.format).toUpperCase())) {
    return 'Selecione um formato válido para o cabeçalho.';
  }
  if (
    header &&
    String(header.format).toUpperCase() === 'TEXT' &&
    (typeof header.text !== 'string' || header.text.length > 60 || /\{\{|\}\}/.test(header.text))
  ) {
    return 'O cabeçalho de texto aceita até 60 caracteres e não permite variáveis.';
  }
  if (
    header &&
    ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header.format).toUpperCase()) &&
    (typeof header.example?.header_handle?.[0] !== 'string' || !header.example.header_handle[0].trim())
  ) {
    return 'Informe o handle de mídia de exemplo exigido pela Meta.';
  }
  if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header.format).toUpperCase())) {
    try {
      if (new URL(header.example.header_handle[0]).protocol !== 'https:') throw new Error('invalid');
    } catch {
      return 'A mídia de exemplo precisa ser uma URL pública HTTPS.';
    }
  }

  const footer = components.find((item) => String(item?.type).toUpperCase() === 'FOOTER');
  if (footer && (typeof footer.text !== 'string' || footer.text.length > 60 || /\{\{|\}\}/.test(footer.text))) {
    return 'O rodapé pode ter no máximo 60 caracteres.';
  }

  const buttonComponent = components.find((item) => String(item?.type).toUpperCase() === 'BUTTONS');
  const buttons = Array.isArray(buttonComponent?.buttons) ? buttonComponent.buttons : [];
  if (buttons.some((item: JsonRecord) => typeof item.text !== 'string' || !item.text.trim() || item.text.length > 25)) {
    return 'Cada botão precisa ter um texto de até 25 caracteres.';
  }
  if (buttons.some((item: JsonRecord) => !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(String(item.type).toUpperCase()))) {
    return 'Tipo de botão não suportado neste formulário.';
  }
  if (buttons.filter((item: JsonRecord) => String(item.type).toUpperCase() === 'QUICK_REPLY').length > 3) {
    return 'São permitidas no máximo 3 respostas rápidas.';
  }
  if (
    buttons.length > 2 &&
    buttons.some((item: JsonRecord) => ['URL', 'PHONE_NUMBER'].includes(String(item.type).toUpperCase()))
  ) {
    return 'São permitidos no máximo 2 botões de chamada para ação.';
  }
  const ctaButtons = buttons.filter((item: JsonRecord) =>
    ['URL', 'PHONE_NUMBER'].includes(String(item.type).toUpperCase()),
  );
  const quickReplyButtons = buttons.filter((item: JsonRecord) => String(item.type).toUpperCase() === 'QUICK_REPLY');
  if (ctaButtons.length && quickReplyButtons.length) {
    return 'Escolha respostas rápidas ou botões CTA, sem misturar os dois tipos.';
  }
  if (ctaButtons.length === 2 && new Set(ctaButtons.map((item: JsonRecord) => String(item.type).toUpperCase())).size !== 2) {
    return 'Os botões CTA precisam ser um de telefone e um de site.';
  }
  if (ctaButtons.some((item: JsonRecord) => /%7B|%7D/i.test(String(item.url ?? '')))) {
    return 'A URL do botão contém a variável codificada (%7B%7B1%7D%7D). Use literalmente {{1}}, uma única vez, no final.';
  }
  const invalidCta = ctaButtons.some((item: JsonRecord) => {
    const type = String(item.type).toUpperCase();
    if (type === 'PHONE_NUMBER') return !/^\d{8,15}$/.test(String(item.phone_number ?? ''));
    if (typeof item.url !== 'string' || item.url.length > 2000) return true;
    try {
      const url = new URL(item.url.replace(/\{\{1\}\}/g, 'example'));
      if (url.protocol !== 'https:') return true;
    } catch {
      return true;
    }
    if (/\{\{\d+\}\}/.test(item.url)) {
      if (!item.url.endsWith('{{1}}') || !Array.isArray(item.example) || typeof item.example[0] !== 'string') {
        return true;
      }
      return !item.example[0].trim();
    }
    return false;
  });
  if (invalidCta) {
    return 'Confira o número de telefone ou informe uma URL HTTPS válida com exemplo quando dinâmica.';
  }
  return null;
}

export async function getWhatsappHealth(ownerId: string) {
  assertActiveLandlord(ownerId);
  const db = getDb();
  const integration = db
    .prepare('SELECT * FROM zernio_integracoes WHERE id_usuario = ?')
    .get(ownerId) as JsonRecord | undefined;

  const provider = normalizeProvider(integration?.provider);
  const callbackUrl = metaCallbackUrl();

  if (provider === 'meta') {
    if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id) {
      return { health: 'attention', message: 'Conecte um número da Meta em Configurações.', callbackUrl, provider: 'meta' };
    }
    if (integration.meta_status === 'invalid') {
      return {
        health: 'attention',
        message: 'O token da Meta não foi aceito. Gere um novo token em Configurações.',
        callbackUrl,
        provider: 'meta',
      };
    }
    try {
      const token = decryptSecret(String(integration.meta_access_token_ciphertext), ownerId);
      const details = await getPhoneNumberDetails(String(integration.meta_phone_number_id), token);
      const connected = integration.meta_status === 'connected';
      return {
        health: connected ? 'connected' : 'attention',
        message: connected
          ? `Canal WhatsApp conectado na Meta${details.displayPhoneNumber ? ` (${details.displayPhoneNumber})` : ''}.`
          : 'O número da Meta ainda não foi registrado para uso pela API.',
        callbackUrl,
        provider: 'meta',
      };
    } catch (error) {
      const message =
        error instanceof MetaApiError
          ? describeMetaError(error)
          : 'Não foi possível consultar o canal da Meta agora.';
      return { health: 'unavailable', message, callbackUrl, provider: 'meta' };
    }
  }

  if (
    !integration?.api_key_ciphertext ||
    integration.key_status !== 'valid' ||
    !integration.whatsapp_account_id ||
    !integration.zernio_profile_id
  ) {
    return {
      health: 'attention',
      message: 'Configure e valide a integração Zernio em Configurações.',
      callbackUrl,
      provider: 'zernio',
    };
  }

  try {
    const apiKey = decryptSecret(String(integration.api_key_ciphertext), ownerId);
    const query = new URLSearchParams({ profileId: String(integration.zernio_profile_id) });
    const payload = await zernioRequest(`/accounts?${query.toString()}`, apiKey);
    const accounts = Array.isArray(payload?.accounts)
      ? payload.accounts
      : Array.isArray(payload?.data?.accounts)
        ? payload.data.accounts
        : [];
    const connected = accounts.some((item: JsonRecord) => {
      if ((item._id ?? item.id) !== integration.whatsapp_account_id || item.platform !== 'whatsapp' || item.isActive === false) {
        return false;
      }
      const profileId = typeof item.profileId === 'object' ? item.profileId?._id ?? item.profileId?.id : item.profileId;
      return !profileId || profileId === integration.zernio_profile_id;
    });
    return {
      health: connected ? 'connected' : 'attention',
      message: connected
        ? 'Canal WhatsApp conectado e ativo na Zernio.'
        : 'O canal não está ativo no perfil Zernio configurado.',
      callbackUrl,
      provider: 'zernio',
    };
  } catch (error) {
    const message =
      error instanceof ZernioError ? safeZernioError(error).message : 'Não foi possível consultar o canal Zernio agora.';
    return { health: 'unavailable', message, callbackUrl, provider: 'zernio' };
  }
}

export function getWhatsappActivity(
  ownerId: string,
  options: { start?: string; end?: string; page?: number; pageSize?: number; search?: string },
) {
  assertActiveLandlord(ownerId);
  const page = Math.max(1, Math.min(1000, Number.parseInt(String(options.page || '1'), 10) || 1));
  const requestedSize = Number.parseInt(String(options.pageSize || ''), 10);
  const pageSize = options.pageSize == null ? 100 : Math.max(1, Math.min(50, requestedSize || 25));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['id_usuario = ?'];
  const params: Array<string | number> = [ownerId];

  if (options.start || options.end) {
    const startDate = new Date(String(options.start ?? ''));
    const endDate = new Date(String(options.end ?? ''));
    const rangeDays = (endDate.getTime() - startDate.getTime()) / 86400000;
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      !Number.isFinite(rangeDays) ||
      rangeDays < 0 ||
      rangeDays > 366
    ) {
      throw new PublicError('Selecione um período válido de até 12 meses.', 400);
    }
    where.push('occurred_at >= ?', 'occurred_at <= ?');
    params.push(startDate.toISOString(), endDate.toISOString());
  }

  const search = typeof options.search === 'string' ? options.search.trim().slice(0, 100) : '';
  if (search.length >= 3) {
    where.push('lower(coalesce(recipient_name, \'\')) LIKE ?');
    params.push(`%${search.toLowerCase()}%`);
  }

  const db = getDb();
  const whereSql = where.join(' AND ');
  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM zernio_whatsapp_activity_log WHERE ${whereSql}`)
    .get(...params) as { total: number };
  const total = Number(countRow?.total ?? 0);

  const rows = db
    .prepare(
      `SELECT type, source_id, status, template_name, template_language, category,
              recipient_name, recipient_phone, occurred_at, message_id, error, meta_status
       FROM zernio_whatsapp_activity_log
       WHERE ${whereSql}
       ORDER BY occurred_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as JsonRecord[];

  const typeLabelMap: Record<string, string> = {
    charge: 'Template de cobrança',
    scheduled: 'Template agendado',
    payment: 'Confirmação de pagamento',
    manual: 'Template manual',
  };

  const activity = rows.map((row) => ({
    id: `${row.type}-${row.source_id}`,
    type: row.type,
    label: row.template_name || typeLabelMap[String(row.type)] || 'Template WhatsApp',
    templateLanguage: row.template_language,
    category: row.category,
    recipientName: row.recipient_name || 'Destinatário não identificado',
    recipientPhone: row.recipient_phone,
    status: row.status,
    occurredAt: row.occurred_at,
    messageId: row.message_id,
    error: row.error,
    metaStatus: row.meta_status ?? null,
  }));

  return {
    activity,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function getWhatsappAnalytics(ownerId: string, options: { start?: string; end?: string }) {
  assertActiveLandlord(ownerId);
  const startDate = new Date(String(options.start ?? ''));
  const endDate = new Date(String(options.end ?? ''));
  const rangeDays = (endDate.getTime() - startDate.getTime()) / 86400000;
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime()) ||
    !Number.isFinite(rangeDays) ||
    rangeDays < 0 ||
    rangeDays > 366
  ) {
    throw new PublicError('Selecione um período válido de até 12 meses.', 400);
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT category, recipient_phone
       FROM zernio_whatsapp_activity_log
       WHERE id_usuario = ? AND status = 'sent' AND occurred_at >= ? AND occurred_at <= ?`,
    )
    .all(ownerId, startDate.toISOString(), endDate.toISOString()) as Array<{
    category: string | null;
    recipient_phone: string | null;
  }>;

  const rates: Record<string, number> = { MARKETING: 0.3217, UTILITY: 0.035, AUTHENTICATION: 0.035 };
  const grouped = new Map<string, JsonRecord>();

  for (const row of rows) {
    const digits = String(row.recipient_phone || '').replace(/\D/g, '');
    const country = digits.startsWith('55') || digits.length === 10 || digits.length === 11 ? 'BR' : 'UNKNOWN';
    const rawCat = String(row.category || '').toUpperCase();
    const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(rawCat) ? rawCat : 'UNKNOWN';
    const key = `${category}:${country}`;
    const current = grouped.get(key) || {
      category,
      country,
      volume: 0,
      cost: 0,
      currency: country === 'BR' ? 'BRL' : null,
    };
    current.volume += 1;
    if (country === 'BR' && rates[category]) current.cost += rates[category];
    grouped.set(key, current);
  }

  return {
    analytics: [...grouped.values()],
    approximate: true,
    costAvailable: true,
    source: 'local_delivery_logs',
    message:
      'Estimativa baseada nos envios aceitos registrados no SGA, categorias dos templates e tarifas Meta do Brasil vigentes desde 01/10/2026. A fatura do parceiro pode variar.',
  };
}

export async function listWhatsappTemplates(ownerId: string) {
  assertActiveLandlord(ownerId);
  const channel = resolveChannel(ownerId);
  const templates = await syncChannelTemplates(channel, ownerId);
  return {
    templates,
    channel: publicChannel(channel),
    paymentButtonUrlTemplate: paymentButtonUrlTemplate(),
  };
}

export async function createWhatsappTemplate(ownerId: string, body: JsonRecord) {
  assertActiveLandlord(ownerId);
  const channel = resolveChannel(ownerId);

  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  const language = typeof body.language === 'string' ? body.language.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim().toUpperCase() : '';
  const components = normalizeTemplateComponents(Array.isArray(body.components) ? body.components : []);

  if (!/^[a-z][a-z0-9_]{0,511}$/.test(name)) {
    throw new PublicError(
      'O nome precisa começar com letra e conter somente letras minúsculas, números e sublinhado.',
      400,
    );
  }
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) {
    throw new PublicError('Informe um código de idioma válido, como pt_BR.', 400);
  }
  if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) {
    throw new PublicError('Selecione uma categoria válida para o template.', 400);
  }

  const componentError = validateTemplateComponents(components);
  if (componentError) throw new PublicError(componentError, 400);

  let remoteTemplate: JsonRecord | null = null;
  if (channel.provider === 'meta') {
    try {
      const created = await createMessageTemplate(channel.wabaId as string, channel.token, {
        name,
        category,
        language,
        parameter_format: 'POSITIONAL',
        components,
      });
      remoteTemplate = {
        id: created.id,
        name,
        language,
        category: created.category,
        status: created.status,
        components,
      };
    } catch (error) {
      if (error instanceof MetaApiError) {
        throw new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400, {
          detail: metaErrorDetail(error) ?? undefined,
        });
      }
      throw error;
    }
  } else {
    const createPayload = await zernioRequest('/whatsapp/templates', channel.token, {
      method: 'POST',
      body: { accountId: channel.accountId, name, category, language, components },
    });
    remoteTemplate = createPayload.template ?? createPayload.data?.template ?? null;
    if (!remoteTemplate || typeof remoteTemplate.id !== 'string') {
      throw new PublicError(
        'A Meta recebeu o pedido, mas a Zernio não retornou os dados do template. Atualize a lista.',
        502,
      );
    }
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO zernio_whatsapp_templates (
      id, id_usuario, provider, account_id, meta_template_id, name, language, category, status,
      components, variable_mapping, purpose, is_default, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'general', 0, ?, ?, ?)
    ON CONFLICT (id_usuario, provider, account_id, name, language) DO UPDATE SET
      meta_template_id = excluded.meta_template_id,
      category = excluded.category,
      status = excluded.status,
      components = excluded.components,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at`,
  ).run(
    id,
    ownerId,
    channel.provider,
    channel.accountId,
    String(remoteTemplate.id),
    name,
    language,
    String(remoteTemplate.category ?? category).toUpperCase(),
    String(remoteTemplate.status ?? 'PENDING').toUpperCase(),
    JSON.stringify(components),
    now,
    now,
    now,
  );

  const saved = db
    .prepare(
      `SELECT id, meta_template_id, name, language, category, status, rejection_reason,
              components, variable_mapping, purpose, is_default, last_synced_at, provider
       FROM zernio_whatsapp_templates
       WHERE id_usuario = ? AND provider = ? AND account_id = ? AND name = ? AND language = ?`,
    )
    .get(ownerId, channel.provider, channel.accountId, name, language) as JsonRecord;

  return {
    template: {
      ...saved,
      is_default: Number(saved.is_default) === 1,
      components: parseJsonCol(saved.components, []),
      variable_mapping: parseJsonCol(saved.variable_mapping, []),
      usages: [],
    },
    channel: publicChannel(channel),
  };
}

export async function updateWhatsappTemplate(ownerId: string, templateId: string, body: JsonRecord) {
  assertActiveLandlord(ownerId);
  if (!UUID_REGEX.test(templateId)) throw new PublicError('Selecione um template válido.', 400);

  const channel = resolveChannel(ownerId);
  if (channel.provider !== 'meta') {
    throw new PublicError('A edição de templates pela interface está disponível para contas Meta Cloud API.', 409);
  }

  const db = getDb();
  const template = db
    .prepare(
      `SELECT id, meta_template_id, name, language, status, category
       FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .get(templateId, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;

  if (!template) throw new PublicError('O template não pertence a este locador ou canal.', 404);
  if (!template.meta_template_id) {
    throw new PublicError('Este template não tem identificação na Meta. Atualize a lista.', 409);
  }
  const status = String(template.status ?? '').toUpperCase();
  if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(status)) {
    throw new PublicError('A Meta só permite editar templates aprovados, rejeitados ou pausados.', 409);
  }

  const category = typeof body.category === 'string' ? body.category.trim().toUpperCase() : '';
  if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) {
    throw new PublicError('Selecione uma categoria válida para o template.', 400);
  }
  const categoryChanged = category !== String(template.category ?? '').toUpperCase();
  if (categoryChanged && status !== 'REJECTED' && status !== 'PAUSED') {
    throw new PublicError('A Meta não permite alterar a categoria de um template aprovado.', 409);
  }

  const components = normalizeTemplateComponents(Array.isArray(body.components) ? body.components : []);
  const componentError = validateTemplateComponents(components);
  if (componentError) throw new PublicError(componentError, 400);

  try {
    await editMessageTemplate(
      String(template.meta_template_id),
      channel.token,
      components,
      categoryChanged ? category : undefined,
    );
  } catch (error) {
    if (error instanceof MetaApiError) {
      throw new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400);
    }
    throw error;
  }

  db.prepare(
    `UPDATE zernio_whatsapp_templates
     SET components = ?, category = ?, rejection_reason = NULL, updated_at = ?
     WHERE id = ? AND id_usuario = ?`,
  ).run(JSON.stringify(components), category, new Date().toISOString(), template.id, ownerId);

  const expectedCount = templateParameterCount(components);
  const usages = db
    .prepare('SELECT id, variable_mapping FROM zernio_whatsapp_template_usages WHERE template_id = ? AND id_usuario = ?')
    .all(template.id, ownerId) as Array<{ id: string; variable_mapping: string }>;
  const staleUsages = usages.filter((u) => {
    const parsed = parseJsonCol<unknown[]>(u.variable_mapping, []);
    return !Array.isArray(parsed) || parsed.length !== expectedCount;
  });

  if (staleUsages.length > 0) {
    const placeholders = staleUsages.map(() => '?').join(', ');
    db.prepare(`DELETE FROM zernio_whatsapp_template_usages WHERE id_usuario = ? AND id IN (${placeholders})`).run(
      ownerId,
      ...staleUsages.map((u) => u.id),
    );
  }

  return {
    success: true,
    message: staleUsages.length
      ? 'Template enviado para análise da Meta. O número de variáveis mudou, então o mapeamento antigo foi removido — selecione o template novamente em lembretes ou confirmações.'
      : 'Template enviado para análise da Meta. O status é atualizado automaticamente.',
    templates: await syncChannelTemplates(channel, ownerId),
    channel: publicChannel(channel),
  };
}

export async function deleteWhatsappTemplate(ownerId: string, templateId: string) {
  assertActiveLandlord(ownerId);
  if (!UUID_REGEX.test(templateId)) throw new PublicError('Selecione um template válido.', 400);

  const channel = resolveChannel(ownerId);
  const db = getDb();
  const template = db
    .prepare(
      `SELECT id, meta_template_id, name, language, status
       FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .get(templateId, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;

  if (!template) throw new PublicError('O template não pertence a este locador ou canal.', 404);
  if (['DELETED', 'PENDING_DELETION'].includes(String(template.status ?? '').toUpperCase())) {
    throw new PublicError('Este template já foi excluído.', 409);
  }

  db.prepare('DELETE FROM zernio_whatsapp_template_usages WHERE template_id = ? AND id_usuario = ?').run(
    template.id,
    ownerId,
  );

  if (channel.provider === 'meta') {
    try {
      await deleteMessageTemplate(
        channel.wabaId as string,
        channel.token,
        String(template.name),
        template.meta_template_id ? String(template.meta_template_id) : null,
      );
    } catch (error) {
      if (error instanceof MetaApiError) {
        throw new PublicError(describeMetaError(error), error.status === 429 ? 429 : 400);
      }
      throw error;
    }
  } else {
    try {
      const query = new URLSearchParams({ accountId: channel.accountId, language: String(template.language) });
      await zernioRequest(`/whatsapp/templates/${encodeURIComponent(String(template.name))}?${query.toString()}`, channel.token, {
        method: 'DELETE',
      });
    } catch (error) {
      if (error instanceof ZernioError) throw safeZernioError(error);
      throw error;
    }
  }

  const hasDeliveries =
    Boolean(
      db
        .prepare('SELECT id FROM zernio_whatsapp_deliveries WHERE template_id = ? AND id_usuario = ? LIMIT 1')
        .get(template.id, ownerId),
    ) ||
    Boolean(
      db
        .prepare('SELECT id FROM zernio_whatsapp_manual_deliveries WHERE template_id = ? AND id_usuario = ? LIMIT 1')
        .get(template.id, ownerId),
    );

  if (hasDeliveries) {
    db.prepare(`UPDATE zernio_whatsapp_templates SET status = 'DELETED', updated_at = ? WHERE id = ? AND id_usuario = ?`).run(
      new Date().toISOString(),
      template.id,
      ownerId,
    );
    return {
      success: true,
      archived: true,
      message: 'Template excluído na Meta. O histórico de envios foi preservado.',
      templates: await syncChannelTemplates(channel, ownerId),
      channel: publicChannel(channel),
    };
  }

  db.prepare('DELETE FROM zernio_whatsapp_templates WHERE id = ? AND id_usuario = ?').run(template.id, ownerId);
  return {
    success: true,
    archived: false,
    message: 'Template excluído.',
    templates: await syncChannelTemplates(channel, ownerId),
    channel: publicChannel(channel),
  };
}

export async function setWhatsappTemplateDefault(ownerId: string, body: JsonRecord) {
  assertActiveLandlord(ownerId);
  const channel = resolveChannel(ownerId);
  const templates = await syncChannelTemplates(channel, ownerId);

  const purpose = ['payment_confirmation', 'charge', 'avulso'].includes(String(body.purpose)) ? String(body.purpose) : '';
  if (!purpose) {
    throw new PublicError(
      'Informe se o template será usado em lembretes, confirmações de pagamento ou mensagens avulsas.',
      400,
    );
  }

  const selected = templates.find((item) => item.id === body.templateId);
  if (!selected) throw new PublicError('Selecione um template deste canal.', 404);
  if (selected.status !== 'APPROVED') throw new PublicError('A Meta só permite usar templates com status APPROVED.', 409);

  const expectedCount = templateParameterCount(Array.isArray(selected.components) ? selected.components : []);
  const allowedFields =
    purpose === 'charge'
      ? new Set(['tenant_first_name', 'amount', 'due_date', 'payment_link', 'payment_token'])
      : purpose === 'payment_confirmation'
        ? new Set(['tenant_first_name', 'amount', 'paid_at'])
        : new Set(['tenant_first_name', 'tenant_name']);

  const requestedMapping = Array.isArray(body.variableMapping) ? body.variableMapping : [];
  const variableMapping = requestedMapping.map((item: JsonRecord, index: number) => ({
    position: Number(item.position),
    field: String(item.field ?? ''),
    index,
  }));

  if (
    variableMapping.length !== expectedCount ||
    variableMapping.some((item, index) => item.position !== index + 1 || item.index !== index || !allowedFields.has(item.field))
  ) {
    throw new PublicError('Associe cada variável do template a um campo válido do SGA.', 400);
  }

  const db = getDb();
  const currentUsage = db
    .prepare('SELECT reminder_order, is_default FROM zernio_whatsapp_template_usages WHERE template_id = ? AND purpose = ?')
    .get(selected.id, purpose) as { reminder_order?: number; is_default?: number } | undefined;

  let reminderOrder = 1;
  if (purpose === 'charge') {
    if (Number.isInteger(Number(body.reminderOrder)) && Number(body.reminderOrder) > 0) {
      reminderOrder = Number(body.reminderOrder);
    } else if (Number(currentUsage?.is_default) === 1) {
      reminderOrder = Number(currentUsage?.reminder_order) || 1;
    } else {
      const maxRow = db
        .prepare(
          `SELECT reminder_order FROM zernio_whatsapp_template_usages
           WHERE id_usuario = ? AND provider = ? AND account_id = ? AND purpose = 'charge' AND is_default = 1
           ORDER BY reminder_order DESC LIMIT 1`,
        )
        .get(ownerId, channel.provider, channel.accountId) as { reminder_order?: number } | undefined;
      reminderOrder = Number(maxRow?.reminder_order || 0) + 1;
    }
  } else if (purpose === 'payment_confirmation') {
    db.prepare(
      `UPDATE zernio_whatsapp_template_usages
       SET is_default = 0, updated_at = ?
       WHERE id_usuario = ? AND provider = ? AND account_id = ? AND purpose = ? AND is_default = 1`,
    ).run(new Date().toISOString(), ownerId, channel.provider, channel.accountId, purpose);
  }

  const now = new Date().toISOString();
  const cleanMapping = JSON.stringify(variableMapping.map(({ position, field }) => ({ position, field })));

  db.prepare(
    `INSERT INTO zernio_whatsapp_template_usages (
      id, template_id, id_usuario, account_id, purpose, variable_mapping, is_default, reminder_order, provider, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT (template_id, purpose) DO UPDATE SET
      variable_mapping = excluded.variable_mapping,
      is_default = 1,
      reminder_order = excluded.reminder_order,
      provider = excluded.provider,
      account_id = excluded.account_id,
      updated_at = excluded.updated_at`,
  ).run(
    crypto.randomUUID(),
    selected.id,
    ownerId,
    channel.accountId,
    purpose,
    cleanMapping,
    reminderOrder,
    channel.provider,
    now,
    now,
  );

  return {
    success: true,
    templates: await syncChannelTemplates(channel, ownerId),
    channel: publicChannel(channel),
  };
}

export async function removeWhatsappTemplateUsage(ownerId: string, templateId: string, purpose: string) {
  assertActiveLandlord(ownerId);
  if (!templateId || !purpose) throw new PublicError('Parâmetros templateId e purpose são obrigatórios.', 400);

  const channel = resolveChannel(ownerId);
  const db = getDb();
  db.prepare(
    'DELETE FROM zernio_whatsapp_template_usages WHERE template_id = ? AND purpose = ? AND id_usuario = ?',
  ).run(templateId, purpose, ownerId);

  return {
    success: true,
    templates: await syncChannelTemplates(channel, ownerId),
    channel: publicChannel(channel),
  };
}

export async function saveChargeTemplateOrder(ownerId: string, templateIds: string[]) {
  assertActiveLandlord(ownerId);
  const cleanIds = Array.isArray(templateIds) ? templateIds.map(String) : [];
  if (new Set(cleanIds).size !== cleanIds.length) {
    throw new PublicError('A sequência contém templates duplicados.', 400);
  }

  const channel = resolveChannel(ownerId);
  const templates = await syncChannelTemplates(channel, ownerId);
  const selected = cleanIds.map((id) => templates.find((item) => item.id === id));
  if (selected.some((t) => !t || t.status !== 'APPROVED')) {
    throw new PublicError('Todos os templates da sequência precisam estar aprovados neste canal.', 409);
  }

  const db = getDb();
  if (cleanIds.length > 0) {
    const placeholders = cleanIds.map(() => '?').join(', ');
    const foundUsages = db
      .prepare(
        `SELECT template_id FROM zernio_whatsapp_template_usages
         WHERE id_usuario = ? AND provider = ? AND account_id = ? AND purpose = 'charge'
           AND template_id IN (${placeholders})`,
      )
      .all(ownerId, channel.provider, channel.accountId, ...cleanIds) as Array<{ template_id: string }>;
    if (foundUsages.length !== cleanIds.length) {
      throw new PublicError('Configure primeiro as variáveis de cada template de lembrete.', 409);
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE zernio_whatsapp_template_usages
     SET is_default = 0, updated_at = ?
     WHERE id_usuario = ? AND provider = ? AND account_id = ? AND purpose = 'charge' AND is_default = 1`,
  ).run(now, ownerId, channel.provider, channel.accountId);

  const updStmt = db.prepare(
    `UPDATE zernio_whatsapp_template_usages
     SET is_default = 1, reminder_order = ?, updated_at = ?
     WHERE id_usuario = ? AND provider = ? AND account_id = ? AND purpose = 'charge' AND template_id = ?`,
  );

  cleanIds.forEach((templateId, index) => {
    updStmt.run(index + 1, now, ownerId, channel.provider, channel.accountId, templateId);
  });

  return {
    success: true,
    templates: await syncChannelTemplates(channel, ownerId),
    channel: publicChannel(channel),
  };
}

export async function sendManualTemplate(ownerId: string, body: JsonRecord) {
  assertActiveLandlord(ownerId);
  const channel = resolveChannel(ownerId);

  const templateId = typeof body.templateId === 'string' ? body.templateId : '';
  const rawTenantIds =
    Array.isArray(body.tenantIds) && body.tenantIds.length
      ? body.tenantIds.map(String)
      : typeof body.tenantId === 'string' && body.tenantId
        ? [body.tenantId]
        : [];
  const tenantIds = [...new Set(rawTenantIds.filter((id) => UUID_REGEX.test(id)))];
  const params = Array.isArray(body.templateParams) ? body.templateParams : [];

  if (!UUID_REGEX.test(templateId) || !tenantIds.length) {
    throw new PublicError('Selecione um template e ao menos um locatário válido.', 400);
  }

  const db = getDb();
  const placeholders = tenantIds.map(() => '?').join(', ');
  const tenants = db
    .prepare(
      `SELECT id, nome_completo, whatsapp
       FROM locatarios
       WHERE id_usuario = ? AND ativo = 1 AND id IN (${placeholders})`,
    )
    .all(ownerId, ...tenantIds) as Array<{ id: string; nome_completo: string; whatsapp: string }>;

  if (!tenants.length) {
    throw new PublicError('Nenhum locatário ativo com WhatsApp cadastrado foi encontrado.', 409);
  }

  const template = db
    .prepare(
      `SELECT id, meta_template_id, account_id, name, language, status, components, purpose
       FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .get(templateId, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;

  if (!template) throw new PublicError('O template não pertence a este locador ou canal.', 404);
  if (template.purpose === 'charge' || template.purpose === 'payment_confirmation') {
    throw new PublicError('Este template é reservado para o fluxo automático de cobrança ou pagamento.', 409);
  }

  const liveTemplates = await syncChannelTemplates(channel, ownerId);
  const liveTemplate = liveTemplates.find((item) => item.id === template.id);
  if (!liveTemplate || liveTemplate.status !== 'APPROVED' || liveTemplate.meta_template_id !== template.meta_template_id) {
    throw new PublicError('Este template não está aprovado pela Meta. Atualize a lista de templates.', 409);
  }

  const components = parseJsonCol<JsonRecord[]>(template.components, []);
  const header = components.find((item) => String(item.type).toUpperCase() === 'HEADER');
  if (header && String(header.format).toUpperCase() !== 'TEXT') {
    throw new PublicError('Envio manual nesta tela aceita apenas templates de texto.', 409);
  }

  const expectedParams = templateParameterCount(components);
  if (expectedParams < 0) {
    throw new PublicError('O template contém variáveis fora de sequência e não pode ser enviado por esta tela.', 409);
  }
  if (params.length !== expectedParams || params.some((v: unknown) => typeof v !== 'string' || !v.trim())) {
    throw new PublicError(`Preencha os ${expectedParams} valores de variável do template.`, 400);
  }

  let sentCount = 0;
  const errors: string[] = [];
  const messageIds: string[] = [];

  for (const tenant of tenants) {
    if (!tenant.whatsapp) continue;
    const tenantFirstName = tenant.nome_completo ? tenant.nome_completo.trim().split(/\s+/)[0] : '';
    const tenantFullName = tenant.nome_completo || '';
    const customizedParams = params.map((p: string, pIdx: number) => {
      if (p === '{{nome}}' || p === '{{primeiro_nome}}' || (p === '{{1}}' && pIdx === 0 && tenants.length > 1)) {
        return tenantFirstName;
      }
      if (p === '{{nome_completo}}') return tenantFullName;
      return p;
    });

    const deliveryId = crypto.randomUUID();
    const idempotencyKey = `sga-manual-${crypto.randomUUID()}`;
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

    try {
      let messageId: string;
      let conversationId: string | null = null;
      if (channel.provider === 'meta') {
        const sent = await sendMetaTemplateMessage({
          phoneNumberId: channel.accountId,
          token: channel.token,
          to: phoneForWhatsApp(tenant.whatsapp),
          templateName: String(template.name),
          templateLanguage: String(template.language),
          templateParams: customizedParams,
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
            participantId: phoneForWhatsApp(tenant.whatsapp),
            templateName: template.name,
            templateLanguage: template.language,
            ...(customizedParams.length ? { templateParams: customizedParams } : {}),
          },
        });
        const result = sentPayload.data ?? sentPayload;
        const sentMessageId = result.messageId ?? result.message?.id;
        if (typeof sentMessageId !== 'string' || !sentMessageId) {
          throw new PublicError('A Zernio não retornou a identificação da mensagem enviada.', 502);
        }
        messageId = sentMessageId;
        conversationId = result.conversationId ?? result.conversation?.id ?? null;
      }

      const sentAt = new Date().toISOString();
      db.prepare(
        `UPDATE zernio_whatsapp_manual_deliveries
         SET status = 'sent', message_id = ?, conversation_id = ?, sent_at = ?, updated_at = ?, safe_error = NULL, error_code = NULL
         WHERE id = ?`,
      ).run(messageId, conversationId, sentAt, sentAt, deliveryId);
      sentCount += 1;
      messageIds.push(messageId);
    } catch (error) {
      if (error instanceof MetaApiError) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(ownerId, meta);
      }
      const errMessage = error instanceof Error ? error.message.slice(0, 160) : String(error);
      errors.push(`${tenant.nome_completo}: ${errMessage}`);
      db.prepare(
        `UPDATE zernio_whatsapp_manual_deliveries SET status = 'failed', safe_error = ?, updated_at = ? WHERE id = ?`,
      ).run(errMessage, new Date().toISOString(), deliveryId);
    }
  }

  if (sentCount === 0 && errors.length > 0) {
    throw new PublicError(errors[0] || 'Falha ao enviar mensagens.', 400);
  }

  return { success: true, sentCount, total: tenants.length, messageIds };
}

export function createWhatsappSchedule(ownerId: string, body: JsonRecord) {
  assertActiveLandlord(ownerId);
  const channel = resolveChannel(ownerId);

  const templateId = typeof body.templateId === 'string' ? body.templateId : '';
  const rawTenantIds =
    Array.isArray(body.tenantIds) && body.tenantIds.length
      ? body.tenantIds
      : typeof body.tenantId === 'string' && body.tenantId
        ? [body.tenantId]
        : [];
  const tenantIds = rawTenantIds.filter((id: unknown): id is string => typeof id === 'string' && UUID_REGEX.test(id));
  const frequency = typeof body.frequency === 'string' ? body.frequency : '';
  const scheduledDate = typeof body.scheduledDate === 'string' ? body.scheduledDate : '';
  const scheduledTime = typeof body.scheduledTime === 'string' ? body.scheduledTime : '';
  const frequencyDays = Number(body.frequencyDays);
  const params = Array.isArray(body.templateParams) ? body.templateParams : [];

  if (!UUID_REGEX.test(templateId) || tenantIds.length === 0) {
    throw new PublicError('Selecione um template e ao menos um locatário válido.', 400);
  }
  if (!['diario', 'semanal', 'quinzenal', 'mensal', 'personalizado'].includes(frequency)) {
    throw new PublicError('Selecione uma frequência válida.', 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) {
    throw new PublicError('Informe uma data e horário válidos para o primeiro envio.', 400);
  }
  const parsedDate = new Date(`${scheduledDate}T12:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== scheduledDate) {
    throw new PublicError('A data do primeiro envio não existe no calendário.', 400);
  }

  const currentParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date())
    .reduce((acc: Record<string, string>, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  const currentDate = `${currentParts.year}-${currentParts.month}-${currentParts.day}`;
  const currentTime = `${currentParts.hour}:${currentParts.minute}`;
  if (scheduledDate < currentDate || (scheduledDate === currentDate && scheduledTime <= currentTime)) {
    throw new PublicError('O primeiro envio precisa estar no futuro, considerando o horário de Brasília.', 400);
  }
  if (frequency === 'personalizado' && (!Number.isInteger(frequencyDays) || frequencyDays < 1 || frequencyDays > 365)) {
    throw new PublicError('A frequência personalizada deve estar entre 1 e 365 dias.', 400);
  }

  const db = getDb();
  const placeholders = tenantIds.map(() => '?').join(', ');
  const tenants = db
    .prepare(
      `SELECT id, nome_completo, whatsapp FROM locatarios WHERE id_usuario = ? AND ativo = 1 AND id IN (${placeholders})`,
    )
    .all(ownerId, ...tenantIds) as Array<{ id: string; nome_completo: string; whatsapp: string }>;
  const validTenants = tenants.filter((t) => Boolean(t.whatsapp));
  if (!validTenants.length) {
    throw new PublicError('Nenhum dos locatários selecionados está ativo com WhatsApp cadastrado.', 409);
  }

  const selectedTemplate = db
    .prepare(
      `SELECT id, account_id, name, language, category, status, components
       FROM zernio_whatsapp_templates
       WHERE id = ? AND id_usuario = ? AND provider = ? AND account_id = ?`,
    )
    .get(templateId, ownerId, channel.provider, channel.accountId) as JsonRecord | undefined;

  if (!selectedTemplate) throw new PublicError('Template Meta não encontrado neste canal.', 404);
  if (selectedTemplate.status !== 'APPROVED') {
    throw new PublicError('Somente templates aprovados pela Meta podem receber agendamentos.', 409);
  }

  const components = parseJsonCol<JsonRecord[]>(selectedTemplate.components, []);
  if (components.some((c) => String(c.type).toUpperCase() === 'HEADER' && String(c.format).toUpperCase() === 'LOCATION')) {
    throw new PublicError(
      'Templates com cabeçalho de localização precisam de coordenadas por envio e não podem ser agendados nesta tela.',
      400,
    );
  }

  const requiredParams = templateParameterCount(components);
  if (requiredParams < 0) {
    throw new PublicError('O template tem variáveis não sequenciais e não pode ser agendado.', 409);
  }
  if (params.length !== requiredParams || params.some((v: unknown) => typeof v !== 'string' || !v.trim())) {
    throw new PublicError(`Informe ${requiredParams} valor(es) de variável para este template.`, 400);
  }

  const insertStmt = db.prepare(
    `INSERT INTO agendamentos_mensagens (
      id, id_usuario, id_locatario, id_template, zernio_template_id, template_params,
      frequencia, frequencia_dias, proximo_envio, horario_envio, ativo
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`,
  );

  const createdIds: string[] = [];
  for (const t of validTenants) {
    const firstName = t.nome_completo ? t.nome_completo.trim().split(/\s+/)[0] : '';
    const fullName = t.nome_completo || '';
    const customizedParams = params.map((p: string, pIdx: number) => {
      if (p === '{{nome}}' || p === '{{primeiro_nome}}' || (p === '{{1}}' && pIdx === 0 && validTenants.length > 1)) {
        return firstName;
      }
      if (p === '{{nome_completo}}') return fullName;
      return p;
    });

    const id = crypto.randomUUID();
    insertStmt.run(
      id,
      ownerId,
      t.id,
      selectedTemplate.id,
      JSON.stringify(customizedParams),
      frequency,
      frequency === 'personalizado' ? frequencyDays : null,
      scheduledDate,
      `${scheduledTime}:00`,
    );
    createdIds.push(id);
  }

  return { success: true, count: createdIds.length, scheduleId: createdIds[0] };
}
