export const CANDIDATO_STATUS = {
  ANALISE: 'Em análise',
  PRE_APROVADO: 'Pré-aprovado',
  AGUARDANDO_RESERVA: 'Aguardando reserva',
  RESERVADO: 'Vaga reservada',
  REPROVADO: 'Reprovado',
};

const normalize = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');

const STATUS_ALIASES = {
  'aguardando processamento': CANDIDATO_STATUS.ANALISE,
  'em analise': CANDIDATO_STATUS.ANALISE,
  'pre-aprovado': CANDIDATO_STATUS.PRE_APROVADO,
  'aguardando reserva': CANDIDATO_STATUS.AGUARDANDO_RESERVA,
  'reserva confirmada': CANDIDATO_STATUS.RESERVADO,
  'vaga reservada': CANDIDATO_STATUS.RESERVADO,
  reprovado: CANDIDATO_STATUS.REPROVADO,
};

const ALLOWED_TRANSITIONS = {
  [CANDIDATO_STATUS.ANALISE]: [CANDIDATO_STATUS.PRE_APROVADO, CANDIDATO_STATUS.REPROVADO],
  [CANDIDATO_STATUS.PRE_APROVADO]: [CANDIDATO_STATUS.REPROVADO],
  [CANDIDATO_STATUS.AGUARDANDO_RESERVA]: [],
  [CANDIDATO_STATUS.RESERVADO]: [],
  [CANDIDATO_STATUS.REPROVADO]: [],
};

export function canonicalizarStatusCandidato(status) {
  const rawStatus = String(status || '').trim();
  return STATUS_ALIASES[normalize(rawStatus)] || rawStatus || CANDIDATO_STATUS.ANALISE;
}

export function podeAlterarStatusCandidato(statusAtual, novoStatus) {
  const status = canonicalizarStatusCandidato(statusAtual);
  return (ALLOWED_TRANSITIONS[status] || []).includes(canonicalizarStatusCandidato(novoStatus));
}
