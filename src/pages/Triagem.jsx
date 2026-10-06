import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Copy, Eye, Loader2, Phone, RefreshCw, Search, ShieldCheck, Star, UserMinus, X, Zap } from 'lucide-react';
import { toast } from 'react-toastify';
import PixModal from '../components/PixModal';
import CandidatoDetalheModal from '../components/CandidatoDetalheModal';
import { useAuth } from '../contexts/AuthContext';
import { candidatosService } from '../services/candidatos';
import { CANDIDATO_STATUS, canonicalizarStatusCandidato, podeAlterarStatusCandidato } from '../utils/candidatoStatus';

const statusStyles = {
  [CANDIDATO_STATUS.ANALISE]: 'bg-slate-800 text-slate-300 border-slate-700',
  [CANDIDATO_STATUS.PRE_APROVADO]: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  [CANDIDATO_STATUS.AGUARDANDO_RESERVA]: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  [CANDIDATO_STATUS.RESERVADO]: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  [CANDIDATO_STATUS.REPROVADO]: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const ITEMS_PER_PAGE = 20;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESERVATION_AMOUNT = 25;
const maskCpf = (value) => String(value ?? '').replace(/\D/g, '').length === 11 ? '***.***.***-**' : '***';
const normalizeSearch = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
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
  const [applicationLinkStatus, setApplicationLinkStatus] = useState({ loading: true, exists: false, active: false, expiresAt: null, error: false });

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

  const fetchCandidatos = useCallback(async ({ quiet = false } = {}) => {
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
  }, [profile?.id]);

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
    await fetchCandidatos({ quiet: true });
    setRefreshing(false);
  };

  const handleCreateApplicationLink = async ({ confirmRotation = true } = {}) => {
    if (confirmRotation && applicationLinkStatus.active && !window.confirm('Gerar outro link? O endereço atual será invalidado.')) return;
    setApplicationLinkBusy(true);
    try {
      const result = await candidatosService.createApplicationLink();
      const url = new URL(`/inscricao/${result.token}`, window.location.origin).toString();
      setApplicationLink({ url, expiresAt: result.expiresAt });
      setIsApplicationLinkModalOpen(true);
      setApplicationLinkStatus({ loading: false, exists: true, active: true, expiresAt: result.expiresAt, error: false });
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link de inscrição gerado e copiado.');
      } catch {
        toast.success('Link de inscrição gerado. Copie-o na janela aberta.');
      }
    } catch (error) {
      toast.error(error.message || 'Não foi possível gerar o link de inscrição.');
    } finally {
      setApplicationLinkBusy(false);
    }
  };

  const handleToggleApplicationLink = async () => {
    if (!applicationLinkStatus.active) {
      if (applicationLinkStatus.exists && !window.confirm('Ativar o link vai gerar um novo endereço e invalidar o anterior. Continuar?')) return;
      await handleCreateApplicationLink({ confirmRotation: false });
      return;
    }
    if (!window.confirm('Desativar o link? Os candidatos não conseguirão mais enviar inscrições por esse endereço.')) return;
    setApplicationLinkBusy(true);
    try {
      await candidatosService.deactivateApplicationLink();
      setApplicationLinkStatus((current) => ({ ...current, active: false }));
      setApplicationLink(null);
      setIsApplicationLinkModalOpen(false);
      toast.success('Link de inscrição desativado.');
    } catch (error) {
      toast.error(error.message || 'Não foi possível desativar o link.');
    } finally {
      setApplicationLinkBusy(false);
    }
  };

  const handleCopyApplicationLink = async () => {
    if (applicationLink?.url) {
      try {
        await navigator.clipboard.writeText(applicationLink.url);
        toast.success('Link de inscrição copiado.');
      } catch {
        toast.error('Não foi possível copiar automaticamente. Use a janela do link para copiá-lo manualmente.');
        setIsApplicationLinkModalOpen(true);
      }
      return;
    }

    const confirmed = window.confirm('Por segurança, o código do link atual não pode ser recuperado. Para copiar, será gerado um novo endereço e o link anterior deixará de funcionar. Continuar?');
    if (confirmed) await handleCreateApplicationLink({ confirmRotation: false });
  };

  const handleAction = async (candidato, newStatus) => {
    if (!podeAlterarStatusCandidato(candidato.status, newStatus)) {
      toast.error('Esta mudança de status não é permitida. Atualize a fila e tente novamente.');
      return;
    }

    if (newStatus === CANDIDATO_STATUS.REPROVADO && !window.confirm('Deseja reprovar este candidato?')) return;

    setUpdatingId(candidato.id);
    try {
      await candidatosService.update(candidato.id, { status: newStatus });
      toast.success(`Candidato: ${newStatus}`);
      await fetchCandidatos();
    } catch {
      toast.error('Erro ao atualizar status');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReservarVaga = async (candidato) => {
    const email = window.prompt(`Confirme ou informe o e-mail de ${candidato.nome} para gerar o PIX:`, candidato.email || '')?.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Informe um e-mail válido para gerar o PIX.');
      return;
    }

    const defaultAmount = Number(candidato.reserva_valor ?? DEFAULT_RESERVATION_AMOUNT).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const amountInput = window.prompt('Informe o valor da taxa de reserva (de R$ 1,00 a R$ 10.000,00):', defaultAmount);
    if (amountInput === null) return;
    const amountCents = parseReservationAmount(amountInput);
    if (amountCents === null) {
      toast.error('Informe um valor entre R$ 1,00 e R$ 10.000,00 com até duas casas decimais.');
      return;
    }

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
      toast.error('Os dados deste PIX não estão disponíveis ou já expiraram. Atualize a fila para conferir o pagamento.');
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
    if (!window.confirm(`Confirmar manualmente a reserva de ${candidato.nome}? Esta ação ficará registrada no histórico.`)) return;

    setUpdatingId(candidato.id);
    try {
      await candidatosService.confirmReservationManually(candidato.id, motivo);
      toast.success('Reserva confirmada manualmente e registrada no histórico.');
      await fetchCandidatos();
    } catch (error) {
      toast.error(error.message || 'Não foi possível confirmar a reserva.');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>;
  }

  if (loadError && candidatos.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-card p-8 text-center">
        <AlertCircle className="mb-3 h-8 w-8 text-red-400" />
        <p className="font-semibold text-slate-50">Falha ao carregar a triagem</p>
        <p className="mt-2 max-w-md text-sm text-slate-300">{loadError}</p>
        <button onClick={handleRefresh} disabled={refreshing} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Fila de Prioridade</h2>
          <p className="text-sm text-slate-300">Ranqueamento baseado no perfil e potencial dos candidatos.</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button onClick={handleRefresh} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-white disabled:opacity-50">
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Atualizar fila
          </button>
        </div>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${applicationLinkStatus.active ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
          <div>
            <h3 className="font-semibold text-slate-50">Link público de inscrição</h3>
            <p className="mt-1 text-sm text-slate-300">
              {applicationLinkStatus.loading ? 'Consultando status do link…' : applicationLinkStatus.error ? 'Não foi possível consultar o status do link.' : applicationLinkStatus.active ? 'Ativo: candidatos podem enviar inscrições.' : applicationLinkStatus.exists ? 'Desativado: o endereço anterior não aceita inscrições.' : 'Ainda não existe um link de inscrição.'}
            </p>
            {!applicationLinkStatus.loading && applicationLinkStatus.error && (
              <button type="button" onClick={fetchApplicationLinkStatus} className="mt-1 text-xs font-semibold text-indigo-700 underline underline-offset-2">Tentar novamente</button>
            )}
            {!applicationLinkStatus.loading && !applicationLinkStatus.error && (
              <p className="mt-1 text-xs text-slate-300">{formatLinkExpiration(applicationLinkStatus.expiresAt, applicationLinkStatus.active)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 self-end sm:self-auto">
          {applicationLinkStatus.active && (
            <button type="button" onClick={handleCopyApplicationLink} disabled={applicationLinkBusy || applicationLinkStatus.loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-50">
              {applicationLinkBusy ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
              Copiar link
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={applicationLinkStatus.active}
            aria-label={applicationLinkStatus.active ? 'Desativar link de inscrição' : 'Ativar link de inscrição'}
            onClick={handleToggleApplicationLink}
            disabled={applicationLinkBusy || applicationLinkStatus.loading || applicationLinkStatus.error}
            className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors disabled:cursor-wait disabled:opacity-60 ${applicationLinkStatus.active ? 'bg-emerald-600' : 'bg-slate-300'}`}
          >
            {applicationLinkBusy ? <Loader2 size={17} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" /> : null}
            <span className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${applicationLinkStatus.active ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
          <span className={`min-w-12 text-sm font-semibold ${applicationLinkStatus.active ? 'text-emerald-700' : 'text-slate-300'}`}>{applicationLinkStatus.loading ? '…' : applicationLinkStatus.active ? 'Ativo' : 'Inativo'}</span>
        </div>
      </section>

      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700">
          <span className="flex items-center gap-2 text-red-700"><AlertCircle size={16} />{loadError}</span>
          <button onClick={handleRefresh} disabled={refreshing} className="font-semibold underline underline-offset-2 disabled:opacity-50">Tentar novamente</button>
        </div>
      )}

      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-card p-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
        <label className="relative block">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por nome ou telefone" className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-3 text-sm text-slate-50 outline-none placeholder:text-slate-300 focus:border-indigo-500" />
        </label>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500" aria-label="Filtrar por status">
          <option value="Todos">Todos os status</option>
          {Object.values(CANDIDATO_STATUS).map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value); setPage(1); }} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500" aria-label="Ordenar candidatos">
          <option value="score_desc">Maior pontuação</option>
          <option value="score_asc">Menor pontuação</option>
          <option value="date_desc">Mais recentes</option>
          <option value="date_asc">Mais antigos</option>
        </select>
      </div>

      {filteredCandidates.length === 0 ? (candidatos.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-card px-6 py-16 text-center">
          <p className="font-semibold text-slate-200">Nenhum candidato na fila</p>
          <p className="mt-1 text-sm text-slate-300">Quando houver novos candidatos, eles aparecerão aqui.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-card px-6 py-12 text-center">
          <p className="font-semibold text-slate-200">Nenhum resultado encontrado</p>
          <p className="mt-1 text-sm text-slate-300">Ajuste a busca ou os filtros para encontrar candidatos.</p>
        </div>
      )) : (
        <>
          <p className="text-xs text-slate-300">{filteredCandidates.length} candidato{filteredCandidates.length === 1 ? '' : 's'} encontrado{filteredCandidates.length === 1 ? '' : 's'}</p>
          <div className="grid grid-cols-1 gap-4">
          {pageCandidates.map((candidato, index) => {
            const status = canonicalizarStatusCandidato(candidato.status);
            const ranking = (page - 1) * ITEMS_PER_PAGE + index;
            const canApprove = podeAlterarStatusCandidato(status, CANDIDATO_STATUS.PRE_APROVADO);
            const canReject = !candidato.reserva_idempotency_key && podeAlterarStatusCandidato(status, CANDIDATO_STATUS.REPROVADO);
            const paymentStatus = String(candidato.pagamento_status || '').trim().toLocaleLowerCase('pt-BR');
            const paymentExpired = candidato.reserva_expira_em && new Date(candidato.reserva_expira_em) <= new Date();
            const canReopenPix = status === CANDIDATO_STATUS.AGUARDANDO_RESERVA
              && ['pendente', 'processando', 'autorizado'].includes(paymentStatus)
              && Boolean(candidato.pagamento_id && candidato.pix_qr_code && candidato.pix_copia_e_cola && candidato.reserva_expira_em)
              && !paymentExpired;
            const canConfirmManually = [CANDIDATO_STATUS.AGUARDANDO_RESERVA, CANDIDATO_STATUS.PRE_APROVADO].includes(status)
              && (!candidato.pagamento_id || paymentExpired || ['rejeitado', 'cancelado', 'expirado', 'reembolsado'].includes(paymentStatus));
            const busy = updatingId === candidato.id || processingId === candidato.id;

            return (
              <div key={candidato.id} className="group flex flex-col items-center gap-6 rounded-2xl border border-slate-800 bg-card p-5 shadow-lg transition-all hover:border-indigo-500/30 hover:shadow-indigo-500/5 md:flex-row">
                <div className="flex flex-col items-center">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black shadow-lg ${
                    ranking === 0 ? 'bg-amber-500 text-amber-950' :
                    ranking === 1 ? 'bg-slate-300 text-slate-50' :
                    ranking === 2 ? 'bg-orange-400 text-orange-950' :
                    'border border-slate-700 bg-slate-800 text-slate-300'
                  }`}>
                    {ranking + 1}º
                  </div>
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-tighter text-slate-300">Ranking</div>
                </div>

                <div className="min-w-0 flex-1 text-center md:text-left">
                  <h3 className="flex items-center justify-center gap-2 text-lg font-bold text-slate-50 md:justify-start">
                    {candidato.nome}
                    {ranking === 0 && <Star size={16} fill="currentColor" className="text-amber-500" />}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-300 md:justify-start">
                    <span className="flex items-center gap-1.5"><Phone size={14} className="text-slate-300" />{candidato.telefone}</span>
                    <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-slate-300" />CPF: {maskCpf(candidato.cpf)}</span>
                  </div>
                </div>

                <div className="hidden flex-col items-center justify-center border-x border-slate-800 px-6 lg:flex">
                  <div className="flex items-center gap-1 text-2xl font-black text-indigo-500">
                    <Zap size={20} className="fill-indigo-500/20" />
                    {candidato.score_formulario == null || candidato.score_formulario === '' ? '—' : candidato.score_formulario}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Score</div>
                </div>

                <div className="flex flex-col items-center gap-4 md:flex-row">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${statusStyles[status] || 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                      {status}
                    </span>
                    {candidato.pagamento_status && (
                      <span className="text-[10px] font-medium text-slate-300">PIX: {candidato.pagamento_status}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDetailCandidate(candidato)}
                      disabled={busy}
                      className="rounded-xl border border-slate-700 p-2.5 text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-white disabled:opacity-50"
                      title="Abrir ficha do candidato"
                      aria-label={`Abrir ficha de ${candidato.nome}`}
                    >
                      <Eye size={20} />
                    </button>
                    {canApprove && (
                      <button
                        onClick={() => handleAction(candidato, CANDIDATO_STATUS.PRE_APROVADO)}
                        disabled={busy}
                        className="rounded-xl bg-emerald-600/10 p-2.5 text-emerald-500 transition-all hover:bg-emerald-600 hover:text-white disabled:opacity-50"
                        title="Aprovar perfil"
                        aria-label={`Aprovar ${candidato.nome}`}
                      >
                        <CheckCircle size={22} />
                      </button>
                    )}

                    {status === CANDIDATO_STATUS.PRE_APROVADO && (
                      <button
                        onClick={() => handleReservarVaga(candidato)}
                        disabled={busy}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {processingId === candidato.id ? <Loader2 size={14} className="animate-spin" /> : 'Gerar PIX Reserva'}
                      </button>
                    )}

                    {canReopenPix && (
                      <button
                        onClick={() => handleReabrirPix(candidato)}
                        disabled={busy}
                        className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-indigo-300 transition-all hover:bg-indigo-500 hover:text-white disabled:opacity-50"
                      >
                        Abrir PIX
                      </button>
                    )}

                    {canConfirmManually && (
                      <button
                        onClick={() => handleConfirmarManualmente(candidato)}
                        disabled={busy}
                        className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-blue-400 transition-all hover:bg-blue-500 hover:text-white disabled:opacity-50"
                        title="Confirmar uma reserva recebida por outro meio"
                      >
                        Confirmar manualmente
                      </button>
                    )}

                    {canReject && (
                      <button
                        onClick={() => handleAction(candidato, CANDIDATO_STATUS.REPROVADO)}
                        disabled={busy}
                        className="rounded-xl bg-red-600/10 p-2.5 text-red-500 transition-all hover:bg-red-600 hover:text-white disabled:opacity-50"
                        title="Reprovar candidato"
                        aria-label={`Reprovar ${candidato.nome}`}
                      >
                        <UserMinus size={22} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-4" aria-label="Paginação dos candidatos">
              <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 disabled:opacity-40">
                <ChevronLeft size={16} /> Anterior
              </button>
              <span className="text-sm text-slate-300">Página {page} de {totalPages}</span>
              <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 disabled:opacity-40">
                Próxima <ChevronRight size={16} />
              </button>
            </nav>
          )}
        </>
      )}

      <PixModal isOpen={isPixModalOpen} onClose={() => setIsPixModalOpen(false)} pixData={pixData} />
      {detailCandidate && <CandidatoDetalheModal candidato={detailCandidate} onClose={() => setDetailCandidate(null)} />}
      {applicationLink && isApplicationLinkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setIsApplicationLinkModalOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="application-link-title" className="w-full max-w-lg rounded-2xl border border-slate-700 bg-card p-6 shadow-2xl">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id="application-link-title" className="text-lg font-bold text-white">Link de inscrição</h2>
                <p className="mt-1 text-sm text-slate-300">Compartilhe com candidatos. {formatLinkExpiration(applicationLink.expiresAt, true)}</p>
              </div>
              <button type="button" onClick={() => setIsApplicationLinkModalOpen(false)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Fechar"><X size={18} /></button>
            </header>
            <input readOnly value={applicationLink.url} className="mt-5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-200 outline-none" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => navigator.clipboard.writeText(applicationLink.url).then(() => toast.success('Link copiado.')).catch(() => toast.error('Não foi possível copiar o link.'))} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                <Copy size={16} /> Copiar link
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-300">Gerar outro link substitui este e invalida o anterior. Novas inscrições aparecerão nesta fila como “Em análise”.</p>
          </section>
        </div>
      )}
    </div>
  );
};

export default Triagem;
