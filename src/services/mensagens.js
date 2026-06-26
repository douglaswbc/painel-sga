import { supabase } from './supabase';

export const mensagensService = {
  listTemplates: async (userId) => {
    const { data, error } = await supabase
      .from('mensagens_template')
      .select('*, agendamentos_mensagens (id, ativo)')
      .eq('id_usuario', userId)
      .order('ordem', { ascending: true });
    if (error) throw error;
    return data;
  },

  listAvulsos: async (userId) => {
    const { data, error } = await supabase
      .from('mensagens_template')
      .select('*')
      .eq('id_usuario', userId)
      .eq('tipo', 'avulso')
      .order('titulo');
    if (error) throw error;
    return data;
  },

  upsertTemplates: async (templates) => {
    const { error } = await supabase
      .from('mensagens_template')
      .upsert(templates);
    if (error) throw error;
  },

  updateTemplate: async (id, data) => {
    const { error } = await supabase
      .from('mensagens_template')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  removeTemplate: async (id) => {
    const { error } = await supabase
      .from('mensagens_template')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  uploadMedia: async (filePath, file) => {
    const { error, data } = await supabase.storage
      .from('mensagens-midia')
      .upload(filePath, file);
    if (error) throw error;
    return data;
  },

  removeMedia: async (path) => {
    const { error } = await supabase.storage
      .from('mensagens-midia')
      .remove([path]);
    if (error) throw error;
  },

  getMediaPublicUrl: (filePath) => {
    const { data } = supabase.storage
      .from('mensagens-midia')
      .getPublicUrl(filePath);
    return data.publicUrl;
  },
};
