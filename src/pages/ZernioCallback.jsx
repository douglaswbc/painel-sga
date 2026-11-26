import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

const ZernioCallback = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [callbackParams] = useState(() => new URLSearchParams(window.location.search));
  const started = useRef(false);
  const [result, setResult] = useState(() =>
    callbackParams.get('sga_state')
      ? { status: 'loading', message: 'Verificando o retorno da conexão com a Meta…' }
      : { status: 'error', message: 'O retorno não contém o estado de segurança do SGA. Inicie uma nova conexão nas Configurações.' },
  );

  useEffect(() => {
    if (loading || started.current) return;

    if (!user) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      navigate(`/login?redirectTo=${encodeURIComponent(returnTo)}`, { replace: true });
      return;
    }

    started.current = true;
    const params = callbackParams;
    const sgaState = params.get('sga_state');
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!sgaState) {
      return;
    }

    const completeOnboarding = async () => {
      try {
        const data = await api.post('/integrations/zernio/onboarding/complete', {
          sgaState,
          connected: params.get('connected'),
          callbackProfileId: params.get('profileId'),
          accountId: params.get('accountId'),
          callbackError: params.get('whatsapp_error') || params.get('error'),
          platform: params.get('platform'),
        });

        if (data?.outcome === 'completed') {
          setResult({ status: 'success', message: 'WhatsApp conectado e vinculado a este locador.' });
        } else if (data?.outcome === 'cancelled') {
          setResult({ status: 'cancelled', message: data.message || 'A conexão foi cancelada. Nenhum canal foi alterado.' });
        } else {
          setResult({ status: 'error', message: data?.message || 'A Meta ou a Zernio não concluiu a conexão. Revise os dados e tente novamente.' });
        }
      } catch (error) {
        setResult({ status: 'error', message: error.message || 'Não foi possível confirmar a conexão. Tente novamente.' });
      }
    };

    completeOnboarding();
  }, [callbackParams, loading, navigate, user]);

  const isSuccess = result.status === 'success';
  const isLoading = result.status === 'loading';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4 sm:p-6">
      <section className="w-full max-w-lg space-y-5 rounded-[18px] border border-black/10 bg-white p-6 text-center sm:p-8">
        <div className="flex justify-center">
          {isLoading ? <Loader2 className="animate-spin text-indigo-400" size={38} /> : (
            isSuccess
              ? <CheckCircle2 className="text-emerald-400" size={38} />
              : result.status === 'cancelled'
                ? <MessageCircle className="text-amber-400" size={38} />
                : <AlertCircle className="text-red-400" size={38} />
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f]">
            {isLoading ? 'Finalizando conexão' : isSuccess ? 'WhatsApp conectado' : result.status === 'cancelled' ? 'Conexão cancelada' : 'Não foi possível conectar'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#66666a]">{result.message}</p>
        </div>
        {!isLoading && (
          <Link
            to="/configuracoes"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#0066cc] px-5 text-sm font-normal text-white transition-transform hover:bg-[#005ab4] active:scale-95"
          >
            Voltar às Configurações
          </Link>
        )}
      </section>
    </main>
  );
};

export default ZernioCallback;
