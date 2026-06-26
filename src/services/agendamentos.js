import { supabase } from './supabase';

export const agendamentosService = {
  list: async (filters = {}) => {
    let query = supabase
      .from('agendamentos_mensagens')
      .select('id, frequencia, proximo_envio, ativo, horario_envio, locatarios (nome_completo, whatsapp), mensagens_template (titulo)')
      .order('proximo_envio');

    if (filters.id_template) query = query.eq('id_template', filters.id_template);
    if (filters.id_locatario) query = query.eq('id_locatario', filters.id_locatario);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  create: async (payloads) => {
    const { data, error } = await supabase
      .from('agendamentos_mensagens')
      .insert(payloads)
      .select();
    if (error) throw error;
    return data;
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('agendamentos_mensagens')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
