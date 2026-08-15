import { supabase } from './supabase';

export const cobrancasService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('cobrancas')
      .select('*, contratos (*, locatarios (nome_completo), veiculos (placa))')
      .eq('id_usuario', userId)
      .order('data_vencimento', { ascending: false });
    if (error) throw error;
    return data;
  },

  listDashboard: async (userId) => {
    const { data, error } = await supabase
      .from('cobrancas')
      .select(`
        id, valor, status, tipo, categoria, data_vencimento,
        payment_link, tentativas_envio, created_at,
        contratos (id, status, locatarios (nome_completo), veiculos (placa))
      `)
      .eq('id_usuario', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  getPendingByContrato: async (contratoId) => {
    const { data, error } = await supabase
      .from('cobrancas')
      .select('id, valor, data_vencimento')
      .eq('status', 'pendente')
      .eq('id_contrato', contratoId)
      .order('data_vencimento', { ascending: true })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  create: async (data) => {
    const { data: result, error } = await supabase
      .from('cobrancas')
      .insert([data])
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  update: async (id, data) => {
    const { error } = await supabase
      .from('cobrancas')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  markAsPaid: async (id) => {
    const { error } = await supabase
      .from('cobrancas')
      .update({ status: 'pago', data_pagamento: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  cancel: async (id) => {
    const { error } = await supabase
      .from('cobrancas')
      .update({ status: 'cancelado' })
      .eq('id', id);
    if (error) throw error;
  },

  gerarCobrancasDiarias: async (userId) => {
    const { data, error } = await supabase.functions.invoke('faturamento-cobrancas', {
      body: { userId },
    });
    if (error) throw error;
    return data;
  },

  gerarPix: async (cobrancaId) => {
    const { data, error } = await supabase.functions.invoke('gerar-cobranca-pix', {
      body: { cobrancaId },
    });
    if (error) throw error;
    return data;
  },

  cobrarContrato: async (contratoId) => {
    const { data, error } = await supabase.functions.invoke('cobrar-contrato', {
      body: { contratoId },
    });
    if (error) throw error;
    return data;
  },
};
