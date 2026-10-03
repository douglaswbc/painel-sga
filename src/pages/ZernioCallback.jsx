import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';

const ZernioCallback = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const callbackParams = useRef(new URLSearchParams(window.location.search));
  const started = useRef(false);
  const [result, setResult] = useState({ status: 'loading', message: 'Verificando o retorno da conexão com a Meta…' });

  useEffect(() => {
    if (loading || started.current) return;

    if (!user) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      navigate(`/login?redirectTo=${encodeURIComponent(returnTo)}`, { replace: true });
      return;
    }

    started.current = true;
    const params = callbackParams.current;
    const sgaState = params.get('sga_state');
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!sgaState) {
      setResult({ status: 'error', message: 'O retorno não contém o estado de segurança do SGA. Inicie uma nova conexão nas Configurações.' });
      return;
    }

    const completeOnboarding = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('zernio-onboarding', {
          body: {
            action: 'complete',
            sgaState,
            connected: params.get('connected'),
            callbackProfileId: params.get('profileId'),
            accountId: params.get('accountId'),
            callbackError: params.get('whatsapp_error') || params.get('error'),
            platform: params.get('platform'),
          },
        });

        if (error) {
          let message = 'Não foi possível confirmar o canal WhatsApp. Tente iniciar a conexão novamente.';
          try {
            const body = await error.context?.json();
            if (typeof body?.error === 'string') message = body.error;
          } catch {}
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);

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
  }, [loading, navigate, user]);

  const isSuccess = result.status === 'success';
  const isLoading = result.status === 'loading';

  return (
    <main className="min-h-screen bg-[#121829] flex items-center justify-center p-4">
      <section className="w-full max-w-lg bg-card border border-slate-700 rounded-xl p-8 shadow-lg text-center space-y-5">
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
          <h1 className="text-xl font-bold text-white">
            {isLoading ? 'Finalizando conexão' : isSuccess ? 'WhatsApp conectado' : result.status === 'cancelled' ? 'Conexão cancelada' : 'Não foi possível conectar'}
          </h1>
          <p className="text-sm text-slate-300 mt-2">{result.message}</p>
        </div>
        {!isLoading && (
          <Link
            to="/configuracoes"
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-semibold"
          >
            Voltar às Configurações
          </Link>
        )}
      </section>
    </main>
  );
};

export default ZernioCallback;
