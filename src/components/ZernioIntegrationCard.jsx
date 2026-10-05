import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { supabase } from '../services/supabase';

const ZernioIntegrationCard = () => {
  const [integration, setIntegration] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [onboardingMode, setOnboardingMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [channelStatus, setChannelStatus] = useState('checking');

  const selectedProfile = profiles.find((item) => item.id === selectedProfileId);
  const accounts = useMemo(() => selectedProfile?.accounts || [], [selectedProfile]);

  const invoke = useCallback(async (action, payload = {}) => {
    const { data, error } = await supabase.functions.invoke('zernio-integration', {
      body: { action, ...payload },
    });
    if (error) {
      let message = 'Não foi possível falar com o SGA. Tente novamente.';
      try {
        const body = await error.context?.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    invoke('status')
      .then(({ integration: current }) => {
        if (!active) return;
        setIntegration(current);
        setSelectedProfileId(current?.profile?.id || '');
        setSelectedAccountId(current?.account?.id || '');
        if (!current?.hasApiKey) {
          setChannelStatus('no-key');
          return null;
        }
        if (current.keyStatus !== 'valid') {
          setChannelStatus('unverified');
          return null;
        }
        return invoke('refresh').then(({ integration: checked, profiles: currentProfiles }) => {
          if (!active) return;
          setIntegration(checked);
          setProfiles(currentProfiles || []);
          setSelectedProfileId(checked?.profile?.id || '');
          setSelectedAccountId(checked?.account?.id || '');
          const channelFound = Boolean(checked?.profile?.id && checked?.account?.id && (currentProfiles || []).some((item) =>
            item.id === checked.profile.id && (item.accounts || []).some((account) => account.id === checked.account.id)));
          setChannelStatus(channelFound ? 'connected' : 'missing');
        }).catch((error) => {
          if (!active) return;
          setChannelStatus('unverified');
          setErrorMessage(`Não foi possível verificar o canal WhatsApp na Zernio: ${error.message}`);
        });
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [invoke]);

  const refreshProfiles = async () => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const result = await invoke('refresh');
      setIntegration(result.integration);
      setProfiles(result.profiles || []);
      const channelFound = Boolean(result.integration?.profile?.id && result.integration?.account?.id && (result.profiles || []).some((item) =>
        item.id === result.integration.profile.id && (item.accounts || []).some((account) => account.id === result.integration.account.id)));
      setChannelStatus(channelFound ? 'connected' : 'missing');
      setSelectedProfileId(result.integration?.profile?.id || '');
      setSelectedAccountId(result.integration?.account?.id || '');
      setNotice('Perfis e canais atualizados.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const validateAndSaveKey = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const result = await invoke('validate', { apiKey });
      setIntegration(result.integration);
      setProfiles(result.profiles || []);
      setSelectedProfileId('');
      setSelectedAccountId('');
      setChannelStatus('missing');
      setApiKey('');
      setNotice('Chave validada e salva com segurança. Agora selecione o perfil e o canal WhatsApp.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveChannel = async () => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const result = await invoke('select', {
        profileId: selectedProfileId,
        accountId: selectedAccountId,
      });
      setIntegration(result.integration);
      setChannelStatus('connected');
      if (result.webhookWarning) setErrorMessage(result.webhookWarning);
      else setNotice('Perfil e canal WhatsApp vinculados a este locador.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    if (!window.confirm('Remover a chave Zernio e o canal associado a este locador?')) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const result = await invoke('remove');
      setIntegration(result.integration);
      setProfiles([]);
      setSelectedProfileId('');
      setSelectedAccountId('');
      setChannelStatus('no-key');
      setApiKey('');
      setNotice('Chave e canal removidos.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const startOnboarding = async () => {
    if (!selectedProfileId || !onboardingMode) {
      setErrorMessage('Escolha o perfil Zernio e o modo de conexão antes de continuar.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('zernio-onboarding', {
        body: { action: 'start', profileId: selectedProfileId, onboardingMode },
      });
      if (error) {
        let message = 'Não foi possível iniciar o onboarding. Tente novamente.';
        try {
          const body = await error.context?.json();
          if (typeof body?.error === 'string') message = body.error;
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      const authUrl = new URL(data?.authUrl);
      if (authUrl.protocol !== 'https:' || !(authUrl.hostname === 'facebook.com' || authUrl.hostname.endsWith('.facebook.com'))) {
        throw new Error('A Zernio retornou um endereço de conexão inválido.');
      }
      window.location.assign(authUrl.toString());
    } catch (error) {
      setErrorMessage(error.message);
      setBusy(false);
    }
  };

  const disconnectChannel = async () => {
    const confirmed = window.confirm(
      'Desconectar este canal da conta Zernio? O SGA deixará de usá-lo. Se você ativou a coexistência, talvez também precise desconectar o número no WhatsApp Business.'
    );
    if (!confirmed) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('zernio-onboarding', {
        body: { action: 'disconnect' },
      });
      if (error) {
        let message = 'Não foi possível desconectar o canal. Tente novamente.';
        try {
          const body = await error.context?.json();
          if (typeof body?.error === 'string') message = body.error;
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setIntegration(data.integration);
      setSelectedAccountId('');
      setChannelStatus('missing');
      setNotice('Canal desconectado da Zernio. A chave e o perfil foram mantidos.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-slate-700 rounded-xl p-6 flex justify-center">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  const hasKey = integration?.hasApiKey;
  const keyValid = integration?.keyStatus === 'valid';
  const connectionLabel = channelStatus === 'connected'
    ? 'WhatsApp conectado à Zernio'
    : channelStatus === 'checking'
      ? 'Verificando canal WhatsApp…'
      : channelStatus === 'unverified'
        ? 'Não foi possível verificar o canal'
        : hasKey && integration?.account
          ? 'Canal WhatsApp não encontrado na Zernio'
          : 'WhatsApp ainda não conectado';

  return (
    <section className="bg-card border border-slate-700 rounded-xl p-6 shadow-lg space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-widest flex items-center gap-2">
            <MessageCircle size={17} className="text-emerald-400" /> Integração Zernio · WhatsApp
          </h2>
          <p className="text-xs text-slate-400 mt-2">
            Sua chave é validada no servidor e armazenada cifrada. Ela nunca volta para o navegador.
          </p>
        </div>
        {hasKey && (
          <span className={`shrink-0 text-xs font-bold flex items-center gap-1 ${keyValid ? 'text-emerald-400' : 'text-red-400'}`}>
            {keyValid ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {keyValid ? 'Chave válida' : 'Precisa validar'}
          </span>
        )}
      </div>

      <div className={`flex items-center gap-3 rounded-xl border p-4 ${channelStatus === 'connected' ? 'border-emerald-500/30 bg-emerald-500/10' : channelStatus === 'unverified' ? 'border-amber-500/30 bg-amber-500/10' : 'border-slate-700 bg-slate-900/50'}`}>
        {channelStatus === 'connected'
          ? <CheckCircle2 className="shrink-0 text-emerald-400" size={22} />
          : channelStatus === 'checking'
            ? <Loader2 className="shrink-0 animate-spin text-slate-400" size={22} />
            : <XCircle className="shrink-0 text-amber-400" size={22} />}
        <div className="min-w-0">
          <p className={`text-sm font-bold ${channelStatus === 'connected' ? 'text-emerald-300' : channelStatus === 'unverified' ? 'text-amber-300' : 'text-slate-200'}`}>{connectionLabel}</p>
          {channelStatus === 'connected' && <p className="mt-1 truncate text-xs text-slate-300">{integration.profile?.name} · {integration.account?.name}{integration.account?.phoneNumber ? ` · ${integration.account.phoneNumber}` : ''}</p>}
          {channelStatus === 'missing' && <p className="mt-1 text-xs text-slate-400">Selecione um canal disponível ou conclua o onboarding da Meta para conectar o número.</p>}
          {channelStatus === 'unverified' && <p className="mt-1 text-xs text-slate-400">Use “Atualizar lista” para verificar novamente a conexão.</p>}
        </div>
      </div>

      <form onSubmit={validateAndSaveKey} className="space-y-3">
        <label className="block text-xs text-slate-400" htmlFor="zernio-api-key">
          {hasKey ? 'Substituir chave da API' : 'Chave de API do Zernio'}
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="zernio-api-key"
            type="password"
            autoComplete="new-password"
            spellCheck="false"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk_…"
            className="flex-1 min-w-0 bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-accent font-mono text-sm"
          />
          <button
            type="submit"
            disabled={busy || !apiKey.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
            Validar e salvar
          </button>
        </div>
        {hasKey && <p className="text-[11px] text-slate-500">Chave cadastrada terminada em •••• {integration.keyLast4}</p>}
      </form>

      {hasKey && (
        <div className="border-t border-slate-800 pt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Perfil e canal WhatsApp</h3>
              {integration.profile && integration.account ? (
                <p className="text-xs text-slate-400 mt-1">
                  {integration.profile.name} · {integration.account.name}
                  {integration.account.phoneNumber ? ` · ${integration.account.phoneNumber}` : ''}
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">Nenhum canal WhatsApp foi selecionado.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={refreshProfiles}
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-2"
              >
                {busy ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                Atualizar lista
              </button>
              <button
                type="button"
                onClick={removeKey}
                disabled={busy}
                title="Remover chave"
                className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-300 text-xs font-semibold flex items-center gap-2"
              >
                <Trash2 size={15} /> Remover
              </button>
            </div>
          </div>

          {profiles.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1" htmlFor="zernio-profile">Perfil Zernio</label>
                <select
                  id="zernio-profile"
                  value={selectedProfileId}
                  onChange={(event) => {
                    setSelectedProfileId(event.target.value);
                    setSelectedAccountId('');
                  }}
                  className="w-full bg-input border border-slate-600 rounded-lg px-3 py-2.5 text-white outline-none focus:border-accent"
                >
                  <option value="">Selecione um perfil</option>
                  {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1" htmlFor="zernio-account">Canal WhatsApp</label>
                <select
                  id="zernio-account"
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  disabled={!selectedProfileId || accounts.length === 0}
                  className="w-full bg-input border border-slate-600 rounded-lg px-3 py-2.5 text-white outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value="">{selectedProfileId ? 'Selecione um canal' : 'Selecione um perfil primeiro'}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.phoneNumber ? ` · ${account.phoneNumber}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {profiles.length > 0 && selectedProfileId && accounts.length === 0 && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              Este perfil ainda não tem canal WhatsApp conectado. Selecione um modo abaixo para iniciar o onboarding da Meta.
            </p>
          )}

          {profiles.length === 0 && keyValid && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              A chave foi aceita, mas não há perfis disponíveis. Crie ou libere um perfil na conta Zernio e atualize a lista.
            </p>
          )}

          {profiles.length > 0 && (
            <button
              type="button"
              onClick={saveChannel}
              disabled={busy || !selectedProfileId || !selectedAccountId}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-bold text-sm"
            >
              Vincular perfil e canal
            </button>
          )}

          {keyValid && (
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {integration.account ? 'Reconectar WhatsApp' : 'Conectar WhatsApp pela Meta'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Você será direcionado ao onboarding da Meta e retornará ao SGA ao finalizar.
                </p>
              </div>

              <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <legend className="sr-only">Modo de conexão</legend>
                <label className={`cursor-pointer rounded-lg border p-3 ${onboardingMode === 'api' ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/30'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <input type="radio" name="zernio-onboarding-mode" value="api" checked={onboardingMode === 'api'} onChange={() => setOnboardingMode('api')} />
                    API Cloud
                  </span>
                  <span className="block text-xs text-slate-400 mt-2">O número passa a operar pela API. Não mantém o uso diário pelo aplicativo WhatsApp Business.</span>
                </label>
                <label className={`cursor-pointer rounded-lg border p-3 ${onboardingMode === 'business_app' ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/30'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <input type="radio" name="zernio-onboarding-mode" value="business_app" checked={onboardingMode === 'business_app'} onChange={() => setOnboardingMode('business_app')} />
                    Manter o WhatsApp Business
                  </span>
                  <span className="block text-xs text-slate-400 mt-2">Coexistência: o número continua no app e a Meta pedirá leitura de QR. Há limites de recursos e velocidade.</span>
                </label>
              </fieldset>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startOnboarding}
                  disabled={busy || !selectedProfileId || !onboardingMode}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2"
                >
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <MessageCircle size={16} />}
                  {integration.account ? 'Iniciar reconexão' : 'Iniciar conexão Meta'}
                </button>
                {integration.account && (
                  <button
                    type="button"
                    onClick={disconnectChannel}
                    disabled={busy}
                    className="bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-300 px-4 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2"
                  >
                    <Trash2 size={15} /> Desconectar canal
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {(errorMessage || notice) && (
        <p className={`text-xs rounded-lg p-3 ${errorMessage ? 'text-red-300 bg-red-500/10 border border-red-500/20' : 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'}`}>
          {errorMessage || notice}
        </p>
      )}
    </section>
  );
};

export default ZernioIntegrationCard;
