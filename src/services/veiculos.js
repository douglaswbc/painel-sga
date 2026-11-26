import { api } from './api';

export const veiculosService = {
  list: async (_userId) => {
    const res = await api.get('/veiculos');
    return res.data || [];
  },

  listSimple: async (_userId) => {
    const res = await api.get('/veiculos?ativo=true');
    return (res.data || []).map((item) => ({
      id: item.id,
      placa: item.placa,
      identificador: item.identificador || item.placa,
      modelo: item.modelo,
      titulo: item.titulo || item.modelo,
      categoria: item.categoria || null,
    }));
  },

  create: async (data) => {
    const res = await api.post('/veiculos', data);
    return res.data;
  },

  update: async (id, data) => {
    const res = await api.put(`/veiculos/${id}`, data);
    return res.data;
  },

  remove: async (id) => {
    await api.delete(`/veiculos/${id}`);
  },
};
