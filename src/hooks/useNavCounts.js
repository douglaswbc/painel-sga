import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function useNavCounts(userId) {
  const [counts, setCounts] = useState({
    cobrancasAtrasadas: 0,
    candidatosPendentes: 0,
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!userId) return;
      try {
        const data = await api.get('/dashboard/nav-counts');
        if (isMounted) {
          setCounts({
            cobrancasAtrasadas: data?.cobrancasAtrasadas || 0,
            candidatosPendentes: data?.candidatosPendentes || 0,
            loading: false,
          });
        }
      } catch (err) {
        console.warn('Erro ao carregar contadores de navegação:', err);
        if (isMounted) {
          setCounts((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    run();
    const interval = setInterval(run, 90000);
    const handleFocus = () => run();
    window.addEventListener('focus', handleFocus);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [userId]);

  return { counts };
}
