import { api } from './api';

export const candidatosService = {
  list: async () => {
    const { data } = await api.get('/candidatos');
    return data || [];
  },

  update: async (id, payload) => {
    const { data } = await api.put(`/candidatos/${encodeURIComponent(id)}`, payload);
    return data;
  },

  createReservationPix: async (candidatoId, email, valorCentavos) => {
    return api.post(`/candidatos/${encodeURIComponent(candidatoId)}/reserva-pix`, {
      email,
      valorCentavos,
    });
  },

  confirmReservationManually: async (candidatoId, motivo) => {
    return api.post(`/candidatos/${encodeURIComponent(candidatoId)}/confirmar-reserva-manual`, {
      motivo,
    });
  },

  getReservationHistory: async (candidatoId) => {
    const data = await api.get(`/candidatos/${encodeURIComponent(candidatoId)}/reserva-historico`);
    return {
      audit: data?.audit || [],
      payments: data?.payments || [],
    };
  },

  createApplicationLink: async () => {
    const data = await api.post('/candidatos/link-inscricao', {});
    return {
      ...data,
      url: data?.url || (data?.token ? `${window.location.origin}/inscricao/${data.token}` : ''),
    };
  },

  getApplicationLinkStatus: async () => {
    return api.get('/candidatos/link-inscricao');
  },

  deactivateApplicationLink: async () => {
    return api.del('/candidatos/link-inscricao');
  },

  getPublicApplicationMeta: async (token) => {
    return api.get(`/public/inscricao/${encodeURIComponent(token)}`, { skipAuthRedirect: true });
  },

  submitApplication: async (token, answers, startedAt, privacyNoticeRead, website) => {
    return api.post('/public/inscricao', {
      token,
      answers,
      startedAt,
      privacyNoticeRead,
      website,
    });
  },
};
