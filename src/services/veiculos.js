import { supabase } from './supabase';

export const veiculosService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('veiculos')
      .select('*, contratos(id, status)')
      .eq('id_usuario', userId)
      .order('modelo');
    if (error) throw error;
    return data;
  },

  listSimple: async (userId) => {
    const { data, error } = await supabase
      .from('veiculos')
      .select('id, placa, modelo')
      .eq('id_usuario', userId)
      .eq('ativo', true);
    if (error) throw error;
    return data;
  },

  create: async (data) => {
    const { data: result, error } = await supabase
      .from('veiculos')
      .insert([data])
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  update: async (id, data) => {
    const { error } = await supabase
      .from('veiculos')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('veiculos')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
