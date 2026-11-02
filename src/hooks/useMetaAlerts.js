import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

/**
 * Carrega os alertas ativos da Meta do locador logado.
 *
 * A consulta passa pela Edge Function `meta-integration` (service role), porque
 * `meta_alertas` tem RLS fechada para o navegador. O hook atualiza ao focar a
 * janela e a cada minuto, para o banner refletir rapidamente uma regularização.
 */
export function useMetaAlerts(enabled = true) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const invoke = useCallback(async (action, payload = {}) => {
    const { data, error: invokeError } = await supabase.functions.invoke('meta-integration', {
      body: { action, ...payload },
    });
    if (invokeError) {
      let message = 'Não foi possível consultar os alertas da Meta.';
      try {
        const body = await invokeError.context?.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const refresh = useCallback(async ({ silent = true } = {}) => {
    if (!enabled) return;
    if (!silent) setLoading(true);
    try {
      const data = await invoke('alerts');
      if (!mounted.current) return;
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
      setError(null);
    } catch (requestError) {
      if (!mounted.current) return;
      // Contas sem permissão (admin/gestor) simplesmente não têm alertas.
      setError(requestError.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [enabled, invoke]);

  const clearAlert = useCallback(async (tipo) => {
    const data = await invoke('clear_alert', tipo ? { tipo } : {});
    if (mounted.current) {
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
      setError(null);
    }
    return data;
  }, [invoke]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setAlerts([]);
      setLoading(false);
      return undefined;
    }

    refresh({ silent: false });
    const interval = setInterval(() => refresh(), 60000);
    const handleFocus = () => refresh();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      mounted.current = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [enabled, refresh]);

  return { alerts, loading, error, refresh, clearAlert };
}

export default useMetaAlerts;
