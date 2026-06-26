import { supabase } from './supabase';

export const contratosService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('contratos')
      .select('*, locatarios(nome_completo), veiculos(placa, modelo)')
      .eq('id_usuario', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  getAtivoByLocatario: async (locatarioId) => {
    const { data, error } = await supabase
      .from('contratos')
      .select('id')
      .eq('id_locatario', locatarioId)
      .eq('status', 'ativo')
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  create: async (payload) => {
    const { data, error } = await supabase
      .from('contratos')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id, payload) => {
    const { error } = await supabase
      .from('contratos')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  },

  toggleStatus: async (id, newStatus) => {
    const { error } = await supabase
      .from('contratos')
      .update({ status: newStatus })
      .eq('id', id);
    if (error) throw error;
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('contratos')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
