import { useState, useEffect, useCallback } from 'react';
import { veiculosService } from '../services/veiculos';
import { toast } from 'react-toastify';

export function useVehicles(userId) {
  const [veiculos, setVeiculos] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const data = await veiculosService.list(userId);
      setVeiculos(data);
    } catch (err) {
      toast.error('Erro ao carregar veículos');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (data) => {
    await veiculosService.create(data);
    toast.success('Veículo cadastrado!');
    await fetch();
  };

  const update = async (id, data) => {
    await veiculosService.update(id, data);
    toast.success('Veículo atualizado!');
    await fetch();
  };

  const remove = async (id) => {
    await veiculosService.remove(id);
    toast.success('Veículo removido!');
    await fetch();
  };

  return { veiculos, loading, fetch, create, update, remove };
}
