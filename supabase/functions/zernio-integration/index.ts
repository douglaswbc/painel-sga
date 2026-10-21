import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import { activateProvider, publicIntegration } from '../_shared/whatsapp-provider.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ZERNIO_API = 'https://zernio.com/api/v1';

type JsonRecord = Record<string, any>;
type ZernioProfile = { id: string; name: string; accounts: ZernioAccount[] };
type ZernioAccount = {
  id: string;
  name: string;
  phoneNumber: string | null;
  active: boolean;
};

class ZernioRequestError extends Error {
  status: number;
  constructor(status: number) {
    super('Não foi possível validar a chave na Zernio. Confira a chave e tente novamente.');
    this.status = status;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptApiKey(apiKey: string, ownerId: string): Promise<string> {
  return encryptSecret(apiKey, ownerId, 'zernio');
}

async function decryptApiKey(ciphertext: string, ownerId: string): Promise<string> {
  return decryptSecret(ciphertext, ownerId);
}

async function zernioGet(path: string, apiKey: string): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Não foi possível conectar à Zernio agora. Tente novamente.');
  }

  if (!response.ok) throw new ZernioRequestError(response.status);
  try {
    return await response.json();
  } catch {
    throw new Error('A Zernio retornou uma resposta inesperada.');
  }
}

async function zernioWrite(path: string, apiKey: string, method: 'POST' | 'PUT', body: JsonRecord): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${ZERNIO_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Não foi possível configurar o webhook Zernio agora.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ZernioRequestError(response.status);
  return payload;
}

function newWebhookSecret(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function provisionLockWebhook(admin: any, integration: JsonRecord, apiKey: string, ownerId: string, accountId: string) {
  const secret = newWebhookSecret();
  const url = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1/webhook-fechadura`;
  const body: JsonRecord = {
    name: `SGA lock access ${ownerId}`,
    url,
    secret,
    events: ['message.received'],
    accountIds: [accountId],
  };
  const method = integration.webhook_id ? 'PUT' : 'POST';
  if (integration.webhook_id) body.webhookId = integration.webhook_id;
  const payload = await zernioWrite('/webhooks/settings', apiKey, method, body);
  const webhook = payload.webhook ?? payload.data?.webhook;
  const webhookId = webhook?._id ?? webhook?.id ?? integration.webhook_id;
  if (typeof webhookId !== 'string' || !webhookId) throw new Error('A Zernio não retornou a identificação do webhook.');
  const ciphertext = await encryptApiKey(secret, ownerId);
  const { error } = await admin.from('zernio_integracoes').update({
    webhook_id: webhookId,
    webhook_secret_ciphertext: ciphertext,
    webhook_account_id: accountId,
    updated_at: new Date().toISOString(),
  }).eq('id_usuario', ownerId);
  if (error) throw new Error('O webhook foi criado na Zernio, mas não foi possível salvar sua configuração no SGA.');
}

function arrayAt(payload: JsonRecord, key: string): JsonRecord[] {
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  return [];
}

function normalizeProfile(profile: JsonRecord): Omit<ZernioProfile, 'accounts'> | null {
  const id = profile?._id ?? profile?.id;
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) return null;
  return { id, name: String(profile.name ?? profile.displayName ?? 'Perfil Zernio') };
}

function normalizeAccount(account: JsonRecord): ZernioAccount | null {
  const id = account?._id ?? account?.id;
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) return null;
  const meta = account.metadata ?? account.platformSpecificData?.whatsapp ?? {};
  return {
    id,
    name: String(account.displayName ?? account.name ?? account.username ?? 'Canal WhatsApp'),
    phoneNumber: account.phoneNumber ?? meta.phoneNumber ?? account.username ?? null,
    active: account.isActive !== false,
  };
}

async function getProfilesAndWhatsAppAccounts(apiKey: string): Promise<ZernioProfile[]> {
  const profilePayload = await zernioGet('/profiles', apiKey);
  const profiles = arrayAt(profilePayload, 'profiles')
    .map(normalizeProfile)
    .filter((profile): profile is Omit<ZernioProfile, 'accounts'> => Boolean(profile));

  return await Promise.all(profiles.map(async (profile) => {
    const query = new URLSearchParams({ profileId: profile.id });
    const accountsPayload = await zernioGet(`/accounts?${query.toString()}`, apiKey);
    const accounts = arrayAt(accountsPayload, 'accounts')
      .filter((account) => account.platform === 'whatsapp')
      .map(normalizeAccount)
      .filter((account): account is ZernioAccount => Boolean(account));
    return { ...profile, accounts };
  }));
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Sessão inválida ou expirada.' }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userProfile, error: profileError } = await admin
      .from('usuarios')
      .select('role, ativo')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || userProfile?.role !== 'locador' || userProfile.ativo !== true) {
      return json({ error: 'Esta integração está disponível para contas ativas de locador.' }, 403);
    }

    const { action, apiKey, profileId, accountId } = await req.json();
    const { data: integration, error: integrationError } = await admin
      .from('zernio_integracoes')
      .select('*')
      .eq('id_usuario', user.id)
      .maybeSingle();
    if (integrationError) throw new Error('Não foi possível carregar a integração.');

    if (action === 'status') return json({ integration: publicIntegration(integration) });

    if (action === 'activate') {
      if (!integration?.api_key_ciphertext || integration?.key_status !== 'valid' || !integration?.whatsapp_account_id) {
        return json({ error: 'Conecte um canal da Zernio antes de usá-lo como canal principal.' }, 409);
      }
      await activateProvider(admin, user.id, 'zernio');
      const { data: updated } = await admin
        .from('zernio_integracoes').select('*').eq('id_usuario', user.id).maybeSingle();
      return json({ integration: publicIntegration(updated) });
    }

    if (action === 'remove') {
      // Only the Zernio payload is cleared: the row is shared with the Meta
      // provider and deleting it would drop the other credentials.
      const keepMeta = Boolean(integration?.meta_access_token_ciphertext) && integration?.meta_phone_number_id;
      const now = new Date().toISOString();
      const { error } = await admin.from('zernio_integracoes').update({
        api_key_ciphertext: null,
        api_key_last4: null,
        key_status: null,
        zernio_profile_id: null,
        zernio_profile_name: null,
        whatsapp_account_id: null,
        whatsapp_account_name: null,
        whatsapp_phone_number: null,
        webhook_id: null,
        webhook_secret_ciphertext: null,
        webhook_account_id: null,
        provider: integration?.provider === 'zernio' && keepMeta ? 'meta' : (integration?.provider ?? 'zernio'),
        provider_connected_at: integration?.provider === 'zernio'
          ? (keepMeta ? now : null)
          : (integration?.provider_connected_at ?? null),
        updated_at: now,
      }).eq('id_usuario', user.id);
      if (error) throw new Error('Não foi possível remover a chave Zernio.');
      const { data: updated } = await admin
        .from('zernio_integracoes').select('*').eq('id_usuario', user.id).maybeSingle();
      return json({ integration: publicIntegration(updated) });
    }

    if (action === 'validate') {
      if (typeof apiKey !== 'string' || !/^sk_[a-fA-F0-9]{64}$/.test(apiKey.trim())) {
        return json({ error: 'A chave precisa estar no formato sk_ seguido de 64 caracteres hexadecimais.' }, 400);
      }
      const cleanApiKey = apiKey.trim();
      const profiles = await getProfilesAndWhatsAppAccounts(cleanApiKey);
      const ciphertext = await encryptApiKey(cleanApiKey, user.id);
      const now = new Date().toISOString();
      const { data: saved, error } = await admin
        .from('zernio_integracoes')
        .upsert({
          id_usuario: user.id,
          api_key_ciphertext: ciphertext,
          api_key_last4: cleanApiKey.slice(-4),
          key_status: 'valid',
          zernio_profile_id: null,
          zernio_profile_name: null,
          whatsapp_account_id: null,
          whatsapp_account_name: null,
          whatsapp_phone_number: null,
          validated_at: now,
          last_checked_at: now,
          updated_at: now,
        }, { onConflict: 'id_usuario' })
        .select('*')
        .single();
      if (error || !saved) throw new Error('A chave foi validada, mas não foi possível salvá-la. Tente novamente.');
      return json({ integration: publicIntegration(saved), profiles });
    }

    if (!integration?.api_key_ciphertext) {
      return json({ error: 'Cadastre e valide uma chave Zernio primeiro.' }, 409);
    }
    const savedApiKey = await decryptApiKey(integration.api_key_ciphertext, user.id);

    if (action === 'refresh') {
      try {
        const profiles = await getProfilesAndWhatsAppAccounts(savedApiKey);
        const now = new Date().toISOString();
        const { data: updated, error } = await admin
          .from('zernio_integracoes')
          .update({ key_status: 'valid', last_checked_at: now, updated_at: now })
          .eq('id_usuario', user.id)
          .select('*')
          .single();
        if (error) throw new Error('Não foi possível atualizar o estado da integração.');
        return json({ integration: publicIntegration(updated), profiles });
      } catch (error) {
        if (error instanceof ZernioRequestError && [401, 403].includes(error.status)) {
          await admin.from('zernio_integracoes').update({
            key_status: 'invalid',
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id_usuario', user.id);
        }
        throw error;
      }
    }

    if (action === 'select') {
      if (typeof profileId !== 'string' || typeof accountId !== 'string') {
        return json({ error: 'Selecione um perfil e um canal WhatsApp.' }, 400);
      }
      const profiles = await getProfilesAndWhatsAppAccounts(savedApiKey);
      const selectedProfile = profiles.find((profile) => profile.id === profileId);
      const selectedAccount = selectedProfile?.accounts.find((account) => account.id === accountId && account.active);
      if (!selectedProfile || !selectedAccount) {
        return json({ error: 'Esse canal não está disponível para a chave e o perfil selecionados. Atualize a lista e tente novamente.' }, 400);
      }
      const now = new Date().toISOString();
      const { data: updated, error } = await admin
        .from('zernio_integracoes')
        .update({
          zernio_profile_id: selectedProfile.id,
          zernio_profile_name: selectedProfile.name,
          whatsapp_account_id: selectedAccount.id,
          whatsapp_account_name: selectedAccount.name,
          whatsapp_phone_number: selectedAccount.phoneNumber,
          last_checked_at: now,
          updated_at: now,
        })
        .eq('id_usuario', user.id)
        .select('*')
        .single();
      if (error) throw new Error('Não foi possível salvar o canal selecionado.');
      let webhookWarning: string | null = null;
      try {
        await provisionLockWebhook(admin, integration, savedApiKey, user.id, selectedAccount.id);
      } catch (webhookError) {
        webhookWarning = webhookError instanceof Error
          ? `Canal salvo; o webhook das fechaduras ainda não foi configurado: ${webhookError.message}`
          : 'Canal salvo; o webhook das fechaduras ainda não foi configurado.';
      }
      return json({ integration: publicIntegration(updated), webhookWarning });
    }

    return json({ error: 'Ação não reconhecida.' }, 400);
  } catch (error) {
    if (error instanceof ZernioRequestError) {
      const message = error.status === 401 || error.status === 403
        ? 'A chave Zernio é inválida ou não tem permissão para listar perfis e canais.'
        : error.status === 429
          ? 'A Zernio limitou temporariamente as consultas. Aguarde e tente novamente.'
          : error.status >= 500
            ? 'A Zernio está temporariamente indisponível. Tente novamente.'
            : 'Não foi possível consultar perfis e canais na Zernio.';
      return json({ error: message }, error.status === 401 ? 401 : 400);
    }
    const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
    return json({ error: message }, 400);
  }
});
