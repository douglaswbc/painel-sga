import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Loader2, MessageCircle, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { supabase } from '../services/supabase';

let sdkPromise = null;

const loadFacebookSdk = (appId, graphVersion) => {
  if (window.FB) {
    window.FB.init({ appId, xfbml: false, version: graphVersion });
    return Promise.resolve(window.FB);
  }
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        sdkPromise = null;
        reject(new Error('O SDK da Meta carregou, mas não ficou disponível. Recarregue a página e tente novamente.'));
        return;
      }
      window.FB.init({ appId, xfbml: false, version: graphVersion });
      resolve(window.FB);
    };
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Não foi possível carregar o SDK da Meta. Verifique a conexão e bloqueadores de anúncios.'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
};

const MetaIntegrationCard = () => {
  const [app, setApp] = useState(null);
  const [integration, setIntegration] = useState(null);
  const [mode, setMode] = useState('signup');
  const [pin, setPin] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  const invoke = useCallback(async (action, payload = {}) => {
    const { data, error } = await supabase.functions.invoke('meta-integration', {
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
      .then((data) => {
        if (!active) return;
        setApp(data.app || null);
        setIntegration(data.integration || null);
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [invoke]);

  const meta = integration?.meta || {};
  const isConnected = meta.status === 'connected';
  const hasToken = Boolean(meta.hasToken);
  const isActiveProvider = integration?.provider === 'meta';

  const connectWithMeta = async () => {
    if (!/^\d{6}$/.test(pin)) {
      setErrorMessage('Informe o PIN de 6 dígitos da verificação em duas etapas do WhatsApp.');
      return;
    }
    if (!app?.appId || !app?.configurationId) {
      setErrorMessage('O aplicativo da Meta ainda não foi configurado no SGA. Informe o App ID e o Configuration ID nos secrets do Supabase.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const sdk = await loadFacebookSdk(app.appId, app.graphVersion || 'v23.0');
      const code = await new Promise((resolve, reject) => {
        sdk.login((response) => {
          if (!response || !response.authResponse) {
            reject(new Error('A conexão com a Meta foi cancelada. Nenhuma alteração foi feita.'));
            return;
          }
          if (!response.authResponse.code) {
            reject(new Error('A Meta não devolveu o código de conexão. Tente novamente.'));
            return;
          }
          resolve(response.authResponse.code);
        }, {
          config_id: app.configurationId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: { sessionInfoVersion: '3' } },
        });
      });

      const data = await invoke('complete_signup', { code, pin });
      if (data?.needsSelection) {
        setCandidates(data.candidates || []);
        setNotice('A conta da Meta tem mais de um número. Escolha qual conectar ao SGA.');
        return;
      }
      setIntegration(data.integration);
      setPin('');
      setCandidates([]);
      setNotice(data.warning || 'WhatsApp conectado à Meta e definido como canal principal.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveManualToken = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('validate_manual', { accessToken, phoneNumberId, wabaId });
      setIntegration(data.integration);
      setAccessToken('');
      setNotice('Credencial da Meta validada e salva. O canal já está em uso pelo SGA.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const chooseNumber = async (candidate) => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('select_number', {
        phoneNumberId: candidate.phoneNumberId,
        wabaId: candidate.wabaId,
        pin,
      });
      setIntegration(data.integration);
      setCandidates([]);
      setPin('');
      setNotice(data.warning || 'Número da Meta conectado e definido como canal principal.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshStatus = async () => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('refresh');
      setIntegration(data.integration);
      setNotice('Status do canal Meta atualizado.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const registerNumber = async () => {
    if (!/^\d{6}$/.test(pin)) {
      setErrorMessage('Informe o PIN de 6 dígitos da verificação em duas etapas do WhatsApp.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('register', { pin });
      setIntegration(data.integration);
      setPin('');
      setNotice('Número registrado na Meta com sucesso.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Desconectar o canal da Meta? A credencial será removida do SGA.')) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('disconnect');
      setIntegration(data.integration);
      setCandidates([]);
      setNotice('Canal da Meta desconectado.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('activate', { provider: 'meta' });
      setIntegration(data.integration);
      setNotice('A Meta agora é o canal de WhatsApp usado pelo SGA.');
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

  const statusLabel = isConnected
    ? 'WhatsApp conectado à Meta'
    : meta.status === 'valid'
      ? 'Credencial Meta salva, número ainda não registrado'
      : meta.status === 'invalid'
        ? 'O token da Meta não foi aceito'
        : 'WhatsApp ainda não conectado à Meta';

  const statusTone = isConnected
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : meta.status === 'invalid'
      ? 'border-red-500/30 bg-red-500/10'
      : meta.status === 'valid'
        ? 'border-amber-500/30 bg-amber-500/10'
        : 'border-slate-700 bg-slate-900/50';

  return (
    <section className="bg-card border border-slate-700 rounded-xl p-6 shadow-lg space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-widest flex items-center gap-2">
            <Cloud size={17} className="text-indigo-400" /> Integração Meta · WhatsApp Cloud API
          </h2>
          <p className="text-xs text-slate-400 mt-2">
            Use a API oficial da Meta. O token é validado no servidor e fica cifrado; ele nunca volta para o navegador.
          </p>
        </div>
        {hasToken && (
          <span className={`shrink-0 text-xs font-bold flex items-center gap-1 ${isConnected ? 'text-emerald-400' : meta.status === 'invalid' ? 'text-red-400' : 'text-amber-400'}`}>
            {isConnected ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {isConnected ? 'Canal ativo' : meta.status === 'invalid' ? 'Token inválido' : 'Pendente'}
          </span>
        )}
      </div>

      <div className={`flex items-center gap-3 rounded-xl border p-4 ${statusTone}`}>
        {isConnected
          ? <CheckCircle2 className="shrink-0 text-emerald-400" size={22} />
          : meta.status === 'invalid'
            ? <XCircle className="shrink-0 text-red-400" size={22} />
            : <Cloud className="shrink-0 text-slate-400" size={22} />}
        <div className="min-w-0">
          <p className={`text-sm font-bold ${isConnected ? 'text-emerald-300' : meta.status === 'invalid' ? 'text-red-300' : 'text-slate-200'}`}>{statusLabel}</p>
          {isConnected && (
            <p className="mt-1 truncate text-xs text-slate-300">
              {meta.displayPhoneNumber || 'Número não informado'}
              {meta.verifiedName ? ` · ${meta.verifiedName}` : ''}
            </p>
          )}
          {meta.status === 'valid' && (
            <p className="mt-1 text-xs text-slate-400">Registre o número na Meta para habilitá-lo no SGA.</p>
          )}
          {meta.status === 'invalid' && (
            <p className="mt-1 text-xs text-slate-400">Gere um novo token do sistema e salve novamente.</p>
          )}
        </div>
      </div>

      {isConnected && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Phone Number ID</p>
            <p className="mt-1 font-mono text-xs text-slate-200 break-all">{meta.phoneNumberId || '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">WABA ID</p>
            <p className="mt-1 font-mono text-xs text-slate-200 break-all">{meta.wabaId || '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Qualidade</p>
            <p className="mt-1 text-xs text-slate-200">{meta.qualityRating || '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Nome / limite</p>
            <p className="mt-1 text-xs text-slate-200">{meta.nameStatus || '—'} · {meta.messagingLimitTier || '—'}</p>
          </div>
        </div>
      )}

      {isConnected && !isActiveProvider && (
        <p className="text-xs rounded-lg p-3 text-amber-300 bg-amber-500/10 border border-amber-500/20">
          O canal em uso pelo SGA é a Zernio. Use o botão abaixo para passar a enviar pela Meta.
        </p>
      )}

      {candidates.length > 0 && (
        <div className="border-t border-slate-800 pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">Escolha o número do WhatsApp</h3>
          <div className="grid gap-2">
            {candidates.map((candidate) => (
              <button
                key={`${candidate.wabaId}-${candidate.phoneNumberId}`}
                type="button"
                disabled={busy}
                onClick={() => chooseNumber(candidate)}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/30 px-4 py-3 text-left hover:border-indigo-400 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-100">{candidate.displayPhoneNumber || candidate.phoneNumberId}</span>
                  <span className="block text-xs text-slate-400">{candidate.verifiedName || 'Nome não informado'}</span>
                </span>
                <span className="text-xs text-indigo-400">Conectar</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">O PIN informado abaixo é usado para registrar o número na Meta.</p>
        </div>
      )}

      {(!isConnected || candidates.length > 0) && (
        <div className="border-t border-slate-800 pt-4 space-y-4">
          <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <legend className="sr-only">Modo de conexão com a Meta</legend>
            <label className={`cursor-pointer rounded-lg border p-3 ${mode === 'signup' ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/30'}`}>
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <input type="radio" name="meta-connection-mode" value="signup" checked={mode === 'signup'} onChange={() => setMode('signup')} />
                Conectar pela Meta
              </span>
              <span className="block text-xs text-slate-400 mt-2">
                Você será direcionado ao cadastro da Meta e voltará ao SGA ao concluir. Precisa de um App Meta configurado no SGA.
              </span>
            </label>
            <label className={`cursor-pointer rounded-lg border p-3 ${mode === 'manual' ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/30'}`}>
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <input type="radio" name="meta-connection-mode" value="manual" checked={mode === 'manual'} onChange={() => setMode('manual')} />
                Token e número manuais
              </span>
              <span className="block text-xs text-slate-400 mt-2">
                Informe um token do sistema, o Phone Number ID e o WABA ID gerados no Meta Business.
              </span>
            </label>
          </fieldset>

          {mode === 'signup' ? (
            <div className="space-y-3">
              <label className="block text-xs text-slate-400" htmlFor="meta-pin">
                PIN de 6 dígitos da verificação em duas etapas
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  id="meta-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="flex-1 min-w-0 bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-accent font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={connectWithMeta}
                  disabled={busy || !/^\d{6}$/.test(pin)}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
                  Conectar com a Meta
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                O PIN é enviado à Meta no registro do número e não é guardado pelo SGA. Guarde-o: ele será pedido pelo aplicativo WhatsApp.
              </p>
            </div>
          ) : (
            <form onSubmit={saveManualToken} className="space-y-3">
              <label className="block text-xs text-slate-400" htmlFor="meta-access-token">
                Token de acesso do sistema
              </label>
              <input
                id="meta-access-token"
                type="password"
                autoComplete="new-password"
                spellCheck="false"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="EAA…"
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-accent font-mono text-sm"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1" htmlFor="meta-phone-number-id">Phone Number ID</label>
                  <input
                    id="meta-phone-number-id"
                    value={phoneNumberId}
                    onChange={(event) => setPhoneNumberId(event.target.value.replace(/\D/g, ''))}
                    placeholder="106540352242922"
                    className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-accent font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1" htmlFor="meta-waba-id">WABA ID</label>
                  <input
                    id="meta-waba-id"
                    value={wabaId}
                    onChange={(event) => setWabaId(event.target.value.replace(/\D/g, ''))}
                    placeholder="102290129340398"
                    className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-accent font-mono text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy || !accessToken || !phoneNumberId || !wabaId}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
                Validar e salvar
              </button>
            </form>
          )}
        </div>
      )}

      {meta.status === 'valid' && !candidates.length && (
        <div className="border-t border-slate-800 pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">Registrar o número na Meta</h3>
          <p className="text-xs text-slate-400">
            O número já está vinculado ao SGA, mas a Meta ainda não o habilitou para a API. Informe o PIN de 6 dígitos para concluir.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="flex-1 min-w-0 bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-accent font-mono text-sm"
            />
            <button
              type="button"
              onClick={registerNumber}
              disabled={busy || !/^\d{6}$/.test(pin)}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
              Registrar número
            </button>
          </div>
        </div>
      )}

      {(hasToken || isConnected) && (
        <div className="border-t border-slate-800 pt-4 flex flex-wrap gap-2">
          {isConnected && !isActiveProvider && (
            <button
              type="button"
              onClick={activate}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2"
            >
              <MessageCircle size={16} /> Usar este canal
            </button>
          )}
          <button
            type="button"
            onClick={refreshStatus}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-2"
          >
            {busy ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            Atualizar status
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-300 text-xs font-semibold flex items-center gap-2"
          >
            <Trash2 size={15} /> Desconectar
          </button>
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

export default MetaIntegrationCard;
