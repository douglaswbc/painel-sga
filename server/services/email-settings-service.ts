import { getDb } from '../db/database.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { dispatchDailySummaryForOwner } from './daily-summary.js';
import { META_ALERT_DEFINITIONS } from './meta-alerts.js';
import { isValidEmail, sendResendEmail, validateResendKey } from './resend.js';
import { PublicError } from './whatsapp-sender.js';
import { assertActiveLandlord } from './whatsapp-provider.js';

type JsonRecord = Record<string, any>;

const PREFERENCE_KEYS = [
  ...Object.values(META_ALERT_DEFINITIONS).map((definition) => definition.preference),
  'notificar_resumo_diario',
];

const PREFERENCE_DEFAULTS: Record<string, boolean> = {
  ...Object.fromEntries(
    Object.values(META_ALERT_DEFINITIONS).map((definition) => [
      definition.preference,
      definition.type !== 'limite_envio',
    ]),
  ),
  notificar_resumo_diario: true,
};

function getConfigRow(ownerId: string): JsonRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM email_notificacoes_config WHERE id_usuario = ?')
    .get(ownerId) as JsonRecord | undefined;
  return row ?? null;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function publicConfig(config: JsonRecord | null, recipientEmail: string | null) {
  return {
    enabled: config ? toBool(config.enabled, true) : true,
    fromEmail: config?.from_email ?? '',
    fromName: config?.from_name ?? '',
    hasKey: Boolean(config?.api_key_ciphertext),
    keyLast4: typeof config?.api_key_last4 === 'string' ? config.api_key_last4.trim() || null : null,
    keyStatus: config?.key_status ?? null,
    recipientEmail,
    lastTestAt: config?.last_test_at ?? null,
    lastSentAt: config?.last_sent_at ?? null,
    lastDailySummaryDate: config?.last_daily_summary_date ?? null,
    lastDailySummarySentAt: config?.last_daily_summary_sent_at ?? null,
    lastError: config?.last_error ?? null,
    preferences: Object.fromEntries(
      PREFERENCE_KEYS.map((key) => [
        key,
        config && config[key] !== undefined && config[key] !== null
          ? toBool(config[key], PREFERENCE_DEFAULTS[key] ?? true)
          : (PREFERENCE_DEFAULTS[key] ?? true),
      ]),
    ),
  };
}

function readPreferences(value: unknown, current: JsonRecord | null): Record<string, number> {
  const source = value && typeof value === 'object' ? (value as JsonRecord) : {};
  const patch: Record<string, number> = {};
  for (const key of PREFERENCE_KEYS) {
    if (typeof source[key] === 'boolean') {
      patch[key] = source[key] ? 1 : 0;
    } else if (current && current[key] !== undefined && current[key] !== null) {
      patch[key] = toBool(current[key], PREFERENCE_DEFAULTS[key] ?? true) ? 1 : 0;
    } else {
      patch[key] = (PREFERENCE_DEFAULTS[key] ?? true) ? 1 : 0;
    }
  }
  return patch;
}

function requireActiveEmailOwner(ownerId: string) {
  return assertActiveLandlord(ownerId, 'Esta configuração está disponível para contas ativas de locador.');
}

export function getEmailSettings(ownerId: string) {
  const owner = requireActiveEmailOwner(ownerId);
  const current = getConfigRow(ownerId);
  return { success: true, config: publicConfig(current, owner.email ?? null) };
}

export async function saveEmailSettings(ownerId: string, body: JsonRecord) {
  const owner = requireActiveEmailOwner(ownerId);
  const current = getConfigRow(ownerId);

  const fromEmail = typeof body?.fromEmail === 'string' ? body.fromEmail.trim().toLowerCase() : '';
  const fromName = typeof body?.fromName === 'string' ? body.fromName.trim().slice(0, 80) : '';
  if (fromEmail && !isValidEmail(fromEmail)) {
    throw new PublicError('Informe um e-mail de remetente válido.', 400);
  }
  const enabled = body?.enabled !== false;
  if (enabled && !fromEmail) {
    throw new PublicError('Informe o e-mail remetente verificado no Resend.', 400);
  }

  let ciphertext: string | null = current?.api_key_ciphertext ?? null;
  let last4: string | null = current?.api_key_last4 ?? null;
  let keyStatus: string | null = current?.key_status ?? null;
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

  if (apiKey) {
    if (apiKey.length < 16 || apiKey.length > 512) {
      throw new PublicError('Informe uma API Key válida do Resend.', 400);
    }
    const validation = await validateResendKey(apiKey);
    if (!validation.valid) {
      throw new PublicError(validation.error || 'A API Key do Resend não foi aceita.', 400);
    }
    ciphertext = encryptSecret(apiKey, ownerId, 'resend');
    last4 = apiKey.slice(-4);
    keyStatus = 'valid';
  }

  if (enabled && !ciphertext) {
    throw new PublicError('Cadastre a API Key do Resend antes de ativar as notificações.', 400);
  }

  const preferences = readPreferences(body?.preferences, current);
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO email_notificacoes_config (
        id_usuario, provider, api_key_ciphertext, api_key_last4, key_status,
        from_email, from_name, enabled,
        notificar_pagamento, notificar_conta_bloqueada, notificar_token_invalido,
        notificar_permissao, notificar_template, notificar_limite_envio,
        notificar_integracao, notificar_resumo_diario,
        created_at, updated_at
      ) VALUES (?, 'resend', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id_usuario) DO UPDATE SET
        provider = 'resend',
        api_key_ciphertext = excluded.api_key_ciphertext,
        api_key_last4 = excluded.api_key_last4,
        key_status = excluded.key_status,
        from_email = excluded.from_email,
        from_name = excluded.from_name,
        enabled = excluded.enabled,
        notificar_pagamento = excluded.notificar_pagamento,
        notificar_conta_bloqueada = excluded.notificar_conta_bloqueada,
        notificar_token_invalido = excluded.notificar_token_invalido,
        notificar_permissao = excluded.notificar_permissao,
        notificar_template = excluded.notificar_template,
        notificar_limite_envio = excluded.notificar_limite_envio,
        notificar_integracao = excluded.notificar_integracao,
        notificar_resumo_diario = excluded.notificar_resumo_diario,
        updated_at = excluded.updated_at`,
    )
    .run(
      ownerId,
      ciphertext,
      last4,
      keyStatus,
      fromEmail || null,
      fromName || null,
      enabled ? 1 : 0,
      preferences.notificar_pagamento,
      preferences.notificar_conta_bloqueada,
      preferences.notificar_token_invalido,
      preferences.notificar_permissao,
      preferences.notificar_template,
      preferences.notificar_limite_envio,
      preferences.notificar_integracao,
      preferences.notificar_resumo_diario,
      now,
      now,
    );

  const saved = getConfigRow(ownerId);
  if (!saved) {
    throw new PublicError('Não foi possível salvar a configuração de e-mail.', 500);
  }
  return { success: true, config: publicConfig(saved, owner.email ?? null) };
}

export function disableEmailSettings(ownerId: string) {
  const owner = requireActiveEmailOwner(ownerId);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO email_notificacoes_config (id_usuario, enabled, created_at, updated_at)
       VALUES (?, 0, ?, ?)
       ON CONFLICT (id_usuario) DO UPDATE SET enabled = 0, updated_at = excluded.updated_at`,
    )
    .run(ownerId, now, now);

  const saved = getConfigRow(ownerId);
  return { success: true, config: publicConfig(saved, owner.email ?? null) };
}

export async function sendTestEmail(ownerId: string) {
  const owner = requireActiveEmailOwner(ownerId);
  const current = getConfigRow(ownerId);

  if (!current?.api_key_ciphertext || !current?.from_email) {
    throw new PublicError('Salve a API Key e o remetente do Resend antes de enviar o teste.', 409);
  }

  const lastTest = current.last_test_at ? new Date(current.last_test_at).getTime() : 0;
  if (lastTest && Date.now() - lastTest < 60_000) {
    throw new PublicError('Aguarde um minuto antes de enviar outro e-mail de teste.', 429);
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(String(current.api_key_ciphertext), ownerId);
  } catch {
    throw new PublicError('Não foi possível ler a API Key salva. Cadastre a chave novamente.', 409);
  }

  const now = new Date().toISOString();
  const db = getDb();
  try {
    await sendResendEmail({
      apiKey,
      from: String(current.from_email),
      fromName: current.from_name ? String(current.from_name) : null,
      to: owner.email,
      subject: 'Teste de notificação do Painel SGA',
      html: `<p>Este é um e-mail de teste do Painel SGA.</p><p>Se você recebeu esta mensagem, as notificações da Meta estão configuradas para <strong>${owner.email}</strong>.</p>`,
      text: `Este é um e-mail de teste do Painel SGA.\n\nSe você recebeu esta mensagem, as notificações da Meta estão configuradas para ${owner.email}.`,
      idempotencyKey: `sga-test-${ownerId}-${Date.now()}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Falha ao enviar e-mail pelo Resend.';
    db.prepare(
      `UPDATE email_notificacoes_config
       SET last_test_at = ?, last_error = ?, updated_at = ?
       WHERE id_usuario = ?`,
    ).run(now, message, now, ownerId);
    throw new PublicError(`O Resend recusou o envio: ${message}`, 400);
  }

  db.prepare(
    `UPDATE email_notificacoes_config
     SET last_test_at = ?, last_sent_at = ?, last_error = NULL, key_status = 'valid', updated_at = ?
     WHERE id_usuario = ?`,
  ).run(now, now, now, ownerId);

  const saved = getConfigRow(ownerId);
  return { success: true, config: publicConfig(saved, owner.email ?? null) };
}

export async function sendDailySummaryManual(ownerId: string) {
  const owner = requireActiveEmailOwner(ownerId);
  const current = getConfigRow(ownerId);

  if (!current?.api_key_ciphertext || !current?.from_email) {
    throw new PublicError('Salve a API Key e o remetente do Resend antes de enviar o resumo.', 409);
  }
  if (!owner.email) {
    throw new PublicError('Sua conta não possui um e-mail cadastrado.', 409);
  }

  const lastSummaryAt = current.last_daily_summary_sent_at
    ? new Date(current.last_daily_summary_sent_at).getTime()
    : 0;
  if (lastSummaryAt && Date.now() - lastSummaryAt < 30_000) {
    throw new PublicError('Aguarde alguns segundos antes de reenviar o resumo diário.', 429);
  }

  try {
    const result = await dispatchDailySummaryForOwner(
      {
        id: owner.id,
        email: owner.email,
        nome_completo: owner.nome_completo,
        empresa_nome: owner.empresa_nome,
      },
      current,
      { manual: true },
    );

    if (!result.sent) {
      throw new PublicError('Não foi possível enviar o resumo diário. Verifique a chave do Resend.', 400);
    }

    const saved = getConfigRow(ownerId);
    return {
      success: true,
      config: publicConfig(saved, owner.email ?? null),
      summary: result.summary,
    };
  } catch (error) {
    if (error instanceof PublicError) throw error;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Falha ao enviar resumo pelo Resend.';
    throw new PublicError(`O Resend recusou o envio: ${message}`, 400);
  }
}
