import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { cobrancasService } from '../services/cobrancas';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { StatusBadge } from '../components/ui/StatusBadge';
import ExpirationTimer from '../components/ExpirationTimer';

const PAGE_SIZE = 8;
const FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'atrasado', label: 'Atrasadas' },
  { value: 'pendente', label: 'Pendentes' },
];

const currency = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
});

const dateLabel = (date) => {
  if (!date) return 'Sem vencimento';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'Sem vencimento' : parsed.toLocaleDateString('pt-BR');
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
    emerald: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/15',
    blue: 'bg-blue-500/10 text-blue-300 ring-blue-500/15',
    rose: 'bg-rose-500/10 text-rose-300 ring-rose-500/15',
    indigo: 'bg-indigo-500/10 text-indigo-300 ring-indigo-500/15',
  };

  return (
    <section className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-400">{title}</p>
          <p className="mt-3 truncate text-xl font-bold tracking-tight text-white sm:text-2xl">{value}</p>
        </div>
        <div className={`rounded-xl p-2.5 ring-1 ${tones[tone]}`}>
          <Icon size={19} aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-500">{detail}</p>
    </section>
  );
};

const ChargeIdentity = ({ charge }) => {
  const tenantName = charge.locatario_cobranca?.nome_completo
    || charge.contratos?.locatarios?.nome_completo
    || 'Cobrança avulsa';
  const plate = charge.contratos?.veiculos?.placa;

  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-white">{tenantName}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {plate && <span className="rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-zinc-300">{plate}</span>}
        {charge.categoria && <span className="capitalize">{charge.categoria}</span>}
        <span>{charge.tentativas_envio || 0} lembrete(s)</span>
      </div>
    </div>
  );
};

const usePixExpired = (expiresAt) => {
  const [expired, setExpired] = useState(() => Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now()));

  useEffect(() => {
    if (!expiresAt) {
      setExpired(false);
      return undefined;
    }
    const expiration = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiration)) return undefined;
    const update = () => setExpired(expiration <= Date.now());
    update();
    if (expiration <= Date.now()) return undefined;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return expired;
};

const ChargeActions = ({ charge, processing, onSend, onOpenLink, compact = false }) => {
  const expiresAt = pixExpiration(charge);
  const pixExpired = usePixExpired(expiresAt);
  const name = charge.locatario_cobranca?.nome_completo || charge.contratos?.locatarios?.nome_completo || 'Cobrança avulsa';

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex items-center justify-end gap-2'}>
      {charge.payment_link && (
        <button
          type="button"
          onClick={() => onOpenLink(charge.payment_link)}
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 ${compact ? 'flex-1' : 'px-3'}`}
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
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'flex-1' : ''}`}
      >
        {processing ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} aria-hidden="true" />}
        {pixExpired ? 'PIX expirado' : 'Enviar cobrança'}
      </button>
      {pixExpired && !compact && <Link to="/cobrancas" className="text-xs font-semibold text-rose-300 underline underline-offset-2 hover:text-rose-100">Revisar</Link>}
      {pixExpired && compact && <p className="basis-full text-xs text-rose-300">PIX expirado. <Link to="/cobrancas" className="font-semibold underline underline-offset-2 hover:text-rose-100">Revisar cobrança</Link>.</p>}
    </div>
  );
};

const Dashboard = () => {
  const { profile } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [queue, setQueue] = useState({ items: [], total: 0, statusCounts: { atrasado: 0, pendente: 0 } });
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [activeLink, setActiveLink] = useState('');
  const [copied, setCopied] = useState(false);

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

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSummary(), loadQueue()]);
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

  const monthLabel = useMemo(() => new Intl.DateTimeFormat('pt-BR', {
    month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(new Date()), []);

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
      <PageHeader
        icon={LayoutDashboard}
        title="Visão geral"
        description={`Resumo financeiro de ${monthLabel}`}
        actions={(
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || summaryLoading || queueLoading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
            aria-label="Atualizar painel"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Atualizar</span>
          </button>
        )}
      />

      {summaryError ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
            <div>
              <p className="font-semibold">Falha ao carregar o resumo financeiro</p>
              <p className="mt-1 text-rose-200/70">{summaryError}</p>
            </div>
          </div>
          <button onClick={loadSummary} className="min-h-10 rounded-lg border border-rose-500/30 px-3 text-sm font-semibold text-rose-100 hover:bg-rose-500/10">Tentar novamente</button>
        </section>
      ) : null}

      {summaryLoading && !summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Carregando indicadores">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" />)}
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
              title="A receber"
              value={currency(summary.receita_a_receber)}
              detail="Cobranças pendentes e atrasadas"
              icon={HandCoins}
              tone="blue"
            />
            <MetricCard
              title="Em atraso"
              value={currency(summary.total_atrasado)}
              detail={`${statusCounts.atrasado} cobrança(s) atrasada(s)`}
              icon={AlertCircle}
              tone="rose"
            />
            <MetricCard
              title="Contratos ativos"
              value={Number(summary.contratos_ativos || 0).toLocaleString('pt-BR')}
              detail="Total de contratos ativos cadastrados"
              icon={FileText}
              tone="indigo"
            />
          </div>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:flex sm:items-center sm:gap-6 sm:p-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-300 ring-1 ring-amber-500/15">
                <CheckCircle2 size={19} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-sm font-semibold text-white">Adimplência do mês</h2>
                  <span className="text-sm font-bold text-zinc-100">
                    {paymentRate == null ? 'Sem cobranças vencidas' : `${paymentRate.toLocaleString('pt-BR')}%`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {paymentRate == null
                    ? 'Ainda não há cobranças com vencimento neste mês até hoje.'
                    : `${Number(summary.cobrancas_pagas_mes || 0)} de ${Number(summary.cobrancas_vencidas_mes || 0)} cobranças vencidas até hoje foram pagas.`}
                </p>
                {paymentRate != null && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label="Adimplência do mês" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(paymentRate, 100)}>
                    <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${Math.min(paymentRate, 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-lg">
        <div className="flex flex-col gap-4 border-b border-zinc-800 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Clock3 size={18} className="text-amber-300" aria-hidden="true" />
              <h2 className="text-base font-bold text-white sm:text-lg">Cobranças que precisam de ação</h2>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {statusCounts.atrasado} atrasada(s) · {statusCounts.pendente} pendente(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar cobranças">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleFilter(option.value)}
                aria-pressed={filter === option.value}
                className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition ${filter === option.value
                  ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30'
                  : 'bg-zinc-950 text-zinc-400 ring-1 ring-zinc-800 hover:text-white'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {queueError ? (
          <div className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-rose-200">Não foi possível carregar a fila: {queueError}</p>
            <button onClick={loadQueue} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">Tentar novamente</button>
          </div>
        ) : queueLoading ? (
          <div className="space-y-3 p-4" aria-label="Carregando cobranças">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-zinc-800/70" />)}
          </div>
        ) : queue.items.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center sm:py-16">
            <div className="mb-4 rounded-2xl bg-emerald-500/10 p-4 text-emerald-300">
              <CheckCircle2 size={26} aria-hidden="true" />
            </div>
            <h3 className="font-semibold text-white">{filter === 'all' ? 'Tudo em dia' : `Nenhuma cobrança ${filter === 'atrasado' ? 'atrasada' : 'pendente'}`}</h3>
            <p className="mt-1 max-w-md text-sm text-zinc-500">Não há cobranças em aberto para mostrar neste filtro.</p>
            <Link to="/cobrancas" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
              Abrir cobranças <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            <div className="divide-y divide-zinc-800 lg:hidden">
              {queue.items.map((charge) => {
                const expiresAt = pixExpiration(charge);
                return (
                  <article key={charge.id} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <ChargeIdentity charge={charge} />
                      <StatusBadge status={charge.status}>{charge.status}</StatusBadge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-950/70 p-3">
                      <div>
                        <p className="text-[11px] text-zinc-500">Valor</p>
                        <p className="mt-1 font-semibold text-white">{currency(charge.valor)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-zinc-500">Vencimento</p>
                        <p className="mt-1 font-medium text-zinc-200">{dateLabel(charge.data_vencimento)}</p>
                      </div>
                      {expiresAt && <div className="col-span-2"><ExpirationTimer expiresAt={expiresAt} /></div>}
                    </div>
                    <ChargeActions
                      charge={charge}
                      processing={processingId === charge.id}
                      onSend={handleSendReminder}
                      onOpenLink={(link) => { setActiveLink(link); setCopied(false); }}
                      compact
                    />
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left">
                <thead className="bg-zinc-950/70">
                  <tr>
                    <th className="px-5 py-3 text-xs font-semibold text-zinc-500">Locatário / veículo</th>
                    <th className="px-5 py-3 text-xs font-semibold text-zinc-500">Vencimento / PIX</th>
                    <th className="px-5 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-zinc-500">Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-zinc-500">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {queue.items.map((charge) => {
                    const expiresAt = pixExpiration(charge);
                    return (
                      <tr key={charge.id} className="transition hover:bg-zinc-800/30">
                        <td className="max-w-xs px-5 py-4"><ChargeIdentity charge={charge} /></td>
                        <td className="px-5 py-4">
                          <p className="text-sm text-zinc-200">{dateLabel(charge.data_vencimento)}</p>
                          {expiresAt && <div className="mt-2"><ExpirationTimer expiresAt={expiresAt} /></div>}
                        </td>
                        <td className="px-5 py-4 font-semibold text-white">{currency(charge.valor)}</td>
                        <td className="px-5 py-4 text-center"><StatusBadge status={charge.status}>{charge.status}</StatusBadge></td>
                        <td className="px-5 py-4">
                          <ChargeActions
                            charge={charge}
                            processing={processingId === charge.id}
                            onSend={handleSendReminder}
                            onOpenLink={(link) => { setActiveLink(link); setCopied(false); }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {queue.total > PAGE_SIZE && (
              <div className="border-t border-zinc-800">
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

      {activeLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveLink(''); }}>
          <section className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="payment-link-title">
            <div className="flex items-center justify-between border-b border-zinc-800 p-4 sm:p-5">
              <div>
                <h2 id="payment-link-title" className="font-bold text-white">Link de pagamento</h2>
                <p className="mt-1 text-sm text-zinc-500">Copie ou abra o link PIX desta cobrança.</p>
              </div>
              <button type="button" onClick={() => setActiveLink('')} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Fechar janela">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <div className="flex gap-2">
                <input readOnly value={activeLink} aria-label="URL de pagamento" className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none" />
                <button type="button" onClick={handleCopyLink} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500">
                  {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}<span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <a href={activeLink} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-700">
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
