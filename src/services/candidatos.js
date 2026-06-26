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

  createReservationPix: async (candidatoId) => {
    const { data, error } = await supabase.functions.invoke('create-reservation-pix', {
      body: { candidatoId },
    });
    if (error) throw error;
    return data;
  },
};
