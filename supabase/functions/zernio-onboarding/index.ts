import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ZERNIO_API = 'https://zernio.com/api/v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
type JsonRecord = Record<string, any>;

class ZernioRequestError extends Error {
  status: number;
  constructor(status: number) {
    super('Não foi possível concluir a solicitação na Zernio.');
    this.status = status;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashState(state: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(state))));
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptApiKey(ciphertext: string, ownerId: string): Promise<string> {
  const secret = Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) {
    throw new Error('A chave de criptografia da integração não está configurada.');
  }
  const [version, encodedIv, encodedValue] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedValue) {
    throw new Error('A credencial armazenada não pôde ser lida.');
  }
  const keyBytes = Uint8Array.from(secret.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encodedIv), additionalData: encoder.encode(ownerId) },
    cryptoKey,
    fromBase64(encodedValue),
  );
  return decoder.decode(clear);
}

async function zernioRequest(path: string, apiKey: string, method = 'GET'): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Não foi possível conectar à Zernio. Tente novamente.');
  }
  if (!response.ok && response.status !== 404) throw new ZernioRequestError(response.status);
  if (response.status === 404) return { __notFound: true };
  if (method === 'DELETE') return {};
  try {
    return await response.json();
  } catch {
    throw new Error('A Zernio retornou uma resposta inesperada.');
  }
}

function arrays(payload: JsonRecord, key: string): JsonRecord[] {
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  return [];
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const object = value as JsonRecord;
    return object._id ?? object.id ?? null;
  }
  return null;
}

function publicIntegration(row: JsonRecord | null) {
  if (!row) return { hasApiKey: false, keyStatus: 'missing', keyLast4: null, profile: null, account: null };
  return {
    hasApiKey: Boolean(row.api_key_ciphertext),
    keyStatus: row.key_status,
    keyLast4: row.api_key_last4?.trim() || null,
    profile: row.zernio_profile_id ? { id: row.zernio_profile_id, name: row.zernio_profile_name } : null,
    account: row.whatsapp_account_id ? {
      id: row.whatsapp_account_id,
      name: row.whatsapp_account_name,
      phoneNumber: row.whatsapp_phone_number,
    } : null,
  };
}

function callbackMessage(errorCode: string): { status: 'cancelled' | 'failed'; message: string } {
  switch (errorCode) {
    case 'connection_cancelled':
    case 'oauth_denied':
      return { status: 'cancelled', message: 'A conexão foi cancelada. Nenhum canal foi alterado.' };
    case 'one_whatsapp_per_profile':
      return { status: 'failed', message: 'Este perfil já possui um canal WhatsApp. Reconecte o canal existente ou escolha outro perfil.' };
    case 'whatsapp_number_already_connected':
      return { status: 'failed', message: 'Este número já está conectado a outra conta ou equipe Zernio.' };
    case 'whatsapp_number_pinned_to_profile':
      return { status: 'failed', message: 'Este número pertence a outro perfil Zernio. Selecione o perfil ao qual ele está vinculado.' };
    case 'payment_required':
      return { status: 'failed', message: 'A Zernio solicitou uma configuração de cobrança antes de conectar o WhatsApp.' };
    case 'session_expired':
    case 'invalid_state':
      return { status: 'failed', message: 'A sessão de conexão expirou. Inicie o onboarding novamente.' };
    default:
      return { status: 'failed', message: 'A Meta ou a Zernio não concluiu a conexão. Revise os dados e tente novamente.' };
  }
}

function zernioErrorResponse(error: ZernioRequestError): { message: string; status: number } {
  if (error.status === 401 || error.status === 403) {
    return { message: 'A chave Zernio não autorizou esta operação. Valide-a nas Configurações.', status: 400 };
  }
  if (error.status === 402) {
    return { message: 'A conta Zernio precisa resolver uma pendência de cobrança antes de continuar.', status: 400 };
  }
  if (error.status === 409) {
    return { message: 'A Zernio encontrou um conflito com este perfil ou número. Confira a mensagem e tente novamente.', status: 400 };
  }
  if (error.status === 429) {
    return { message: 'A Zernio limitou temporariamente as consultas. Aguarde e tente novamente.', status: 429 };
  }
  if (error.status >= 500) {
    return { message: 'A Zernio está temporariamente indisponível. Tente novamente.', status: 503 };
  }
  return { message: 'A Zernio recusou a solicitação de conexão.', status: 400 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: JsonRecord, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  let claimedSessionId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

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

    admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: owner, error: ownerError } = await admin
      .from('usuarios').select('role, ativo').eq('id', user.id).maybeSingle();
    if (ownerError || owner?.role !== 'locador' || owner.ativo !== true) {
      return json({ error: 'Esta operação está disponível para contas ativas de locador.' }, 403);
    }

    const { action, onboardingMode, profileId, sgaState, connected, accountId, callbackProfileId, callbackError, platform } = await req.json();
    const { data: integration, error: integrationError } = await admin
      .from('zernio_integracoes')
      .select('*')
      .eq('id_usuario', user.id)
      .maybeSingle();
    if (integrationError || !integration?.api_key_ciphertext || integration.key_status !== 'valid') {
      return json({ error: 'Valide uma chave Zernio nas Configurações antes de conectar o WhatsApp.' }, 409);
    }
    const apiKey = await decryptApiKey(integration.api_key_ciphertext, user.id);

    if (action === 'start') {
      if (!['api', 'business_app'].includes(onboardingMode)) {
        return json({ error: 'Escolha explicitamente o modo de conexão do WhatsApp.' }, 400);
      }
      const requestedProfileId = profileId || integration.zernio_profile_id;
      if (typeof requestedProfileId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(requestedProfileId)) {
        return json({ error: 'Atualize a lista e escolha um perfil Zernio.' }, 400);
      }
      if (integration.whatsapp_account_id && requestedProfileId !== integration.zernio_profile_id) {
        return json({ error: 'Desconecte o canal atual antes de iniciar a conexão em outro perfil.' }, 409);
      }

      const profilePayload = await zernioRequest('/profiles', apiKey);
      const availableProfile = arrays(profilePayload, 'profiles').find((item) => idOf(item) === requestedProfileId);
      if (!availableProfile) return json({ error: 'O perfil não está disponível para esta chave Zernio. Atualize a lista.' }, 400);

      const baseUrl = Deno.env.get('ZERNIO_REDIRECT_BASE_URL') ?? '';
      let callbackUrl: URL;
      try {
        const configuredUrl = new URL(baseUrl);
        const localDevelopment = ['localhost', '127.0.0.1'].includes(configuredUrl.hostname);
        const secureOrigin = configuredUrl.protocol === 'https:' || (localDevelopment && configuredUrl.protocol === 'http:');
        if (!secureOrigin || configuredUrl.search || configuredUrl.hash || configuredUrl.username || configuredUrl.password) {
          throw new Error('invalid');
        }
        callbackUrl = new URL('/zernio/callback', configuredUrl.origin);
      } catch {
        return json({ error: 'Configure ZERNIO_REDIRECT_BASE_URL com o domínio HTTPS do SGA.' }, 500);
      }

      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const state = toBase64Url(randomBytes);
      const stateHash = await hashState(state);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 70 * 60 * 1000).toISOString();

      await admin.from('zernio_onboarding_sessions').update({
        status: 'cancelled', callback_error: 'superseded', completed_at: now.toISOString(),
      }).eq('id_usuario', user.id)
        .eq('zernio_profile_id', requestedProfileId)
        .eq('status', 'pending');

      const { data: session, error: sessionError } = await admin
        .from('zernio_onboarding_sessions')
        .insert({
          id_usuario: user.id,
          state_hash: stateHash,
          zernio_profile_id: requestedProfileId,
          onboarding_mode: onboardingMode,
          expires_at: expiresAt,
        })
        .select('id')
        .single();
      if (sessionError || !session) throw new Error('Não foi possível iniciar a sessão de onboarding.');

      callbackUrl.searchParams.set('sga_state', state);
      const query = new URLSearchParams({
        profileId: requestedProfileId,
        redirect_url: callbackUrl.toString(),
        onboarding: onboardingMode,
      });
      let connectPayload: JsonRecord;
      try {
        connectPayload = await zernioRequest(`/connect/whatsapp?${query.toString()}`, apiKey);
      } catch (error) {
        await admin.from('zernio_onboarding_sessions').update({
          status: 'failed', callback_error: 'connect_url_failed', completed_at: new Date().toISOString(),
        }).eq('id', session.id);
        throw error;
      }
      const authUrl = connectPayload.authUrl;
      let authHost = '';
      try { authHost = new URL(authUrl).hostname; } catch { /* invalid provider URL */ }
      if (typeof authUrl !== 'string' || !authUrl.startsWith('https://') ||
          !(authHost === 'facebook.com' || authHost.endsWith('.facebook.com'))) {
        await admin.from('zernio_onboarding_sessions').update({
          status: 'failed', callback_error: 'invalid_connect_url', completed_at: new Date().toISOString(),
        }).eq('id', session.id);
        throw new Error('A Zernio não retornou um endereço de conexão válido.');
      }
      return json({ authUrl, expiresAt, onboardingMode });
    }

    if (action === 'complete') {
      if (typeof sgaState !== 'string' || sgaState.length < 40 || sgaState.length > 100) {
        return json({ error: 'O estado de retorno está ausente ou inválido. Inicie a conexão novamente.' }, 400);
      }
      const stateHash = await hashState(sgaState);
      const { data: session, error: sessionError } = await admin
        .from('zernio_onboarding_sessions')
        .select('id, zernio_profile_id, onboarding_mode, status, expires_at')
        .eq('id_usuario', user.id)
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (sessionError || !session) return json({ error: 'Este retorno não pertence à sua sessão. Inicie o onboarding pelo SGA.' }, 403);

      if (session.status === 'completed' && callbackProfileId === session.zernio_profile_id) {
        const { data: current } = await admin.from('zernio_integracoes')
          .select('*').eq('id_usuario', user.id).maybeSingle();
        if (current?.whatsapp_account_id && current.whatsapp_account_id === accountId) {
          return json({ outcome: 'completed', integration: publicIntegration(current) });
        }
      }
      if (session.status !== 'pending' || new Date(session.expires_at).getTime() <= Date.now()) {
        return json({ error: 'Este estado já foi usado ou expirou. Inicie um novo onboarding.' }, 409);
      }

      const now = new Date().toISOString();
      const { data: claimed, error: claimError } = await admin
        .from('zernio_onboarding_sessions')
        .update({ status: 'processing' })
        .eq('id', session.id)
        .eq('id_usuario', user.id)
        .eq('status', 'pending')
        .gt('expires_at', now)
        .select('id')
        .maybeSingle();
      if (claimError || !claimed) return json({ error: 'Este estado já foi usado ou expirou. Inicie um novo onboarding.' }, 409);
      claimedSessionId = session.id;

      if (typeof callbackError === 'string' && callbackError) {
        const callbackResult = callbackMessage(callbackError);
        await admin.from('zernio_onboarding_sessions').update({
          status: callbackResult.status,
          callback_error: callbackError.slice(0, 80),
          completed_at: new Date().toISOString(),
        }).eq('id', session.id);
        claimedSessionId = null;
        return json({ outcome: callbackResult.status, message: callbackResult.message });
      }
      if (connected !== 'whatsapp' || platform && platform !== 'whatsapp' ||
          callbackProfileId !== session.zernio_profile_id ||
          typeof accountId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(accountId)) {
        throw new Error('O retorno da Meta não corresponde ao perfil e à plataforma esperados. Inicie um novo onboarding.');
      }

      const query = new URLSearchParams({ profileId: session.zernio_profile_id });
      const accountsPayload = await zernioRequest(`/accounts?${query.toString()}`, apiKey);
      const remoteAccount = arrays(accountsPayload, 'accounts').find((account) => {
        if ((account._id ?? account.id) !== accountId || account.platform !== 'whatsapp' || account.isActive === false) return false;
        const remoteProfileId = idOf(account.profileId);
        return !remoteProfileId || remoteProfileId === session.zernio_profile_id;
      });
      if (!remoteAccount) {
        throw new Error('A Zernio ainda não confirmou esse canal no perfil selecionado. Atualize a conexão ou tente novamente.');
      }

      const profilePayload = await zernioRequest('/profiles', apiKey);
      const remoteProfile = arrays(profilePayload, 'profiles')
        .find((item) => idOf(item) === session.zernio_profile_id);
      if (!remoteProfile) throw new Error('O perfil da conexão não está mais acessível por esta chave Zernio.');

      const nowCompleted = new Date().toISOString();
      const phoneNumber = remoteAccount.selectedPhoneNumber ?? remoteAccount.phoneNumber ?? remoteAccount.username ?? null;
      const accountName = remoteAccount.displayName ?? remoteAccount.name ?? remoteAccount.username ?? 'Canal WhatsApp';
      const { data: saved, error: saveError } = await admin
        .from('zernio_integracoes')
        .update({
          key_status: 'valid',
          zernio_profile_id: session.zernio_profile_id,
          zernio_profile_name: remoteProfile.name ?? remoteProfile.displayName ?? 'Perfil Zernio',
          whatsapp_account_id: accountId,
          whatsapp_account_name: accountName,
          whatsapp_phone_number: phoneNumber,
          last_checked_at: nowCompleted,
          updated_at: nowCompleted,
        })
        .eq('id_usuario', user.id)
        .select('*')
        .single();
      if (saveError || !saved) throw new Error('A Meta conectou o número, mas o SGA não conseguiu salvar o canal. Atualize as Configurações.');

      const { error: finishError } = await admin.from('zernio_onboarding_sessions').update({
        status: 'completed', completed_at: nowCompleted, callback_error: null,
      }).eq('id', session.id).eq('status', 'processing');
      if (finishError) throw new Error('O canal foi salvo, mas o SGA não conseguiu fechar a sessão. Atualize as Configurações.');
      claimedSessionId = null;
      return json({ outcome: 'completed', integration: publicIntegration(saved) });
    }

    if (action === 'disconnect') {
      if (!integration.whatsapp_account_id) return json({ integration: publicIntegration(integration) });
      await zernioRequest(
        `/accounts/${encodeURIComponent(integration.whatsapp_account_id)}`,
        apiKey,
        'DELETE',
      );
      const now = new Date().toISOString();
      const { data: disconnected, error } = await admin
        .from('zernio_integracoes')
        .update({
          whatsapp_account_id: null,
          whatsapp_account_name: null,
          whatsapp_phone_number: null,
          last_checked_at: now,
          updated_at: now,
        })
        .eq('id_usuario', user.id)
        .select('*')
        .single();
      if (error || !disconnected) throw new Error('A conta foi removida na Zernio, mas o SGA não atualizou o canal. Recarregue a tela.');
      return json({ integration: publicIntegration(disconnected) });
    }

    return json({ error: 'Ação não reconhecida.' }, 400);
  } catch (error) {
    if (claimedSessionId && admin) {
      await admin.from('zernio_onboarding_sessions').update({
        status: 'failed', callback_error: 'callback_verification_failed', completed_at: new Date().toISOString(),
      }).eq('id', claimedSessionId).eq('status', 'processing');
    }
    if (error instanceof ZernioRequestError) {
      const mapped = zernioErrorResponse(error);
      return json({ error: mapped.message }, mapped.status);
    }
    return json({ error: error instanceof Error ? error.message : 'Não foi possível concluir o onboarding.' }, 400);
  }
});
