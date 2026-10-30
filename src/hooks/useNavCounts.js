import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

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
        const [atrasadasRes, candidatosRes] = await Promise.all([
          supabase
            .from('cobrancas')
            .select('id', { count: 'exact', head: true })
            .eq('id_usuario', userId)
            .eq('tipo', 'receita')
            .eq('status', 'atrasado'),
          supabase
            .from('candidatos')
            .select('id', { count: 'exact', head: true })
            .eq('id_usuario', userId)
            .eq('status', 'analise'),
        ]);

        if (isMounted) {
          setCounts({
            cobrancasAtrasadas: atrasadasRes.count || 0,
            candidatosPendentes: candidatosRes.count || 0,
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
