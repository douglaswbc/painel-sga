import { supabase } from './supabase';

export const cobrancasService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('cobrancas')
      .select('*, locatario_cobranca:locatarios!cobrancas_locatario_mesmo_usuario_fkey (nome_completo, whatsapp), contratos (*, locatarios (nome_completo), veiculos (placa))')
      .eq('id_usuario', userId)
      .order('data_vencimento', { ascending: false });
    if (error) throw error;
    return data;
  },

  getDashboardSummary: async () => {
    const { data, error } = await supabase.rpc('get_dashboard_summary');
    if (error) throw error;
    return Array.isArray(data) ? data[0] || null : data;
  },

  listDashboardCharges: async (userId, { page = 1, pageSize = 8, status = 'all' } = {}) => {
    const statuses = ['atrasado', 'pendente'];
    const counts = await Promise.all(statuses.map(async (chargeStatus) => {
      const { count, error } = await supabase
        .from('cobrancas')
        .select('id', { count: 'exact', head: true })
        .eq('id_usuario', userId)
        .eq('tipo', 'receita')
        .eq('status', chargeStatus);
      if (error) throw error;
      return [chargeStatus, count || 0];
    }));
    const statusCounts = Object.fromEntries(counts);
    const total = status === 'all'
      ? statusCounts.atrasado + statusCounts.pendente
      : statusCounts[status] || 0;
    const offset = (page - 1) * pageSize;
    const selection = `
      id, id_locatario, valor, status, tipo, categoria, data_vencimento,
      payment_link, mercado_pago_id, tentativas_envio, created_at,
      pix_expires_at, pix_expired_at,
      locatario_cobranca:locatarios!cobrancas_locatario_mesmo_usuario_fkey (nome_completo, whatsapp),
      contratos (id, locatarios (nome_completo), veiculos (placa))
    `;
    const queryStatus = async (chargeStatus, from, to, expiryFirst = false) => {
      if (to < from) return [];
      let query = supabase
        .from('cobrancas')
        .select(selection)
        .eq('id_usuario', userId)
        .eq('tipo', 'receita')
        .eq('status', chargeStatus);
      if (expiryFirst) query = query.order('pix_expires_at', { ascending: true, nullsFirst: false });
      query = query.order('data_vencimento', { ascending: true }).range(from, to);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    };

    let items;
    if (status === 'all') {
      const overdueCount = statusCounts.atrasado;
      const overdueStart = Math.min(offset, overdueCount);
      const overdueEnd = Math.min(offset + pageSize, overdueCount) - 1;
      const overdueItems = offset < overdueCount
        ? await queryStatus('atrasado', overdueStart, overdueEnd)
        : [];
      const remaining = pageSize - overdueItems.length;
      const pendingOffset = Math.max(0, offset - overdueCount);
      const pendingItems = remaining > 0
        ? await queryStatus('pendente', pendingOffset, pendingOffset + remaining - 1, true)
        : [];
      items = [...overdueItems, ...pendingItems];
    } else {
      items = await queryStatus(status, offset, offset + pageSize - 1, status === 'pendente');
    }

    return { items, total, statusCounts };
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

  gerarCobrancasDiarias: async () => {
    const { data, error } = await supabase.functions.invoke('faturamento-cobrancas', {
      body: {},
    });
    if (error) throw error;
    return data;
  },

  gerarPix: async (cobrancaId) => {
    const { data, error } = await supabase.functions.invoke('zernio-whatsapp', {
      body: { action: 'send_charge', chargeId: cobrancaId },
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
