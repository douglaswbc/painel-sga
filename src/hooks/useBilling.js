import { useState, useEffect, useCallback } from 'react';
import { cobrancasService } from '../services/cobrancas';
import { contratosService } from '../services/contratos';
import { locatariosService } from '../services/locatarios';
import { toast } from 'react-toastify';

export function useBilling(userId) {
  const [cobrancas, setCobrancas] = useState([]);
  const [locatarios, setLocatarios] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const [cobs, locs] = await Promise.all([
        cobrancasService.list(userId),
        locatariosService.listSimple(userId, true),
      ]);
      setCobrancas(cobs);
      setLocatarios(locs);
    } catch (err) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);

  const markAsPaid = async (id) => {
    await cobrancasService.markAsPaid(id);
    toast.success('Baixa realizada!');
    await fetch();
  };

  const cancel = async (id) => {
    await cobrancasService.cancel(id);
    toast.info('Cobrança cancelada.');
    await fetch();
  };

  const runDailyBilling = async () => {
    const result = await cobrancasService.gerarCobrancasDiarias();
    await fetch();
    return result;
  };

  const createManual = async (data) => {
    await cobrancasService.create(data);
    toast.success('Lançamento registrado!');
    await fetch();
  };

  const getContratoAtivo = async (locatarioId) => {
    return contratosService.getAtivoByLocatario(locatarioId);
  };

  const getPendingBill = async (contratoId) => {
    return cobrancasService.getPendingByContrato(contratoId);
  };

  return {
    cobrancas, locatarios, loading, fetch,
    markAsPaid, cancel, runDailyBilling, createManual,
    getContratoAtivo, getPendingBill,
  };
}
