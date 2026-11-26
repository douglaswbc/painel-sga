import { api } from './api';

export const locatariosService = {
  list: async (_userId) => {
    const res = await api.get('/locatarios');
    return res.data || [];
  },

  listWithAgendamentos: async (_userId) => {
    const res = await api.get('/locatarios?include=agendamentos');
    return res.data || [];
  },

  listSimple: async (_userId, ativo = true) => {
    const res = await api.get(`/locatarios?ativo=${ativo ? 'true' : 'false'}`);
    return (res.data || []).map(({ id, nome_completo }) => ({ id, nome_completo }));
  },

  listSimpleWithWhatsApp: async (_userId) => {
    const res = await api.get('/locatarios?ativo=true');
    return (res.data || []).map(({ id, nome_completo, whatsapp }) => ({ id, nome_completo, whatsapp }));
  },

  getById: async (id) => {
    const res = await api.get(`/locatarios/${id}`);
    return res.data;
  },

  create: async (data) => {
    const res = await api.post('/locatarios', data);
    return res.data;
  },

  update: async (id, data) => {
    const res = await api.put(`/locatarios/${id}`, data);
    return res.data;
  },

  toggleStatus: async (id, ativo) => {
    await api.patch(`/locatarios/${id}/status`, { ativo: !ativo });
  },

  remove: async (id) => {
    await api.delete(`/locatarios/${id}`);
  },
};
