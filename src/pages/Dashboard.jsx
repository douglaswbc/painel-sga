import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  HandCoins,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  RefreshCw,
  X,
  Car,
  ClipboardCheck,
  Link as LinkIcon,
  Plus,
  Users,
  Check,
  Percent,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { cobrancasService } from '../services/cobrancas';
import { candidatosService } from '../services/candidatos';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import ExpirationTimer from '../components/ExpirationTimer';

const PAGE_SIZE = 8;
const FILTERS = [
  { value: 'all', label: 'Todas as pendentes' },
  { value: 'atrasado', label: 'Atrasadas' },
  { value: 'pendente', label: 'No prazo' },
  { value: 'pago', label: 'Pagas' },
];

const currency = (value) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });

const dateLabel = (date) => {
  if (!date) return 'Sem vencimento';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'Sem vencimento' : parsed.toLocaleDateString('pt-BR');
};

const formatCreatedAt = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};

const isRecentlyGenerated = (dateString) => {
  if (!dateString) return false;
  const date = new Date(dateString).getTime();
  if (Number.isNaN(date)) return false;
  const diffHours = (Date.now() - date) / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= 24;
};

const pixExpiration = (charge) => {
  if (charge.pix_expires_at) return charge.pix_expires_at;
  if (!charge.created_at) return null;
  const createdAt = new Date(charge.created_at);
  if (Number.isNaN(createdAt.getTime())) return null;
  return new Date(createdAt.getTime() + 4 * 60 * 60 * 1000).toISOString();
};

const MetricCard = ({ title, value, detail, icon: Icon, tone = 'indigo' }) => {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-500/20',
    blue: 'bg-blue-50 text-[#0066cc] ring-[#0066cc]/20',
    rose: 'bg-red-50 text-red-700 ring-red-500/20',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-500/20',
    amber: 'bg-amber-50 text-amber-700 ring-amber-500/20',
  };

  return (
    <section className="min-w-0 rounded-[18px] border border-black/10 bg-white p-4 shadow-none sm:p-5 transition-colors hover:border-black/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#7a7a7a]">{title}</p>
          <p className="mt-2.5 truncate text-xl font-bold tracking-tight text-[#1d1d1f] sm:text-2xl">
            {value}
          </p>
        </div>
        <div className={`rounded-xl p-2.5 ring-1 ${tones[tone]}`}>
          <Icon size={19} aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#7a7a7a]">{detail}</p>
    </section>
  );
};

const ChargeIdentity = ({ charge }) => {
  const tenantName =
    charge.locatario_cobranca?.nome_completo ||
    charge.contratos?.locatarios?.nome_completo ||
    'Cobrança avulsa';
  const plate = charge.contratos?.veiculos?.placa;
  const createdDate = formatCreatedAt(charge.created_at);
  const recent = isRecentlyGenerated(charge.created_at);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <p className="truncate font-semibold text-[#1d1d1f]">{tenantName}</p>
        {recent && (
          <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-[#0066cc]">
            Mais recente
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#7a7a7a]">
        {plate && (
          <span className="rounded-md border border-black/10 bg-[#f5f5f7] px-1.5 py-0.5 font-mono font-medium text-[#1d1d1f]">
            {plate}
          </span>
        )}
        {charge.categoria && <span className="capitalize">{charge.categoria}</span>}
        {createdDate && <span className="text-[#7a7a7a]">Gerada em {createdDate}</span>}
        <span>{charge.tentativas_envio || 0} lembrete(s)</span>
      </div>
    </div>
  );
};

const usePixExpired = (expiresAt) => {
  const checkExpired = useCallback(() => {
    if (!expiresAt) return false;
    const expiration = new Date(expiresAt).getTime();
    return Number.isFinite(expiration) && expiration <= Date.now();
  }, [expiresAt]);

  const [expired, setExpired] = useState(checkExpired);

  useEffect(() => {
    if (!expiresAt) {
      return undefined;
    }
    const expiration = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiration)) return undefined;

    const timer = window.setInterval(() => {
      setExpired(expiration <= Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return expired;
};

const ChargeActions = ({ charge, processing, onSend, onOpenLink, compact = false }) => {
  const expiresAt = pixExpiration(charge);
  const pixExpired = usePixExpired(expiresAt);
  const name =
    charge.locatario_cobranca?.nome_completo ||
    charge.contratos?.locatarios?.nome_completo ||
    'Cobrança avulsa';
  const isPaid = charge.status === 'pago';

  if (isPaid) {
    return (
      <div className={compact ? 'flex items-center gap-2' : 'flex items-center justify-end gap-2'}>
        <span className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-3.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
          <CheckCircle2 size={15} aria-hidden="true" /> Cobrança paga
        </span>
      </div>
    );
  }

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex items-center justify-end gap-2'}>
      {charge.payment_link && (
        <button
          type="button"
          onClick={() => onOpenLink(charge.payment_link)}
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-black/15 bg-white text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95 ${
            compact ? 'flex-1' : 'px-4'
          }`}
          aria-label={`Abrir link de pagamento de ${name}`}
        >
          <ExternalLink size={15} aria-hidden="true" /> {compact ? 'Link PIX' : 'Link'}
        </button>
      )}
      <button
        type="button"
        onClick={() => onSend(charge)}
        disabled={processing || pixExpired}
        title={pixExpired ? 'Este PIX expirou e não pode receber lembretes.' : undefined}
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-emerald-50 px-4 text-sm font-medium text-emerald-700 border border-emerald-200 hover:bg-emerald-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? 'flex-1' : ''
        }`}
      >
        {processing ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} aria-hidden="true" />}
        {pixExpired ? 'PIX expirado' : 'Enviar cobrança'}
      </button>
      {pixExpired && !compact && (
        <Link to="/cobrancas" className="text-xs font-semibold text-red-600 underline underline-offset-2 hover:text-red-700">
          Revisar
        </Link>
      )}
      {pixExpired && compact && (
        <p className="basis-full text-xs text-red-600">
          PIX expirado.{' '}
          <Link to="/cobrancas" className="font-semibold underline underline-offset-2 hover:text-red-700">
            Revisar cobrança
          </Link>
          .
        </p>
      )}
    </div>
  );
};

const Dashboard = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');

  // Indicadores Operacionais de Frota e Candidatos
  const [fleetStats, setFleetStats] = useState({
    total: 0,
    alugados: 0,
    disponiveis: 0,
    inativos: 0,
    ocupacao: 0,
    loading: true,
  });

  const [candidateStats, setCandidateStats] = useState({
    emAnalise: 0,
    preAprovados: 0,
    total: 0,
    loading: true,
  });

  const [queue, setQueue] = useState({ items: [], total: 0, statusCounts: { atrasado: 0, pendente: 0 } });
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [activeLink, setActiveLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Link rápido de inscrição para novos motoristas
  const [copyingCandidateLink, setCopyingCandidateLink] = useState(false);
  const [candidateLinkCopied, setCandidateLinkCopied] = useState(false);

  const loadOperationalStats = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const stats = await cobrancasService.getDashboardOperationalStats();
      if (stats?.fleetStats) setFleetStats(stats.fleetStats);
      if (stats?.candidateStats) setCandidateStats(stats.candidateStats);
    } catch (err) {
      console.warn('Erro ao carregar métricas operacionais:', err);
    }
  }, [profile?.id]);

  const loadSummary = useCallback(async () => {
    if (!profile?.id) return;
    setSummaryError('');
    setSummaryLoading(true);
    try {
      setSummary(await cobrancasService.getDashboardSummary());
    } catch (error) {
      setSummaryError(error.message || 'Não foi possível carregar os indicadores.');
    } finally {
      setSummaryLoading(false);
    }
  }, [profile?.id]);

  const loadQueue = useCallback(async () => {
    if (!profile?.id) return;
    setQueueError('');
    setQueueLoading(true);
    try {
      const result = await cobrancasService.listDashboardCharges(profile.id, {
        page: currentPage,
        pageSize: PAGE_SIZE,
        status: filter,
      });
      setQueue(result);
    } catch (error) {
      setQueueError(error.message || 'Não foi possível carregar as cobranças.');
    } finally {
      setQueueLoading(false);
    }
  }, [profile?.id, currentPage, filter]);

  useEffect(() => {
    loadSummary();
    loadOperationalStats();
  }, [loadSummary, loadOperationalStats]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSummary(), loadOperationalStats(), loadQueue()]);
    setRefreshing(false);
  };

  const handleFilter = (nextFilter) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const handleSendReminder = async (charge) => {
    setProcessingId(charge.id);
    try {
      const result = await cobrancasService.gerarPix(charge.id);
      if (result?.success) {
        toast.success(result.alreadySent ? 'Este lembrete já foi enviado.' : 'Cobrança enviada pelo WhatsApp.');
        await handleRefresh();
      }
    } catch (error) {
      toast.error(error.message || 'Falha ao enviar a cobrança.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(activeLink);
      setCopied(true);
      toast.success('Link copiado.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar o link neste navegador.');
    }
  };

  // Ação de 1 clique para copiar o link de novos motoristas
  const handleQuickCopyCandidateLink = async () => {
    setCopyingCandidateLink(true);
    try {
      const statusRes = await candidatosService.getApplicationLinkStatus();
      let url = statusRes?.link?.url;

      if (!url || !statusRes?.link?.ativo) {
        const newLinkRes = await candidatosService.createApplicationLink();
        url = newLinkRes?.url;
      }

      if (url) {
        await navigator.clipboard.writeText(url);
        setCandidateLinkCopied(true);
        toast.success('Link de inscrição copiado! Envie para o motorista no WhatsApp.');
        setTimeout(() => setCandidateLinkCopied(false), 2500);
      } else {
        toast.info('Abra a tela de Triagem para configurar seu link.');
        navigate('/triagem');
      }
    } catch (err) {
      toast.error('Erro ao obter link: ' + (err.message || 'tente novamente.'));
    } finally {
      setCopyingCandidateLink(false);
    }
  };

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date()),
    []
  );

  useEffect(() => {
    if (!activeLink) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActiveLink('');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLink]);

  const totalPages = Math.max(1, Math.ceil(queue.total / PAGE_SIZE));
  const statusCounts = queue.statusCounts || { atrasado: 0, pendente: 0 };
  const paymentRate = summary?.adimplencia_mes == null ? null : Number(summary.adimplencia_mes);

  useEffect(() => {
    if (queue.total > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [queue.total, currentPage, totalPages]);

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-6 pb-8 sm:space-y-8">
      {/* Cabeçalho da Página */}
      <PageHeader
        icon={LayoutDashboard}
        title="Painel do Locador"
        description={`Visão consolidada da operação e financeiro de ${monthLabel}`}
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || summaryLoading || queueLoading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-medium text-[#1d1d1f] transition hover:bg-black/5 active:scale-95 disabled:cursor-wait disabled:opacity-60"
            aria-label="Atualizar painel"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Atualizar</span>
          </button>
        }
      />

      {/* 1. BARRA DE ATALHOS RÁPIDOS OPERACIONAIS */}
      <section className="rounded-[18px] border border-black/10 bg-white p-4 sm:p-5 shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">Ações Imediatas</h3>
            <p className="text-xs text-[#7a7a7a]">Atalhos para tarefas frequentes da sua rotina</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Botão de 1 clique: Copiar Link de Inscrição */}
            <button
              type="button"
              onClick={handleQuickCopyCandidateLink}
              disabled={copyingCandidateLink}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0066cc] px-4 text-xs sm:text-sm font-medium text-white transition hover:bg-[#005ab4] active:scale-95 disabled:opacity-50"
              title="Copiar link do formulário para enviar no WhatsApp"
            >
              {copyingCandidateLink ? (
                <Loader2 size={15} className="animate-spin" />
              ) : candidateLinkCopied ? (
                <Check size={15} />
              ) : (
                <LinkIcon size={15} />
              )}
              <span>{candidateLinkCopied ? 'Link Copiado!' : 'Copiar Link de Inscrição'}</span>
            </button>

            {/* Nova Cobrança */}
            <Link
              to="/cobrancas"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 text-xs sm:text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95"
            >
              <Plus size={15} className="text-[#0066cc]" />
              <span>Nova Cobrança</span>
            </Link>

            {/* Cadastrar Veículo */}
            <Link
              to="/veiculos"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 text-xs sm:text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95"
            >
              <Car size={15} className="text-[#0066cc]" />
              <span>Frota</span>
            </Link>

            {/* Cadastrar Locatário */}
            <Link
              to="/locatarios"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-black/15 bg-white px-3.5 text-xs sm:text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95"
            >
              <Users size={15} className="text-[#0066cc]" />
              <span>Locatários</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 2. RESUMO OPERACIONAL: FROTA & CANDIDATOS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Card de Frota */}
        <section className="rounded-[18px] border border-black/10 bg-white p-5 flex flex-col justify-between transition-colors hover:border-black/20">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-black/5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0066cc]">
                  <Car size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1d1d1f]">Frota de Veículos</h3>
                  <p className="text-xs text-[#7a7a7a]">{fleetStats.total} veículo(s) cadastrado(s)</p>
                </div>
              </div>

              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#0066cc] border border-blue-100">
                <Percent size={12} /> {fleetStats.ocupacao}% ocupação
              </span>
            </div>

            {/* Barra de Progresso de Ocupação da Frota */}
            <div className="mt-4">
              <div className="h-2.5 w-full rounded-full bg-[#f5f5f7] overflow-hidden flex">
                <div
                  className="bg-[#0066cc] transition-all duration-500"
                  style={{ width: `${fleetStats.ocupacao}%` }}
                  title={`${fleetStats.alugados} alugados`}
                />
              </div>
            </div>

            {/* Indicadores de Veículos */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50/70 p-3 border border-emerald-100">
                <p className="text-[11px] font-medium text-emerald-800">Disponíveis</p>
                <p className="mt-1 text-xl font-bold text-emerald-700">{fleetStats.disponiveis}</p>
                <p className="text-[10px] text-emerald-600">prontos p/ locar</p>
              </div>

              <div className="rounded-xl bg-blue-50/70 p-3 border border-blue-100">
                <p className="text-[11px] font-medium text-blue-800">Alugados</p>
                <p className="mt-1 text-xl font-bold text-[#0066cc]">{fleetStats.alugados}</p>
                <p className="text-[10px] text-blue-600">em contrato ativo</p>
              </div>

              <div className="rounded-xl bg-[#f5f5f7] p-3 border border-black/5">
                <p className="text-[11px] font-medium text-[#7a7a7a]">Oficina / Inativos</p>
                <p className="mt-1 text-xl font-bold text-[#1d1d1f]">{fleetStats.inativos}</p>
                <p className="text-[10px] text-[#7a7a7a]">indisponíveis</p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between text-xs">
            <span className="text-[#7a7a7a]">Status em tempo real da garagem</span>
            <Link
              to="/veiculos"
              className="inline-flex items-center gap-1 font-semibold text-[#0066cc] hover:underline"
            >
              Gerenciar veículos <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>

        {/* Card de Triagem & Pipeline */}
        <section className="rounded-[18px] border border-black/10 bg-white p-5 flex flex-col justify-between transition-colors hover:border-black/20">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-black/5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                  <ClipboardCheck size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1d1d1f]">Triagem de Candidatos</h3>
                  <p className="text-xs text-[#7a7a7a]">Pipeline de novos motoristas</p>
                </div>
              </div>

              {candidateStats.emAnalise > 0 ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
                  {candidateStats.emAnalise} aguardando análise
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  Tudo em dia
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl bg-[#f5f5f7] p-3 border border-black/5">
                <p className="text-[11px] font-medium text-[#7a7a7a]">Em Análise</p>
                <p className="mt-1 text-xl font-bold text-amber-700">{candidateStats.emAnalise}</p>
                <p className="text-[10px] text-[#7a7a7a]">requer avaliação</p>
              </div>

              <div className="rounded-xl bg-blue-50/70 p-3 border border-blue-100">
                <p className="text-[11px] font-medium text-blue-800">Pré-aprovados</p>
                <p className="mt-1 text-xl font-bold text-[#0066cc]">{candidateStats.preAprovados}</p>
                <p className="text-[10px] text-blue-600">aguardando reserva</p>
              </div>
            </div>

            {/* Dica de captação */}
            <div className="mt-4 rounded-xl border border-black/5 bg-[#fafafc] p-3 text-xs text-[#7a7a7a] flex items-center justify-between">
              <span>Compartilhe o formulário público com interessados</span>
              <button
                type="button"
                onClick={handleQuickCopyCandidateLink}
                className="font-semibold text-[#0066cc] hover:underline shrink-0"
              >
                Copiar link
              </button>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between text-xs">
            <span className="text-[#7a7a7a]">Total de {candidateStats.total} inscrições recebidas</span>
            <Link
              to="/triagem"
              className="inline-flex items-center gap-1 font-semibold text-[#0066cc] hover:underline"
            >
              Abrir triagem <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>
      </div>

      {/* 3. RESUMO FINANCEIRO (Apple Cards) */}
      {summaryError ? (
        <section className="flex flex-col gap-3 rounded-[18px] border border-red-200 bg-red-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
            <div>
              <p className="font-semibold">Falha ao carregar o resumo financeiro</p>
              <p className="mt-1 text-red-600">{summaryError}</p>
            </div>
          </div>
          <button
            onClick={loadSummary}
            className="min-h-10 rounded-full border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-100"
          >
            Tentar novamente
          </button>
        </section>
      ) : null}

      {summaryLoading && !summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Carregando indicadores">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-[18px] border border-black/10 bg-white" />
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Saldo líquido no mês"
              value={currency(summary.saldo_liquido_mes)}
              detail="Receitas pagas menos despesas pagas neste mês"
              icon={CircleDollarSign}
              tone="emerald"
            />
            <MetricCard
              title="A receber no mês"
              value={currency(summary.receita_a_receber)}
              detail="Cobranças no prazo e atrasadas"
              icon={HandCoins}
              tone="blue"
            />
            <MetricCard
              title="Total em atraso"
              value={currency(summary.total_atrasado)}
              detail={`${statusCounts.atrasado} cobrança(s) atrasada(s)`}
              icon={AlertCircle}
              tone="rose"
            />
            <MetricCard
              title="Contratos ativos"
              value={Number(summary.contratos_ativos || 0).toLocaleString('pt-BR')}
              detail="Locações vigentes no momento"
              icon={FileText}
              tone="indigo"
            />
          </div>

          {/* Barra de Adimplência do Mês */}
          <section className="rounded-[18px] border border-black/10 bg-white p-4 sm:flex sm:items-center sm:gap-6 sm:p-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="rounded-xl bg-amber-50 p-2.5 text-amber-700 ring-1 ring-amber-500/15">
                <CheckCircle2 size={19} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-sm font-semibold text-[#1d1d1f]">Taxa de Adimplência do Mês</h2>
                  <span className="text-sm font-bold text-[#1d1d1f]">
                    {paymentRate == null ? 'Sem cobranças vencidas' : `${paymentRate.toLocaleString('pt-BR')}%`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#7a7a7a]">
                  {paymentRate == null
                    ? 'Ainda não há cobranças com vencimento neste mês até hoje.'
                    : `${Number(summary.cobrancas_pagas_mes || 0)} de ${Number(
                        summary.cobrancas_vencidas_mes || 0
                      )} cobranças vencidas até hoje foram quitadas.`}
                </p>
                {paymentRate != null && (
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-[#f5f5f7]"
                    role="progressbar"
                    aria-label="Adimplência do mês"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(paymentRate, 100)}
                  >
                    <div
                      className="h-full rounded-full bg-[#0066cc] transition-all"
                      style={{ width: `${Math.min(paymentRate, 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {/* 4. FILA DE COBRANÇAS GERADAS E PENDÊNCIAS */}
      <section className="overflow-hidden rounded-[18px] border border-black/10 bg-white shadow-none">
        <div className="flex flex-col gap-4 border-b border-black/10 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Clock3 size={18} className="text-[#0066cc]" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[#1d1d1f] sm:text-lg">Fila de Cobranças e Atrasos</h2>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-[#7a7a7a]">
              {statusCounts.atrasado || 0} atrasada(s) · {statusCounts.pendente || 0} no prazo · Mais recentes primeiro
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar cobranças">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleFilter(option.value)}
                aria-pressed={filter === option.value}
                className={`min-h-9 rounded-full px-3.5 text-xs sm:text-sm font-medium transition ${
                  filter === option.value
                    ? 'bg-[#0066cc] text-white shadow-sm'
                    : 'bg-[#f5f5f7] text-[#7a7a7a] hover:bg-black/5 hover:text-[#1d1d1f]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {queueError ? (
          <div className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-600">Não foi possível carregar a fila: {queueError}</p>
            <button
              onClick={loadQueue}
              className="min-h-10 rounded-full border border-black/15 px-4 text-sm font-medium text-[#1d1d1f] hover:bg-black/5"
            >
              Tentar novamente
            </button>
          </div>
        ) : queueLoading ? (
          <div className="space-y-3 p-4" aria-label="Carregando cobranças">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-xl bg-[#f5f5f7]" />
            ))}
          </div>
        ) : queue.items.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center sm:py-16">
            <div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-emerald-700">
              <CheckCircle2 size={26} aria-hidden="true" />
            </div>
            <h3 className="font-semibold text-[#1d1d1f]">
              {filter === 'all'
                ? 'Tudo em dia!'
                : `Nenhuma cobrança ${
                    filter === 'atrasado' ? 'atrasada' : filter === 'pendente' ? 'no prazo' : 'paga'
                  }`}
            </h3>
            <p className="mt-1 max-w-md text-sm text-[#7a7a7a]">
              {filter === 'all'
                ? 'Não há cobranças pendentes para exibir no momento.'
                : `Não foram encontradas cobranças com o filtro "${filter}".`}
            </p>
            <Link
              to="/cobrancas"
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-black/15 bg-white px-4 text-sm font-medium text-[#1d1d1f] hover:bg-black/5"
            >
              Abrir todas as cobranças <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            {/* Lista Mobile */}
            <div className="divide-y divide-black/5 lg:hidden">
              {queue.items.map((charge) => {
                const expiresAt = pixExpiration(charge);
                return (
                  <article key={charge.id} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <ChargeIdentity charge={charge} />
                      <StatusBadge status={charge.status}>{charge.status}</StatusBadge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#f5f5f7] p-3">
                      <div>
                        <p className="text-[11px] text-[#7a7a7a]">Valor</p>
                        <p className="mt-1 font-semibold text-[#1d1d1f]">{currency(charge.valor)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-[#7a7a7a]">Vencimento</p>
                        <p className="mt-1 font-medium text-[#1d1d1f]">{dateLabel(charge.data_vencimento)}</p>
                      </div>
                      {expiresAt && (
                        <div className="col-span-2">
                          <ExpirationTimer expiresAt={expiresAt} />
                        </div>
                      )}
                    </div>
                    <ChargeActions
                      charge={charge}
                      processing={processingId === charge.id}
                      onSend={handleSendReminder}
                      onOpenLink={(link) => {
                        setActiveLink(link);
                        setCopied(false);
                      }}
                      compact
                    />
                  </article>
                );
              })}
            </div>

            {/* Tabela Desktop */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left">
                <thead className="bg-[#fafafc] border-b border-black/5">
                  <tr>
                    <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">Locatário / Veículo</th>
                    <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">Vencimento / PIX</th>
                    <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">Valor</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-[#7a7a7a]">Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-[#7a7a7a]">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {queue.items.map((charge) => {
                    const expiresAt = pixExpiration(charge);
                    return (
                      <tr key={charge.id} className="transition hover:bg-black/[0.015]">
                        <td className="max-w-xs px-5 py-4">
                          <ChargeIdentity charge={charge} />
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm text-[#1d1d1f]">{dateLabel(charge.data_vencimento)}</p>
                          {expiresAt && (
                            <div className="mt-2">
                              <ExpirationTimer expiresAt={expiresAt} />
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 font-semibold text-[#1d1d1f]">{currency(charge.valor)}</td>
                        <td className="px-5 py-4 text-center">
                          <StatusBadge status={charge.status}>{charge.status}</StatusBadge>
                        </td>
                        <td className="px-5 py-4">
                          <ChargeActions
                            charge={charge}
                            processing={processingId === charge.id}
                            onSend={handleSendReminder}
                            onOpenLink={(link) => {
                              setActiveLink(link);
                              setCopied(false);
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {queue.total > PAGE_SIZE && (
              <div className="border-t border-black/5">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPrev={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  onNext={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  label={`Página ${currentPage} de ${totalPages} · ${queue.total} cobranças`}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* Modal de Link PIX */}
      {activeLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveLink('');
          }}
        >
          <section
            className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-link-title"
          >
            <div className="flex items-center justify-between border-b border-black/10 pb-4">
              <div>
                <h2 id="payment-link-title" className="font-semibold text-[#1d1d1f]">
                  Link de Pagamento
                </h2>
                <p className="mt-1 text-xs text-[#7a7a7a]">Copie ou abra o link PIX desta cobrança.</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveLink('')}
                className="rounded-full p-2 text-[#7a7a7a] hover:bg-black/5 hover:text-[#1d1d1f]"
                aria-label="Fechar janela"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 pt-4">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={activeLink}
                  aria-label="URL de pagamento"
                  className="min-w-0 flex-1 rounded-xl border border-black/15 bg-[#f5f5f7] px-3.5 py-2.5 text-sm text-[#1d1d1f] outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0066cc] px-4 text-sm font-medium text-white hover:bg-[#005ab4]"
                >
                  {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                  <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <a
                href={activeLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-black/15 bg-white px-4 text-sm font-medium text-[#1d1d1f] hover:bg-black/5"
              >
                Abrir link em outra aba <ExternalLink size={15} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
