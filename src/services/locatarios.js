import { supabase } from './supabase';

export const locatariosService = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('locatarios_safe')
      .select('*')
      .eq('id_usuario', userId)
      .order('nome_completo');
    if (error) throw error;
    return data;
  },

  listWithAgendamentos: async (userId) => {
    const { data, error } = await supabase
      .from('locatarios_safe')
      .select('*, agendamentos_mensagens (id, ativo)')
      .eq('id_usuario', userId)
      .order('nome_completo');
    if (error) throw error;
    return data;
  },

  listSimple: async (userId, ativo = true) => {
    const { data, error } = await supabase
      .from('locatarios_safe')
      .select('id, nome_completo')
      .eq('id_usuario', userId)
      .eq('ativo', ativo)
      .order('nome_completo', { ascending: true });
    if (error) throw error;
    return data;
  },

  listSimpleWithWhatsApp: async (userId) => {
    const { data, error } = await supabase
      .from('locatarios_safe')
      .select('id, nome_completo, whatsapp')
      .eq('id_usuario', userId)
      .eq('ativo', true)
      .order('nome_completo');
    if (error) throw error;
    return data;
  },

  getById: async (id) => {
    const { data, error } = await supabase
      .from('locatarios_safe')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  create: async (data) => {
    const { data: result, error } = await supabase
      .from('locatarios')
      .insert([data])
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  update: async (id, data) => {
    const { error } = await supabase
      .from('locatarios')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  toggleStatus: async (id, ativo) => {
    const { error } = await supabase
      .from('locatarios')
      .update({ ativo: !ativo })
      .eq('id', id);
    if (error) throw error;
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('locatarios')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
