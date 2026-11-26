import { useState, useEffect, useCallback } from 'react';
import { locatariosService } from '../services/locatarios';
import { toast } from 'react-toastify';

export function useTenants(userId) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const data = await locatariosService.list(userId);
      setTenants(data);
    } catch {
      toast.error('Erro ao buscar cadastros');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (data) => {
    await locatariosService.create(data);
    toast.success('Cadastro realizado!');
    await fetch();
  };

  const update = async (id, data) => {
    await locatariosService.update(id, data);
    toast.success('Dados atualizados!');
    await fetch();
  };

  const toggleStatus = async (id, ativo) => {
    await locatariosService.toggleStatus(id, ativo);
    await fetch();
  };

  const remove = async (id) => {
    await locatariosService.remove(id);
    toast.success('Cadastro removido!');
    await fetch();
  };

  return { tenants, loading, fetch, create, update, toggleStatus, remove };
}
