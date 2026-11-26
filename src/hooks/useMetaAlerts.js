import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

/**
 * Carrega os alertas ativos da Meta do locador logado.
 *
 * O hook atualiza ao focar a janela e a cada minuto, para o banner refletir
 * rapidamente uma regularização.
 */
export function useMetaAlerts(enabled = true) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const refresh = useCallback(async ({ silent = true } = {}) => {
    if (!enabled) return;
    if (!silent) setLoading(true);
    try {
      const data = await api.get('/meta/alerts');
      if (!mounted.current) return;
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
      setError(null);
    } catch (requestError) {
      if (!mounted.current) return;
      setError(requestError.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [enabled]);

  const clearAlert = useCallback(async (tipo) => {
    const data = await api.post('/meta/alerts/clear', tipo ? { tipo } : {});
    if (mounted.current) {
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
      setError(null);
    }
    return data;
  }, []);

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
