import { api } from './api';

export const agendamentosService = {
  list: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.id_template) params.set('id_template', filters.id_template);
    if (filters.template_id) params.set('template_id', filters.template_id);
    if (filters.id_locatario) params.set('id_locatario', filters.id_locatario);
    if (Array.isArray(filters.tenant_ids) && filters.tenant_ids.length) {
      params.set('tenant_ids', filters.tenant_ids.join(','));
    }
    if (filters.limit) params.set('limit', String(filters.limit));

    const query = params.toString();
    const res = await api.get(`/agendamentos${query ? `?${query}` : ''}`);
    return res.data || [];
  },

  create: async (payloads) => {
    const res = await api.post('/agendamentos', payloads);
    return res.data || [];
  },

  update: async (id, patch) => {
    await api.patch(`/agendamentos/${id}`, patch);
  },

  remove: async (id) => {
    await api.delete(`/agendamentos/${id}`);
  },
};
