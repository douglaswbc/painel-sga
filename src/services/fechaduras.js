import { supabase } from './supabase';

export const fechadurasService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('fechaduras')
      .select('*')
      .eq('id_usuario', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  create: async (data) => {
    const { data: result, error } = await supabase
      .from('fechaduras')
      .insert([data])
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  update: async (id, data) => {
    const { error } = await supabase
      .from('fechaduras')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('fechaduras')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  listLogs: async (userId) => {
    const { data, error } = await supabase
      .from('fechadura_logs')
      .select('*, locatarios (nome_completo), fechaduras (nome)')
      .eq('id_usuario', userId)
      .order('timestamp', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  },
};
