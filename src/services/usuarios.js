import { supabase } from './supabase';

export const usuariosService = {
  list: async () => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nome_completo, whatsapp, email, role, empresa_nome, ativo, created_at, ryze_instance, mp_notification_url')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  getById: async (id) => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nome_completo, whatsapp, email, role, empresa_nome, ativo, created_at, ryze_instance, mp_notification_url')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  getStatus: async (id) => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('ativo')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id, data) => {
    const { error } = await supabase
      .from('usuarios')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  toggleStatus: async (id, currentStatus) => {
    const { error } = await supabase.rpc('admin_set_usuario_status', {
      p_user_id: id,
      p_ativo: !currentStatus,
    });
    if (error) throw error;
  },

  deleteUser: async (userId) => {
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { userId },
    });
    if (error) throw error;
    return data;
  },

  createUserAdmin: async (formData, whatsapp, instanceName) => {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { ...formData, whatsapp, instanceName },
    });
    if (error) throw error;
    return data;
  },

  resetPassword: async (email, redirectTo) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  },
};
