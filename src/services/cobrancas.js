import { api } from './api';

export const cobrancasService = {
  list: async (_userId) => {
    const res = await api.get('/cobrancas');
    return res.data || [];
  },

  getDashboardSummary: async () => {
    return api.get('/dashboard/summary');
  },

  getDashboardOperationalStats: async () => {
    return api.get('/dashboard/operational-stats');
  },

  listDashboardCharges: async (_userId, { page = 1, pageSize = 8, status = 'all' } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      status: String(status),
    });
    return api.get(`/dashboard/charges?${params.toString()}`);
  },

  getPendingByContrato: async (contratoId) => {
    const res = await api.get(`/cobrancas/contrato/${contratoId}/pendente`);
    return res.data || null;
  },

  create: async (data) => {
    const res = await api.post('/cobrancas', data);
    return res.data;
  },

  update: async (id, data) => {
    await api.put(`/cobrancas/${id}`, data);
  },

  markAsPaid: async (id) => {
    await api.patch(`/cobrancas/${id}/pagar`);
  },

  cancel: async (id) => {
    await api.patch(`/cobrancas/${id}/cancelar`);
  },

  gerarCobrancasDiarias: async () => {
    return api.post('/cobrancas/faturar', {});
  },

  gerarPix: async (cobrancaId) => {
    return api.post(`/cobrancas/${cobrancaId}/gerar-pix`, {});
  },

  cobrarContrato: async (contratoId) => {
    return api.post('/cobrancas/cobrar-contrato', { contratoId });
  },

  enviarConfirmacaoPagamento: async (cobrancaId) => {
    return api.post(`/cobrancas/${cobrancaId}/confirmar-pagamento`, {});
  },
};
