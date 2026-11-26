import { api } from './api';

export const fechadurasService = {
  list: async () => {
    const { data } = await api.get('/fechaduras');
    return data || [];
  },

  create: async (payload) => {
    const { data } = await api.post('/fechaduras', payload);
    return data;
  },

  update: async (id, payload) => {
    const { data } = await api.put(`/fechaduras/${encodeURIComponent(id)}`, payload);
    return data;
  },

  remove: async (id) => {
    await api.del(`/fechaduras/${encodeURIComponent(id)}`);
  },

  listLogs: async () => {
    const { data } = await api.get('/fechaduras/logs');
    return data || [];
  },
};
