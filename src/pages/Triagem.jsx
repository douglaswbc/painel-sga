import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  UserMinus,
  X,
  Zap,
  ClipboardCheck,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import PixModal from '../components/PixModal';
import CandidatoDetalheModal from '../components/CandidatoDetalheModal';
import { useAuth } from '../contexts/AuthContext';
import { candidatosService } from '../services/candidatos';
import { CANDIDATO_STATUS, canonicalizarStatusCandidato, podeAlterarStatusCandidato } from '../utils/candidatoStatus';
import { PageHeader } from '../components/ui/PageHeader';

const statusStyles = {
  [CANDIDATO_STATUS.ANALISE]: 'bg-[#f5f5f7] text-[#7a7a7a] border-black/10',
  [CANDIDATO_STATUS.PRE_APROVADO]: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  [CANDIDATO_STATUS.AGUARDANDO_RESERVA]: 'bg-amber-50 text-amber-800 border-amber-200',
  [CANDIDATO_STATUS.RESERVADO]: 'bg-blue-50 text-[#0066cc] border-blue-200',
  [CANDIDATO_STATUS.REPROVADO]: 'bg-red-50 text-red-700 border-red-200',
};

const ITEMS_PER_PAGE = 20;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESERVATION_AMOUNT = 25;
const maskCpf = (value) => (String(value ?? '').replace(/\D/g, '').length === 11 ? '***.***.***-**' : '***');
const normalizeSearch = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();

const parseReservationAmount = (value) => {
  const trimmed = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s+/g, '');
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents >= 100 && cents <= 1000000 ? cents : null;
};

const formatLinkExpiration = (expiresAt, active) => {
  if (!expiresAt) return 'Nenhum link foi gerado ainda.';
  const expiration = new Date(expiresAt);
  if (Number.isNaN(expiration.getTime())) return 'Expiração indisponível.';
  const formattedDate = expiration.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const daysRemaining = Math.ceil((expiration.getTime() - Date.now()) / DAY_IN_MS);
  if (daysRemaining <= 0) return `Expirou em ${formattedDate}.`;
  const remaining = daysRemaining === 1 ? 'menos de 1 dia' : `${daysRemaining} dias`;
  return `${active ? 'Expira' : 'Validade até'} ${formattedDate} (em ${remaining}).`;
};

const Triagem = () => {
  const { profile } = useAuth();
  const [candidatos, setCandidatos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [pixData, setPixData] = useState(null);
  const [isPixModalOpen, setIsPixModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [sortOrder, setSortOrder] = useState('score_desc');
  const [page, setPage] = useState(1);
  const [detailCandidate, setDetailCandidate] = useState(null);
  const [applicationLink, setApplicationLink] = useState(null);
  const [isApplicationLinkModalOpen, setIsApplicationLinkModalOpen] = useState(false);
  const [applicationLinkBusy, setApplicationLinkBusy] = useState(false);
  const [applicationLinkStatus, setApplicationLinkStatus] = useState({
    loading: true,
    exists: false,
    active: false,
    expiresAt: null,
    error: false,
  });

  const filteredCandidates = useMemo(() => {
    const normalizedSearch = normalizeSearch(search);
    const digitsSearch = search.replace(/\D/g, '');
    const filtered = candidatos.filter((candidate) => {
      const normalizedStatus = canonicalizarStatusCandidato(candidate.status);
      if (!normalizedSearch) return statusFilter === 'Todos' || normalizedStatus === statusFilter;
      const nameMatches = normalizeSearch(candidate.nome).includes(normalizedSearch);
      const phoneDigits = String(candidate.telefone ?? '').replace(/\D/g, '');
      const phoneMatches = Boolean(digitsSearch) && phoneDigits.includes(digitsSearch);
      const statusMatches = statusFilter === 'Todos' || normalizedStatus === statusFilter;
      return (nameMatches || phoneMatches) && statusMatches;
    });

    return filtered.sort((a, b) => {
      if (sortOrder === 'name_asc') {
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
      }
      if (sortOrder === 'name_desc') {
        return (b.nome || '').localeCompare(a.nome || '', 'pt-BR');
      }
      if (sortOrder === 'score_asc' || sortOrder === 'score_desc') {
        const aScore = a.score_formulario == null ? null : Number(a.score_formulario);
        const bScore = b.score_formulario == null ? null : Number(b.score_formulario);
        if (aScore == null && bScore != null) return 1;
        if (bScore == null && aScore != null) return -1;
        if (aScore !== bScore) return sortOrder === 'score_desc' ? bScore - aScore : aScore - bScore;
      }
      const dateDifference = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      return sortOrder === 'date_asc' ? dateDifference : -dateDifference;
    });
  }, [candidatos, search, statusFilter, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / ITEMS_PER_PAGE));
  const pageCandidates = filteredCandidates.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const fetchCandidatos = useCallback(
    async ({ quiet = false } = {}) => {
      if (!profile?.id) {
        setCandidatos([]);
        setLoadError('');
        setLoading(false);
        return true;
      }

      try {
        if (!quiet) setLoading(true);
        const data = await candidatosService.list(profile.id);
        setCandidatos(data || []);
        setLoadError('');
        return true;
      } catch {
        setLoadError('Não foi possível carregar a fila de triagem. Confira sua conexão e tente novamente.');
        return false;
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [profile?.id]
  );

  useEffect(() => {
    fetchCandidatos();
  }, [fetchCandidatos]);

  const fetchApplicationLinkStatus = useCallback(async () => {
    setApplicationLinkStatus((current) => ({ ...current, loading: true, error: false }));
    try {
      const status = await candidatosService.getApplicationLinkStatus();
      setApplicationLinkStatus({ ...status, loading: false, error: false });
    } catch {
      setApplicationLinkStatus((current) => ({ ...current, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    if (profile?.id) fetchApplicationLinkStatus();
  }, [fetchApplicationLinkStatus, profile?.id]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') fetchCandidatos({ quiet: true });
    };
    const interval = window.setInterval(refreshWhenVisible, 15000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [fetchCandidatos]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchCandidatos(), fetchApplicationLinkStatus()]);
    setRefreshing(false);
  };

  const handleToggleApplicationLink = async () => {
    setApplicationLinkBusy(true);
    try {
      if (applicationLinkStatus.active) {
        await candidatosService.deactivateApplicationLink();
        toast.info('Link de inscrição desativado.');
      } else {
        const data = await candidatosService.createApplicationLink();
        setApplicationLink(data);
        setIsApplicationLinkModalOpen(true);
        toast.success('Novo link gerado com sucesso.');
      }
      await fetchApplicationLinkStatus();
    } catch (error) {
      toast.error(error.message || 'Não foi possível alterar o link.');
    } finally {
      setApplicationLinkBusy(false);
    }
  };

  const handleCopyApplicationLink = async () => {
    if (applicationLink?.url) {
      try {
        await navigator.clipboard.writeText(applicationLink.url);
        toast.success('Link copiado para a área de transferência!');
        return;
      } catch {
        toast.error('Não foi possível copiar o link.');
        return;
      }
    }

    toast.info('Por segurança, o link completo só é exibido quando gerado. Desative e ative novamente para gerar um novo link.');
  };

  const handleAction = async (candidato, nextStatus) => {
    setUpdatingId(candidato.id);
    try {
      await candidatosService.update(candidato.id, { status: nextStatus });
      toast.success(`Candidato ${nextStatus === CANDIDATO_STATUS.PRE_APROVADO ? 'pré-aprovado' : 'reprovado'}.`);
      await fetchCandidatos({ quiet: true });
    } catch (error) {
      toast.error(error.message || 'Erro ao atualizar candidato.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReservarVaga = async (candidato) => {
    const defaultVal = String(candidato.reserva_valor ?? DEFAULT_RESERVATION_AMOUNT);
    const amountInput = window.prompt('Valor da reserva em reais (ex: 25 ou 25,00):', defaultVal)?.trim();
    if (amountInput == null) return;
    const amountCents = parseReservationAmount(amountInput);
    if (!amountCents) {
      toast.error('Informe um valor válido entre R$ 1,00 e R$ 10.000,00.');
      return;
    }

    const defaultEmail = candidato.email || `${candidato.telefone?.replace(/\D/g, '') || candidato.id}@candidato.sga.local`;
    const email = window.prompt('E-mail do candidato para registro no Mercado Pago:', defaultEmail)?.trim();
    if (!email) return;

    setProcessingId(candidato.id);
    try {
      const data = await candidatosService.createReservationPix(candidato.id, email, amountCents);
      setPixData(data);
      setIsPixModalOpen(true);
      await fetchCandidatos();
    } catch (error) {
      await fetchCandidatos({ quiet: true });
      toast.error(`Erro ao gerar reserva: ${error.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReabrirPix = (candidato) => {
    const expiresAt = new Date(candidato.reserva_expira_em);
    if (!candidato.pagamento_id || !candidato.pix_qr_code || !candidato.pix_copia_e_cola || expiresAt <= new Date()) {
      toast.error('Os dados deste PIX não estão disponíveis ou já expiraram. Atualize a fila.');
      fetchCandidatos({ quiet: true });
      return;
    }

    setPixData({
      paymentId: candidato.pagamento_id,
      qrCode: candidato.pix_qr_code,
      copyPaste: candidato.pix_copia_e_cola,
      ticketUrl: candidato.pix_url,
      expiresAt: expiresAt.toISOString(),
      amount: Number(candidato.reserva_valor ?? DEFAULT_RESERVATION_AMOUNT),
      alreadyExists: true,
    });
    setIsPixModalOpen(true);
  };

  const handleConfirmarManualmente = async (candidato) => {
    const motivo = window.prompt('Informe o motivo da confirmação manual (mínimo de 10 caracteres):')?.trim();
    if (!motivo) return;
    if (motivo.length < 10) {
      toast.error('O motivo precisa ter pelo menos 10 caracteres.');
      return;
    }
    if (!window.confirm(`Confirmar manualmente a reserva de ${candidato.nome}? Esta ação ficará registrada no histórico.`))
      return;

    setUpdatingId(candidato.id);
    try {
      await candidatosService.confirmReservationManually(candidato.id, motivo);
      toast.success('Reserva confirmada manualmente.');
      await fetchCandidatos();
    } catch (error) {
      toast.error(error.message || 'Não foi possível confirmar a reserva.');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-[#7a7a7a]">
        <Loader2 className="h-8 w-8 animate-spin text-[#0066cc]" />
        <p className="text-xs">Carregando candidatos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Triagem de Candidatos"
        description="Fila de avaliação e captação de novos motoristas para sua frota"
        actions={
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-black/15 bg-white px-4 text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            <span>Atualizar fila</span>
          </button>
        }
      />

      {/* Card do Link Público de Inscrição */}
      <section className="rounded-[18px] border border-black/10 bg-white p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-none">
        <div className="flex items-start gap-3.5">
          <div
            className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
              applicationLinkStatus.active ? 'bg-emerald-500 ring-4 ring-emerald-100' : 'bg-[#7a7a7a]'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm sm:text-base text-[#1d1d1f]">Link Público de Inscrição</h3>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  applicationLinkStatus.active
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-[#f5f5f7] text-[#7a7a7a]'
                }`}
              >
                {applicationLinkStatus.loading ? '...' : applicationLinkStatus.active ? 'Ativo' : 'Desativado'}
              </span>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-[#7a7a7a]">
              {applicationLinkStatus.loading
                ? 'Consultando status...'
                : applicationLinkStatus.error
                ? 'Falha ao consultar status do link.'
                : applicationLinkStatus.active
                ? 'Candidatos que acessarem o link podem enviar fichas de inscrição diretamente para sua triagem.'
                : 'O link está inativo e não recebe novas inscrições.'}
            </p>
            {!applicationLinkStatus.loading && !applicationLinkStatus.error && (
              <p className="mt-1 text-xs text-[#7a7a7a]">
                {formatLinkExpiration(applicationLinkStatus.expiresAt, applicationLinkStatus.active)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {applicationLinkStatus.active && (
            <button
              type="button"
              onClick={handleCopyApplicationLink}
              disabled={applicationLinkBusy || applicationLinkStatus.loading}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-black/15 bg-white px-4 text-xs sm:text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95 disabled:opacity-50"
            >
              <Copy size={15} className="text-[#0066cc]" />
              <span>Copiar link</span>
            </button>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={applicationLinkStatus.active}
            onClick={handleToggleApplicationLink}
            disabled={applicationLinkBusy || applicationLinkStatus.loading || applicationLinkStatus.error}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors disabled:cursor-wait disabled:opacity-60 ${
              applicationLinkStatus.active ? 'bg-[#0066cc]' : 'bg-[#7a7a7a]/30'
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                applicationLinkStatus.active ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Erro ao carregar */}
      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <AlertCircle size={16} /> {loadError}
          </span>
          <button onClick={handleRefresh} disabled={refreshing} className="font-semibold underline">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="grid gap-3 rounded-[18px] border border-black/10 bg-white p-3 sm:p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a]" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nome ou telefone..."
            className="w-full rounded-xl border border-black/15 bg-[#f5f5f7] py-2.5 pl-9 pr-3 text-sm text-[#1d1d1f] outline-none placeholder:text-[#7a7a7a] focus:border-[#0066cc]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-black/15 bg-[#f5f5f7] px-3 py-2.5 text-sm text-[#1d1d1f] outline-none focus:border-[#0066cc]"
        >
          <option value="Todos">Todos os status</option>
          {Object.values(CANDIDATO_STATUS).map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>

        <select
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-black/15 bg-[#f5f5f7] px-3 py-2.5 text-sm text-[#1d1d1f] outline-none focus:border-[#0066cc]"
        >
          <option value="score_desc">Maior pontuação (Score)</option>
          <option value="score_asc">Menor pontuação</option>
          <option value="name_asc">Nome do candidato (A-Z)</option>
          <option value="name_desc">Nome do candidato (Z-A)</option>
          <option value="date_desc">Mais recentes</option>
          <option value="date_asc">Mais antigos</option>
        </select>
      </div>

      {/* Lista de Candidatos */}
      {filteredCandidates.length === 0 ? (
        <div className="rounded-[18px] border border-black/10 bg-white px-6 py-16 text-center">
          <ClipboardCheck size={36} className="mx-auto text-[#7a7a7a]/50 mb-2" />
          <p className="font-semibold text-[#1d1d1f]">
            {candidatos.length === 0 ? 'Nenhum candidato na fila' : 'Nenhum candidato corresponde aos filtros'}
          </p>
          <p className="mt-1 text-xs text-[#7a7a7a]">
            {candidatos.length === 0
              ? 'Compartilhe o link de inscrição para começar a receber motoristas interessados.'
              : 'Tente limpar a busca ou selecionar outro status.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-[#7a7a7a]">
            {filteredCandidates.length} candidato{filteredCandidates.length === 1 ? '' : 's'} na fila
          </p>

          <div className="space-y-3">
            {pageCandidates.map((candidato, index) => {
              const status = canonicalizarStatusCandidato(candidato.status);
              const ranking = (page - 1) * ITEMS_PER_PAGE + index;
              const canApprove = podeAlterarStatusCandidato(status, CANDIDATO_STATUS.PRE_APROVADO);
              const canReject =
                !candidato.reserva_idempotency_key && podeAlterarStatusCandidato(status, CANDIDATO_STATUS.REPROVADO);
              const paymentStatus = String(candidato.pagamento_status || '').trim().toLocaleLowerCase('pt-BR');
              const paymentExpired = candidato.reserva_expira_em && new Date(candidato.reserva_expira_em) <= new Date();
              const canReopenPix =
                status === CANDIDATO_STATUS.AGUARDANDO_RESERVA &&
                ['pendente', 'processando', 'autorizado'].includes(paymentStatus) &&
                Boolean(
                  candidato.pagamento_id &&
                    candidato.pix_qr_code &&
                    candidato.pix_copia_e_cola &&
                    candidato.reserva_expira_em
                ) &&
                !paymentExpired;
              const canConfirmManually =
                [CANDIDATO_STATUS.AGUARDANDO_RESERVA, CANDIDATO_STATUS.PRE_APROVADO].includes(status) &&
                (!candidato.pagamento_id ||
                  paymentExpired ||
                  ['rejeitado', 'cancelado', 'expirado', 'reembolsado'].includes(paymentStatus));
              const busy = updatingId === candidato.id || processingId === candidato.id;

              const cleanPhone = String(candidato.telefone ?? '').replace(/\D/g, '');

              return (
                <div
                  key={candidato.id}
                  className="group flex flex-col items-stretch gap-4 rounded-[18px] border border-black/10 bg-white p-4 sm:p-5 transition-colors hover:border-black/20 md:flex-row md:items-center md:justify-between"
                >
                  {/* Posição no Ranking */}
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold shrink-0 ${
                        ranking === 0
                          ? 'bg-amber-100 text-amber-900 border border-amber-200'
                          : ranking === 1
                          ? 'bg-slate-200 text-slate-800 border border-slate-300'
                          : ranking === 2
                          ? 'bg-orange-100 text-orange-900 border border-orange-200'
                          : 'bg-[#f5f5f7] text-[#7a7a7a] border border-black/5'
                      }`}
                    >
                      {ranking + 1}º
                    </div>

                    {/* Dados Básicos */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-[#1d1d1f] text-base truncate">{candidato.nome}</h4>
                        {ranking === 0 && <Star size={16} className="text-amber-500 fill-amber-500 shrink-0" />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#7a7a7a]">
                        {cleanPhone ? (
                          <a
                            href={`https://wa.me/55${cleanPhone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                            title="Conversar no WhatsApp"
                          >
                            <MessageCircle size={13} className="text-emerald-600" />
                            {candidato.telefone}
                          </a>
                        ) : (
                          <span>{candidato.telefone || 'Sem telefone'}</span>
                        )}
                        <span>•</span>
                        <span>CPF: {maskCpf(candidato.cpf)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Score */}
                  <div className="flex items-center justify-between md:justify-center border-t border-b md:border-t-0 md:border-b-0 md:border-x border-black/5 py-2 md:py-0 md:px-6">
                    <div className="text-left md:text-center">
                      <div className="flex items-center gap-1 text-lg font-bold text-[#0066cc]">
                        <Zap size={16} />
                        {candidato.score_formulario == null || candidato.score_formulario === ''
                          ? '—'
                          : candidato.score_formulario}
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7a7a7a]">
                        Score Triagem
                      </span>
                    </div>

                    {/* Status Badge */}
                    <div className="flex flex-col items-end md:hidden">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          statusStyles[status] || 'bg-[#f5f5f7] text-[#7a7a7a]'
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                  </div>

                  {/* Status & Ações */}
                  <div className="flex items-center justify-between md:justify-end gap-3">
                    <div className="hidden md:flex flex-col items-end">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          statusStyles[status] || 'bg-[#f5f5f7] text-[#7a7a7a]'
                        }`}
                      >
                        {status}
                      </span>
                      {candidato.pagamento_status && (
                        <span className="text-[10px] text-[#7a7a7a] mt-0.5">PIX: {candidato.pagamento_status}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Ver Detalhes */}
                      <button
                        onClick={() => setDetailCandidate(candidato)}
                        disabled={busy}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/15 text-[#1d1d1f] hover:bg-black/5 transition"
                        title="Ver ficha completa"
                        aria-label={`Ver ficha de ${candidato.nome}`}
                      >
                        <Eye size={16} />
                      </button>

                      {/* Pré-aprovar */}
                      {canApprove && (
                        <button
                          onClick={() => handleAction(candidato, CANDIDATO_STATUS.PRE_APROVADO)}
                          disabled={busy}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-xs font-medium text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition active:scale-95"
                          title="Pré-aprovar perfil"
                        >
                          <CheckCircle size={14} /> Pré-aprovar
                        </button>
                      )}

                      {/* Gerar PIX Reserva */}
                      {status === CANDIDATO_STATUS.PRE_APROVADO && (
                        <button
                          onClick={() => handleReservarVaga(candidato)}
                          disabled={busy}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#0066cc] px-3.5 text-xs font-medium text-white hover:bg-[#005ab4] transition active:scale-95 disabled:opacity-50"
                        >
                          {processingId === candidato.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            'Gerar PIX Reserva'
                          )}
                        </button>
                      )}

                      {/* Reabrir PIX */}
                      {canReopenPix && (
                        <button
                          onClick={() => handleReabrirPix(candidato)}
                          disabled={busy}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#0066cc]/30 bg-blue-50 px-3 text-xs font-medium text-[#0066cc] hover:bg-blue-100 transition"
                        >
                          Ver PIX
                        </button>
                      )}

                      {/* Confirmar Manualmente */}
                      {canConfirmManually && (
                        <button
                          onClick={() => handleConfirmarManualmente(candidato)}
                          disabled={busy}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-black/15 bg-white px-3 text-xs font-medium text-[#1d1d1f] hover:bg-black/5 transition"
                          title="Confirmar reserva recebida por outro meio"
                        >
                          Confirmar reserva
                        </button>
                      )}

                      {/* Reprovar */}
                      {canReject && (
                        <button
                          onClick={() => handleAction(candidato, CANDIDATO_STATUS.REPROVADO)}
                          disabled={busy}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition"
                          title="Reprovar candidato"
                          aria-label={`Reprovar ${candidato.nome}`}
                        >
                          <UserMinus size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-3 pt-4" aria-label="Paginação dos candidatos">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-black/15 bg-white px-3.5 text-xs font-medium text-[#1d1d1f] hover:bg-black/5 disabled:opacity-40"
              >
                <ChevronLeft size={15} /> Anterior
              </button>
              <span className="text-xs text-[#7a7a7a]">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-black/15 bg-white px-3.5 text-xs font-medium text-[#1d1d1f] hover:bg-black/5 disabled:opacity-40"
              >
                Próxima <ChevronRight size={15} />
              </button>
            </nav>
          )}
        </>
      )}

      {/* Modais de Suporte */}
      <PixModal isOpen={isPixModalOpen} onClose={() => setIsPixModalOpen(false)} pixData={pixData} />
      {detailCandidate && <CandidatoDetalheModal candidato={detailCandidate} onClose={() => setDetailCandidate(null)} />}

      {/* Modal de Exibição do Link */}
      {applicationLink && isApplicationLinkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
          onMouseDown={(event) => event.target === event.currentTarget && setIsApplicationLinkModalOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="application-link-title"
            className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-5 shadow-2xl text-[#1d1d1f]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-black/10 pb-3">
              <div>
                <h2 id="application-link-title" className="text-base font-semibold text-[#1d1d1f]">
                  Link de Inscrição Gerado
                </h2>
                <p className="mt-1 text-xs text-[#7a7a7a]">
                  Compartilhe com candidatos. {formatLinkExpiration(applicationLink.expiresAt, true)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsApplicationLinkModalOpen(false)}
                className="rounded-full p-1 text-[#7a7a7a] hover:bg-black/5 hover:text-[#1d1d1f]"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </header>
            <div className="pt-4 space-y-3">
              <input
                readOnly
                value={applicationLink.url}
                className="w-full rounded-xl border border-black/15 bg-[#f5f5f7] px-3.5 py-2.5 text-xs font-mono text-[#1d1d1f] outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(applicationLink.url)
                      .then(() => toast.success('Link copiado!'))
                      .catch(() => toast.error('Não foi possível copiar.'))
                  }
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#0066cc] px-4 text-xs font-medium text-white hover:bg-[#005ab4]"
                >
                  <Copy size={14} /> Copiar link
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Triagem;
