import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, CircleDollarSign, Clock3, Copy, Loader2, RefreshCw, Search, Send, XCircle } from 'lucide-react';
import { api } from '../services/api';

const periodBounds = (period) => {
  const today = new Date();
  if (period === 'today') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return { start: start.toISOString(), end: today.toISOString() };
  }
  if (period === 'yesterday') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const start = period === 'month'
    ? new Date(today.getFullYear(), today.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(period) + 1);
  return { start: start.toISOString(), end: today.toISOString() };
};

const errorFrom = (error) => error?.message || 'Não foi possível carregar os dados.';

const formatDate = (value) => {
  if (!value) return 'Data indisponível';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleString('pt-BR');
};

const statusPresentation = {
  sent: { label: 'Enviada', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  failed: { label: 'Falhou', tone: 'text-red-700 bg-red-50 border-red-200', icon: XCircle },
  sending: { label: 'Em andamento', tone: 'text-amber-700 bg-amber-50 border-amber-200', icon: Clock3 },
};

// Status devolvido pelo provedor para cada mensagem enviada.
const deliveryPresentation = {
  accepted: { label: 'Aceita', tone: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  sent: { label: 'Enviada', tone: 'text-sky-700 bg-sky-50 border-sky-200' },
  delivered: { label: 'Entregue', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  read: { label: 'Lida', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  failed: { label: 'Falha na entrega', tone: 'text-red-700 bg-red-50 border-red-200' },
};

export default function ZernioOperationsCard() {
  const [period, setPeriod] = useState('month');
  const [analytics, setAnalytics] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityPage, setActivityPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [health, setHealth] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsNotice, setAnalyticsNotice] = useState('');
  const [activityError, setActivityError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const value = searchInput.trim();
      setSearchTerm(value.length >= 3 ? value : '');
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setAnalyticsError('');
    setAnalyticsNotice('');
    setActivityError('');
    const bounds = periodBounds(period);
    const analyticsParams = new URLSearchParams(bounds);
    const activityParams = new URLSearchParams({
      ...bounds,
      page: String(activityPage),
      pageSize: '25',
      ...(searchTerm ? { search: searchTerm } : {}),
    });

    const [costRes, activityRes, healthRes] = await Promise.allSettled([
      api.get(`/whatsapp/analytics?${analyticsParams.toString()}`),
      api.get(`/whatsapp/activity?${activityParams.toString()}`),
      api.get('/whatsapp/health'),
    ]);

    if (costRes.status === 'rejected') {
      setAnalytics([]);
      setAnalyticsError(errorFrom(costRes.reason));
    } else {
      const costData = costRes.value;
      setAnalytics(Array.isArray(costData?.analytics) ? costData.analytics : []);
      setAnalyticsNotice(costData?.message || 'Estimativa local com base nos envios registrados.');
    }

    if (activityRes.status === 'rejected') {
      setActivity([]);
      setActivityError(errorFrom(activityRes.reason));
    } else {
      const actData = activityRes.value;
      setActivity(Array.isArray(actData?.activity) ? actData.activity : []);
      setActivityTotal(Number(actData?.total) || 0);
      setActivityTotalPages(Number(actData?.totalPages) || 1);
    }

    if (healthRes.status === 'rejected') {
      setHealth({ status: 'unavailable', message: errorFrom(healthRes.reason) });
      setCallbackUrl('');
    } else {
      const hData = healthRes.value;
      setHealth({
        status: hData?.health || 'unavailable',
        message: hData?.message || 'Status indisponível.',
      });
      setCallbackUrl(hData?.callbackUrl || '');
    }
    setLoading(false);
  }, [period, activityPage, searchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const copyCallbackUrl = async () => {
    if (!callbackUrl) return;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* O landlord pode selecionar e copiar manualmente. */ }
  };

  const summary = useMemo(() => analytics.reduce((result, row) => ({
    volume: result.volume + (Number(row.volume) || 0),
    cost: result.cost + (Number(row.cost) || 0),
  }), { volume: 0, cost: 0 }), [analytics]);

  const categoryRows = useMemo(() => {
    const grouped = new Map();
    analytics.forEach((row) => {
      const key = `${row.category || 'OUTROS'}:${row.country || '—'}`;
      const current = grouped.get(key) || { category: row.category || 'OUTROS', country: row.country || '—', volume: 0, cost: 0 };
      current.volume += Number(row.volume) || 0;
      current.cost += Number(row.cost) || 0;
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.cost - a.cost);
  }, [analytics]);

  const estimatedFailures = activity.filter((item) => item.status === 'failed').length;
  const inProgress = activity.filter((item) => item.status === 'sending').length;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-700 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white"><CircleDollarSign size={18} className="text-indigo-500" /> Custos de mensagens</h2>
            <p className="mt-1 text-xs text-slate-500">Valores aproximados da Meta para o seu canal WhatsApp.</p>
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="Período de custos e logs" value={period} onChange={(event) => { setActivityPage(1); setPeriod(event.target.value); }} className="rounded-lg border border-slate-300 bg-[#f5f5f7] px-3 py-2 text-xs text-[#1d1d1f]">
              <option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="month">Este mês</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option>
            </select>
            <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </div>

        {analyticsError ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertCircle size={15} className="mt-0.5 shrink-0" />{analyticsError}</div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-500">Custo estimado (BRL)</p><p className="mt-1 text-2xl font-bold text-slate-900">{loading ? '—' : summary.cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 })}</p><p className="mt-1 text-[11px] text-slate-500">Estimativa por categoria do template e pais do destinatario.</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-500">Envios aceitos</p><p className="mt-1 text-2xl font-bold text-slate-900">{loading ? '—' : summary.volume.toLocaleString('pt-BR')}</p><p className="mt-1 text-[11px] text-slate-500">Volume encontrado nos logs no periodo selecionado.</p></div>
            </div>
            {analyticsNotice && <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertCircle size={15} className="mt-0.5 shrink-0" />{analyticsNotice}</div>}
            {categoryRows.length > 0 && <div className="mt-4 overflow-x-auto rounded-lg border border-[#e0e0e0] bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f5f5f7] text-[#66666a]"><tr><th className="px-3 py-2 font-semibold">Categoria</th><th className="px-3 py-2 font-semibold">País</th><th className="px-3 py-2 text-right font-semibold">Volume</th><th className="px-3 py-2 text-right font-semibold">Custo aproximado</th></tr></thead>
                <tbody className="divide-y divide-[#e0e0e0] bg-white">{categoryRows.map((row) => <tr key={`${row.category}-${row.country}`}><td className="px-3 py-2 font-medium text-[#1d1d1f]">{row.category}</td><td className="px-3 py-2 text-[#4b4b4d]">{row.country === 'UNKNOWN' ? 'Nao identificado' : row.country}</td><td className="px-3 py-2 text-right tabular-nums text-[#4b4b4d]">{row.volume.toLocaleString('pt-BR')}</td><td className="px-3 py-2 text-right tabular-nums text-[#1d1d1f]">{row.country === 'BR' ? row.cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td></tr>)}</tbody>
              </table>
            </div>}
          </>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Estimativa por envio registrado como aceito pela Zernio; a cobranca efetiva depende da entrega e pode variar conforme o parceiro.</p>
      </section>

      <section className="rounded-xl border border-slate-700 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-base font-bold text-white"><Activity size={18} className="text-indigo-500" /> Operação e logs de envio</h2><p className="mt-1 text-xs text-slate-500">Registros do período selecionado; busca por nome a partir de 3 caracteres.</p></div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500"><span><b className="text-red-700">{estimatedFailures}</b> falhas</span><span><b className="text-amber-700">{inProgress}</b> em andamento</span><span><Send size={13} className="inline" /> {activityTotal} registros</span></div>
        </div>
        <div className="mt-4 max-w-md">
          <label htmlFor="zernio-recipient-search" className="mb-1 block text-xs font-medium text-slate-600">Buscar destinatário por nome</label>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input id="zernio-recipient-search" type="search" value={searchInput} onChange={(event) => { setActivityPage(1); setSearchInput(event.target.value); }} placeholder="Digite pelo menos 3 caracteres" className="w-full rounded-lg border border-slate-300 bg-[#f5f5f7] py-2 pl-9 pr-3 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a]" />
          </div>
          {searchInput.trim().length > 0 && searchInput.trim().length < 3 && <p className="mt-1 text-[11px] text-slate-500">Digite mais {3 - searchInput.trim().length} caractere(s) para iniciar a busca.</p>}
        </div>
        <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${health?.status === 'connected' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {health?.status === 'connected' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
          <span><b>Canal WhatsApp:</b> {loading ? 'consultando...' : health?.message || 'Status indisponível.'}</span>
        </div>
        {callbackUrl && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">URL de callback entre a Meta e o SGA</p>
              <button type="button" onClick={copyCallbackUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">
                {copied ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Copy size={13} />}
                {copied ? 'Copiada' : 'Copiar'}
              </button>
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-slate-600">{callbackUrl}</p>
            <p className="mt-2 text-[11px] text-slate-500">
              Endereço que a Meta chama para entregar mensagens recebidas e o status de cada envio. É o mesmo valor a usar em
              <span className="font-mono"> Webhooks</span> no painel do App da Meta.
            </p>
          </div>
        )}
        {activityError ? <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"><AlertCircle size={15} className="mt-0.5 shrink-0" />{activityError}</div> : loading ? <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-indigo-500" /></div> : activity.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Nenhum envio registrado ainda.</p> : (
          <div className="mt-4 divide-y divide-[#e0e0e0] bg-white">
            {activity.map((item) => {
              const presentation = statusPresentation[item.status] || statusPresentation.sending;
              const StatusIcon = presentation.icon;
              const delivery = item.metaStatus ? deliveryPresentation[item.metaStatus] : null;
              return <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#1d1d1f]">{item.label}</p><p className="mt-1 text-[11px] text-[#66666a]">{({ charge: 'Cobranca', scheduled: 'Agendamento', payment: 'Confirmacao', manual: 'Envio manual' })[item.type] || 'Mensagem'} · {formatDate(item.occurredAt)}{item.category ? ` · ${item.category}` : ''}</p><p className="mt-1 text-xs text-[#4b4b4d]">Destinatario: <b>{item.recipientName}</b>{item.recipientPhone ? ` · ${item.recipientPhone}` : ''}</p>{item.error && <p className="mt-1 break-words text-xs text-red-700">{item.error}</p>}{item.messageId && <p className="mt-1 truncate font-mono text-[10px] text-[#66666a]">ID: {item.messageId}</p>}</div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${presentation.tone}`}><StatusIcon size={12} />{presentation.label}</span>
                  {delivery && <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold ${delivery.tone}`}>{delivery.label}</span>}
                </div>
              </article>;
            })}
          </div>
        )}
        {!activityError && !loading && activityTotalPages > 1 && <div className="mt-4 flex items-center justify-between border-t border-[#e0e0e0] pt-3"><span className="text-xs text-slate-500">Pagina {activityPage} de {activityTotalPages}</span><div className="flex gap-2"><button type="button" onClick={() => setActivityPage((page) => Math.max(1, page - 1))} disabled={activityPage <= 1 || loading} className="inline-flex items-center gap-1 rounded-lg border border-[#d1d1d6] px-3 py-2 text-xs text-[#4b4b4d] disabled:opacity-40">Anterior</button><button type="button" onClick={() => setActivityPage((page) => Math.min(activityTotalPages, page + 1))} disabled={activityPage >= activityTotalPages || loading} className="inline-flex items-center gap-1 rounded-lg border border-[#d1d1d6] px-3 py-2 text-xs text-[#4b4b4d] disabled:opacity-40">Proxima</button></div></div>}

      </section>
    </div>
  );
}
