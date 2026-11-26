import { api } from './api';

export const mensagensService = {
  listTemplates: async (_userId) => {
    const res = await api.get('/mensagens-template');
    return res.data || [];
  },

  listAvulsos: async (_userId) => {
    const res = await api.get('/mensagens-template?tipo=avulso');
    return res.data || [];
  },

  updateTemplate: async (id, data) => {
    await api.put(`/mensagens-template/${id}`, data);
  },

  updateTemplates: async (templates) => {
    await Promise.all(
      templates.map(({ id, ...data }) => {
        if (!id) throw new Error('Não é possível atualizar um modelo sem identificador.');
        return mensagensService.updateTemplate(id, data);
      }),
    );
  },

  removeTemplate: async (id) => {
    await api.delete(`/mensagens-template/${id}`);
  },

  uploadMedia: async (_filePath, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload('/media', formData);
  },

  removeMedia: async (filePath) => {
    await api.delete('/media', { path: filePath });
  },

  getMediaPublicUrl: (filePath) => {
    const cleaned = String(filePath || '').replace(/^\/+/, '');
    if (/^https?:\/\//i.test(cleaned)) return cleaned;
    return `${window.location.origin}/uploads/mensagens-midia/${cleaned}`;
  },
};
