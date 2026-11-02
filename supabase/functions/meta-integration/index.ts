import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import {
  MetaApiError,
  debugToken,
  describeMetaError,
  exchangeCodeForBusinessToken,
  exchangeForLongLivedToken,
  getPhoneNumberDetails,
  getWaba,
  graphVersion,
  listPhoneNumbers,
  registerPhoneNumber,
  subscribeWaba,
} from '../_shared/meta-graph.ts';
import { activateProvider, metaWebhookUrl, publicIntegration } from '../_shared/whatsapp-provider.ts';
import {
  activeMetaAlerts,
  classifyMetaError,
  publicMetaAlerts,
  recordAndNotifyMetaAlert,
  resolveMetaAlerts,
  type MetaAlertType,
} from '../_shared/meta-alerts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type JsonRecord = Record<string, any>;
type Candidate = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
};

const META_ID = /^[0-9]{10,20}$/;

class PublicError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function metaAppConfig() {
  return {
    appId: Deno.env.get('META_APP_ID') ?? null,
    configurationId: Deno.env.get('META_CONFIGURATION_ID') ?? null,
    graphVersion: graphVersion(),
    configured: Boolean(Deno.env.get('META_APP_ID') && Deno.env.get('META_APP_SECRET')),
  };
}

function tokenExpiryIso(expiresAt: number | null): string | null {
  if (!expiresAt || expiresAt <= 0) return null;
  return new Date(expiresAt * 1000).toISOString();
}

async function saveMetaState(
  admin: any,
  ownerId: string,
  patch: JsonRecord,
): Promise<JsonRecord> {
  const { data, error } = await admin.from('zernio_integracoes')
    .upsert({ id_usuario: ownerId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id_usuario' })
    .select('*')
    .single();
  if (error || !data) throw new PublicError('Não foi possível salvar a integração da Meta.', 500);
  return data;
}

async function collectCandidates(wabaIds: string[], token: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const wabaId of wabaIds) {
    const numbers = await listPhoneNumbers(wabaId, token);
    for (const number of numbers) {
      candidates.push({
        wabaId,
        phoneNumberId: number.id,
        displayPhoneNumber: number.displayPhoneNumber,
        verifiedName: number.verifiedName,
        qualityRating: number.qualityRating,
      });
    }
  }
  return candidates;
}

/**
 * Registers the number, subscribes the app to the WABA webhooks and stores the
 * channel metadata. A registration failure is reported but the channel is kept,
 * so the landlord can finish the verification later.
 */
async function finalizeChannel(
  admin: any,
  ownerId: string,
  candidate: Candidate,
  pin: string,
  token: string,
): Promise<{ integration: JsonRecord; warning: string | null }> {
  let warning: string | null = null;
  try {
    const registered = await registerPhoneNumber(candidate.phoneNumberId, pin, token);
    if (!registered) warning = 'A Meta não confirmou o registro do número. Verifique o PIN e o status de verificação do número.';
  } catch (error) {
    const message = describeMetaError(error);
    warning = `O canal foi salvo, mas o número ainda não foi registrado na Meta: ${message}`;
  }

  try {
    await subscribeWaba(candidate.wabaId, token);
  } catch (error) {
    const message = describeMetaError(error);
    warning = warning
      ? `${warning} Os webhooks da Meta também não puderam ser assinados: ${message}`
      : `Canal salvo, mas os webhooks da Meta não puderam ser assinados: ${message}`;
  }

  let details = null;
  try {
    details = await getPhoneNumberDetails(candidate.phoneNumberId, token);
  } catch {
    details = null;
  }

  const now = new Date().toISOString();
  const integration = await saveMetaState(admin, ownerId, {
    meta_waba_id: candidate.wabaId,
    meta_phone_number_id: candidate.phoneNumberId,
    meta_display_phone_number: details?.displayPhoneNumber ?? candidate.displayPhoneNumber,
    meta_verified_name: details?.verifiedName ?? candidate.verifiedName,
    meta_quality_rating: details?.qualityRating ?? candidate.qualityRating,
    meta_name_status: details?.nameStatus ?? null,
    meta_messaging_limit_tier: details?.messagingLimitTier ?? null,
    meta_code_verification_status: details?.codeVerificationStatus ?? null,
    meta_status: warning ? 'valid' : 'connected',
    meta_last_checked_at: now,
    provider_connected_at: warning ? null : now,
    provider: 'meta',
  });
  await activateProvider(admin, ownerId, 'meta');
  return { integration, warning };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: JsonRecord, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Autenticação obrigatória.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Sessão inválida ou expirada.' }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: owner, error: ownerError } = await admin
      .from('usuarios').select('role, ativo').eq('id', user.id).maybeSingle();
    if (ownerError || owner?.role !== 'locador' || owner.ativo !== true) {
      return json({ error: 'Esta integração está disponível para contas ativas de locador.' }, 403);
    }

    const body = await req.json().catch(() => ({} as JsonRecord));
    const action = body?.action;

    const { data: integration } = await admin
      .from('zernio_integracoes').select('*').eq('id_usuario', user.id).maybeSingle();

    if (action === 'status') {
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({
        integration: publicIntegration(integration),
        alerts: publicMetaAlerts(alerts),
        app: metaAppConfig(),
        callbackUrl: metaWebhookUrl(),
      });
    }

    if (action === 'alerts') {
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({ alerts: publicMetaAlerts(alerts) });
    }

    if (action === 'clear_alert') {
      const allowed: MetaAlertType[] = [
        'pagamento', 'conta_bloqueada', 'token_invalido', 'permissao',
        'template', 'limite_envio', 'integracao',
      ];
      const requested = typeof body?.tipo === 'string' ? body.tipo : '';
      if (requested && !allowed.includes(requested as MetaAlertType)) {
        return json({ error: 'Tipo de alerta inválido.' }, 400);
      }
      await resolveMetaAlerts(
        admin,
        user.id,
        requested ? [requested as MetaAlertType] : undefined,
      );
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({ alerts: publicMetaAlerts(alerts), success: true });
    }

    if (action === 'activate') {
      if (body?.provider !== 'zernio' && body?.provider !== 'meta') {
        return json({ error: 'Provedor inválido.' }, 400);
      }
      if (body.provider === 'meta') {
        if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id) {
          return json({ error: 'Conecte um número da Meta antes de usá-lo como canal principal.' }, 409);
        }
      } else {
        if (!integration?.api_key_ciphertext || integration?.key_status !== 'valid' || !integration?.whatsapp_account_id) {
          return json({ error: 'Conecte um canal da Zernio antes de usá-lo como canal principal.' }, 409);
        }
      }
      await activateProvider(admin, user.id, body.provider);
      const { data: updated } = await admin
        .from('zernio_integracoes').select('*').eq('id_usuario', user.id).maybeSingle();
      return json({ integration: publicIntegration(updated) });
    }

    if (action === 'disconnect') {
      const now = new Date().toISOString();
      const keepZernio = Boolean(integration?.api_key_ciphertext) && integration?.key_status === 'valid';
      const { data: updated, error } = await admin.from('zernio_integracoes')
        .update({
          meta_status: 'missing',
          meta_business_id: null,
          meta_waba_id: null,
          meta_phone_number_id: null,
          meta_access_token_ciphertext: null,
          meta_token_last4: null,
          meta_token_expires_at: null,
          meta_display_phone_number: null,
          meta_verified_name: null,
          meta_quality_rating: null,
          meta_name_status: null,
          meta_messaging_limit_tier: null,
          meta_code_verification_status: null,
          provider_connected_at: null,
          provider: integration?.provider === 'meta' && keepZernio ? 'zernio' : (integration?.provider ?? 'zernio'),
          last_checked_at: now,
          updated_at: now,
        })
        .eq('id_usuario', user.id)
        .select('*')
        .maybeSingle();
      if (error) return json({ error: 'Não foi possível desconectar o canal da Meta.' }, 400);
      await resolveMetaAlerts(admin, user.id);
      return json({ integration: publicIntegration(updated), alerts: [] });
    }

    if (action === 'validate_manual') {
      const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
      const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
      const wabaId = typeof body?.wabaId === 'string' ? body.wabaId.trim() : '';
      if (accessToken.length < 40 || accessToken.length > 2000) {
        return json({ error: 'Informe um token de acesso do sistema válido.' }, 400);
      }
      if (!META_ID.test(phoneNumberId) || !META_ID.test(wabaId)) {
        return json({ error: 'Informe o Phone Number ID e o WABA ID apenas com dígitos.' }, 400);
      }

      let waba: JsonRecord;
      let numbers: Awaited<ReturnType<typeof listPhoneNumbers>>;
      try {
        waba = await getWaba(wabaId, accessToken);
        numbers = await listPhoneNumbers(wabaId, accessToken);
      } catch (error) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(admin, user.id, meta);
        return json({ error: describeMetaError(error) }, 400);
      }
      if (String(waba?.id ?? wabaId) !== wabaId) {
        return json({ error: 'A Meta não encontrou esse WABA ID com este token.' }, 400);
      }
      const match = numbers.find((item) => item.id === phoneNumberId);
      if (!match) {
        return json({ error: 'Esse Phone Number ID não pertence ao WABA informado ou ainda não foi verificado.' }, 400);
      }

      let details = null;
      try {
        details = await getPhoneNumberDetails(phoneNumberId, accessToken);
      } catch {
        details = null;
      }

      const now = new Date().toISOString();
      const tokenInfo = await debugToken(accessToken).catch(() => null);
      const ciphertext = await encryptSecret(accessToken, user.id, 'meta');
      const saved = await saveMetaState(admin, user.id, {
        meta_access_token_ciphertext: ciphertext,
        meta_token_last4: accessToken.slice(-4),
        meta_token_expires_at: tokenExpiryIso(tokenInfo?.expiresAt ?? null),
        meta_business_id: tokenInfo?.userId ?? null,
        meta_waba_id: wabaId,
        meta_phone_number_id: phoneNumberId,
        meta_display_phone_number: details?.displayPhoneNumber ?? match.displayPhoneNumber,
        meta_verified_name: details?.verifiedName ?? match.verifiedName,
        meta_quality_rating: details?.qualityRating ?? match.qualityRating,
        meta_name_status: details?.nameStatus ?? null,
        meta_messaging_limit_tier: details?.messagingLimitTier ?? null,
        meta_code_verification_status: details?.codeVerificationStatus ?? null,
        meta_status: 'connected',
        meta_validated_at: now,
        meta_last_checked_at: now,
        provider_connected_at: now,
        provider: 'meta',
      });
      await activateProvider(admin, user.id, 'meta');
      await resolveMetaAlerts(admin, user.id, ['token_invalido', 'permissao', 'integracao']);
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({ integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts) });
    }

    if (action === 'complete_signup') {
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
      if (code.length < 20 || code.length > 800) {
        return json({ error: 'O código devolvido pela Meta é inválido. Inicie a conexão novamente.' }, 400);
      }
      if (!/^\d{6}$/.test(pin)) {
        return json({ error: 'Informe o PIN de 6 dígitos da verificação em duas etapas do WhatsApp.' }, 400);
      }

      let businessToken: string;
      try {
        businessToken = await exchangeCodeForBusinessToken(code);
      } catch (error) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(admin, user.id, meta);
        return json({ error: describeMetaError(error) }, 400);
      }
      const token = await exchangeForLongLivedToken(businessToken);

      const tokenInfo = await debugToken(token).catch(() => null);
      const wabaIds = tokenInfo?.wabaIds ?? [];
      if (!wabaIds.length) {
        return json({ error: 'A Meta não compartilhou nenhuma conta do WhatsApp com este aplicativo. Confirme a conclusão do cadastro.' }, 400);
      }

      let candidates: Candidate[];
      try {
        candidates = await collectCandidates(wabaIds, token);
      } catch (error) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(admin, user.id, meta);
        return json({ error: describeMetaError(error) }, 400);
      }
      if (!candidates.length) {
        return json({ error: 'Nenhum número do WhatsApp foi encontrado na conta compartilhada pela Meta.' }, 400);
      }

      const now = new Date().toISOString();
      const ciphertext = await encryptSecret(token, user.id, 'meta');
      await saveMetaState(admin, user.id, {
        meta_access_token_ciphertext: ciphertext,
        meta_token_last4: token.slice(-4),
        meta_token_expires_at: tokenExpiryIso(tokenInfo?.expiresAt ?? null),
        meta_business_id: tokenInfo?.userId ?? null,
        meta_status: 'valid',
        meta_validated_at: now,
        meta_last_checked_at: now,
      });

      if (candidates.length > 1) {
        return json({
          needsSelection: true,
          candidates: candidates.map((candidate) => ({
            wabaId: candidate.wabaId,
            phoneNumberId: candidate.phoneNumberId,
            displayPhoneNumber: candidate.displayPhoneNumber,
            verifiedName: candidate.verifiedName,
            qualityRating: candidate.qualityRating,
          })),
        });
      }

      const result = await finalizeChannel(admin, user.id, candidates[0], pin, token);
      await resolveMetaAlerts(admin, user.id, ['token_invalido', 'permissao', 'integracao']);
      const { data: saved } = await admin.from('zernio_integracoes').select('*').eq('id_usuario', user.id).maybeSingle();
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({ integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts), warning: result.warning });
    }

    if (action === 'select_number') {
      const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
      const wabaId = typeof body?.wabaId === 'string' ? body.wabaId.trim() : '';
      const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
      if (!META_ID.test(phoneNumberId) || !META_ID.test(wabaId)) {
        return json({ error: 'Selecione um número válido da lista retornada pela Meta.' }, 400);
      }
      if (!/^\d{6}$/.test(pin)) {
        return json({ error: 'Informe o PIN de 6 dígitos da verificação em duas etapas do WhatsApp.' }, 400);
      }
      if (!integration?.meta_access_token_ciphertext) {
        return json({ error: 'A credencial da Meta não foi salva. Inicie a conexão novamente.' }, 409);
      }
      const token = await decryptSecret(integration.meta_access_token_ciphertext, user.id);
      let numbers: Awaited<ReturnType<typeof listPhoneNumbers>>;
      try {
        numbers = await listPhoneNumbers(wabaId, token);
      } catch (error) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(admin, user.id, meta);
        return json({ error: describeMetaError(error) }, 400);
      }
      const match = numbers.find((item) => item.id === phoneNumberId);
      if (!match) {
        return json({ error: 'Esse número não está disponível na conta da Meta informada.' }, 400);
      }
      const result = await finalizeChannel(admin, user.id, {
        wabaId,
        phoneNumberId,
        displayPhoneNumber: match.displayPhoneNumber,
        verifiedName: match.verifiedName,
        qualityRating: match.qualityRating,
      }, pin, token);
      await resolveMetaAlerts(admin, user.id, ['token_invalido', 'permissao', 'integracao']);
      const { data: saved } = await admin.from('zernio_integracoes').select('*').eq('id_usuario', user.id).maybeSingle();
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({ integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts), warning: result.warning });
    }

    if (action === 'register') {
      const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
      if (!/^\d{6}$/.test(pin)) {
        return json({ error: 'Informe o PIN de 6 dígitos da verificação em duas etapas do WhatsApp.' }, 400);
      }
      if (!integration?.meta_access_token_ciphertext || !integration?.meta_phone_number_id || !integration?.meta_waba_id) {
        return json({ error: 'Conecte um número da Meta antes de registrá-lo.' }, 409);
      }
      const token = await decryptSecret(integration.meta_access_token_ciphertext, user.id);
      try {
        const registered = await registerPhoneNumber(integration.meta_phone_number_id, pin, token);
        if (!registered) {
          return json({ error: 'A Meta não confirmou o registro do número. Verifique o PIN e o status de verificação.' }, 409);
        }
      } catch (error) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(admin, user.id, meta);
        return json({ error: describeMetaError(error) }, 400);
      }
      const now = new Date().toISOString();
      const { data: saved } = await admin.from('zernio_integracoes')
        .update({ meta_status: 'connected', provider_connected_at: now, provider: 'meta', updated_at: now })
        .eq('id_usuario', user.id).select('*').maybeSingle();
      await activateProvider(admin, user.id, 'meta');
      await resolveMetaAlerts(admin, user.id, ['token_invalido', 'permissao', 'integracao']);
      const alerts = await activeMetaAlerts(admin, user.id);
      return json({ integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts) });
    }

    if (action === 'refresh') {
      const currentAlerts = await activeMetaAlerts(admin, user.id);
      if (!integration?.meta_access_token_ciphertext) {
        return json({ integration: publicIntegration(integration), alerts: publicMetaAlerts(currentAlerts) });
      }
      const token = await decryptSecret(integration.meta_access_token_ciphertext, user.id);
      if (!integration.meta_phone_number_id) {
        return json({ integration: publicIntegration(integration), alerts: publicMetaAlerts(currentAlerts) });
      }
      try {
        const details = await getPhoneNumberDetails(integration.meta_phone_number_id, token);
        const now = new Date().toISOString();
        const { data: saved } = await admin.from('zernio_integracoes').update({
          meta_display_phone_number: details.displayPhoneNumber,
          meta_verified_name: details.verifiedName,
          meta_quality_rating: details.qualityRating,
          meta_name_status: details.nameStatus,
          meta_messaging_limit_tier: details.messagingLimitTier,
          meta_code_verification_status: details.codeVerificationStatus,
          meta_status: 'connected',
          meta_last_checked_at: now,
          updated_at: now,
        }).eq('id_usuario', user.id).select('*').maybeSingle();
        await resolveMetaAlerts(admin, user.id, ['token_invalido']);
        const alerts = await activeMetaAlerts(admin, user.id);
        return json({ integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts) });
      } catch (error) {
        const meta = classifyMetaError(error);
        if (meta) await recordAndNotifyMetaAlert(admin, user.id, meta);
        if (error instanceof MetaApiError && (error.status === 401 || error.status === 403)) {
          const { data: saved } = await admin.from('zernio_integracoes')
            .update({ meta_status: 'invalid', meta_last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id_usuario', user.id).select('*').maybeSingle();
          const alerts = await activeMetaAlerts(admin, user.id);
          return json({ integration: publicIntegration(saved), alerts: publicMetaAlerts(alerts), error: 'O token da Meta não autorizou a consulta. Gere um novo token.' }, 409);
        }
        return json({ error: describeMetaError(error) }, 400);
      }
    }

    return json({ error: 'Ação não reconhecida.' }, 400);
  } catch (error) {
    if (error instanceof PublicError) return json({ error: error.message }, error.status);
    if (error instanceof MetaApiError) return json({ error: describeMetaError(error) }, 400);
    const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
    return json({ error: message }, 400);
  }
});
