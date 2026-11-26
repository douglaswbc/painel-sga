import { api } from './api';

export const usuariosService = {
  list: async () => {
    const response = await api.get('/admin/usuarios');
    return response?.data || [];
  },

  update: async (_id, data) => {
    return api.put('/account/profile', data);
  },

  adminUpdate: async (id, data) => {
    return api.put(`/admin/usuarios/${id}`, data);
  },

  toggleStatus: async (id, currentStatus) => {
    return api.patch(`/admin/usuarios/${id}/status`, {
      ativo: !currentStatus,
    });
  },

  deleteUser: async (userId) => {
    return api.delete(`/admin/usuarios/${userId}`);
  },

  createUserAdmin: async (formData, whatsapp) => {
    return api.post('/admin/usuarios', {
      ...formData,
      whatsapp,
    });
  },
};
