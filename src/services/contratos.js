import { api } from './api';

export const contratosService = {
  list: async (_userId) => {
    const res = await api.get('/contratos');
    return res.data || [];
  },

  getAtivoByLocatario: async (locatarioId) => {
    const res = await api.get(`/contratos/ativo-por-locatario/${locatarioId}`);
    return res.data || null;
  },

  create: async (payload) => {
    const res = await api.post('/contratos', payload);
    return res.data;
  },

  update: async (id, payload) => {
    const res = await api.put(`/contratos/${id}`, payload);
    return res.data;
  },

  toggleStatus: async (id, newStatus) => {
    await api.patch(`/contratos/${id}/status`, { status: newStatus });
  },

  remove: async (id) => {
    await api.delete(`/contratos/${id}`);
  },
};
