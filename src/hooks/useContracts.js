import { useState, useEffect, useCallback } from 'react';
import { contratosService } from '../services/contratos';
import { locatariosService } from '../services/locatarios';
import { veiculosService } from '../services/veiculos';
import { toast } from 'react-toastify';

export function useContracts(userId) {
  const [contracts, setContracts] = useState([]);
  const [locatarios, setLocatarios] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const [contratos, locs, veics] = await Promise.all([
        contratosService.list(userId),
        locatariosService.listSimple(userId, true),
        veiculosService.listSimple(userId),
      ]);
      setContracts(contratos);
      setLocatarios(locs);
      setVeiculos(veics);
    } catch (err) {
      toast.error('Erro ao buscar contratos');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async (payload, editingId = null) => {
    if (editingId) {
      await contratosService.update(editingId, payload);
      toast.success('Contrato atualizado');
    } else {
      await contratosService.create(payload);
      toast.success('Contrato gerado com sucesso!');
    }
    await fetch();
  };

  const toggleStatus = async (item) => {
    const newStatus = item.status === 'ativo' ? 'pausado' : 'ativo';
    await contratosService.toggleStatus(item.id, newStatus);
    toast.success(`Contrato ${newStatus === 'ativo' ? 'ativado' : 'pausado'}`);
    await fetch();
  };

  const remove = async (id) => {
    await contratosService.remove(id);
    toast.success('Contrato removido');
    await fetch();
  };

  return { contracts, locatarios, veiculos, loading, fetch, save, toggleStatus, remove };
}
