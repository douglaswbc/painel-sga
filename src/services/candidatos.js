import { supabase } from './supabase';

export const candidatosService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('candidatos')
      .select('*')
      .eq('id_usuario', userId)
      .order('score_formulario', { ascending: false });
    if (error) throw error;
    return data;
  },

  update: async (id, data) => {
    const { error } = await supabase
      .from('candidatos')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  createReservationPix: async (candidatoId, email) => {
    const { data, error } = await supabase.functions.invoke('create-reservation-pix', {
      body: { candidatoId, email },
    });
    if (error) {
      let message = error.message;
      try {
        const response = typeof error.context?.clone === 'function' ? error.context.clone() : error.context;
        const details = await response?.json?.();
        message = details?.error || message;
      } catch {
        // Mantém a mensagem do SDK quando a resposta não contém JSON.
      }
      throw new Error(message || 'Não foi possível gerar o PIX.');
    }
    return data;
  },

  confirmReservationManually: async (candidatoId, motivo) => {
    const { data, error } = await supabase.rpc('confirmar_reserva_candidato_manual', {
      p_candidato_id: candidatoId,
      p_motivo: motivo,
    });
    if (error) throw error;
    return data;
  },

  getReservationHistory: async (candidatoId) => {
    const [auditResult, paymentResult] = await Promise.all([
      supabase.from('candidato_reserva_auditoria').select('*').eq('id_candidato', candidatoId).order('criado_em', { ascending: false }),
      supabase.from('candidato_reserva_pagamentos').select('*').eq('id_candidato', candidatoId).order('criado_em', { ascending: false }),
    ]);
    if (auditResult.error) throw auditResult.error;
    if (paymentResult.error) throw paymentResult.error;
    return { audit: auditResult.data || [], payments: paymentResult.data || [] };
  },
};
