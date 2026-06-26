import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { cobrancasService } from '../services/cobrancas';
import { KpiCard } from '../components/ui/KpiCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Pagination } from '../components/ui/Pagination';
import ExpirationTimer from '../components/ExpirationTimer';
import { toast } from 'react-toastify';
import {
  CircleDollarSign, HandCoins, MessageCircle, Loader2,
  Zap, Copy, ExternalLink, X, Check, AlertCircle,
  ChevronLeft, ChevronRight
} from 'lucide-react';

const Dashboard = () => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [activeLink, setActiveLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const [stats, setStats] = useState({
    lucroLiquido: 0, receitaPendente: 0, contratosAtivos: 0,
    proximasCobrancas: [], totalAtrasado: 0, adimplencia: 0,
  });

  const fetchDashboardData = async () => {
    if (!profile?.id) return;
    try {
      setLoading(true);
      const data = await cobrancasService.listDashboard(profile.id);

      const totalReceitaPaga = data.filter(c => c.status === 'pago' && c.tipo === 'receita').reduce((s, c) => s + Number(c.valor), 0);
      const totalDespesas = data.filter(c => c.tipo === 'despesa').reduce((s, c) => s + Number(c.valor), 0);
      const lucroLiquido = totalReceitaPaga - totalDespesas;
      const receitaPendente = data.filter(c => ['pendente', 'atrasado'].includes(c.status) && c.tipo === 'receita').reduce((s, c) => s + Number(c.valor), 0);
      const contratosAtivos = new Set(data.filter(c => c.contratos?.status === 'ativo').map(c => c.contratos.id)).size;
      const totalAtrasado = data.filter(c => c.status === 'atrasado' && c.tipo === 'receita').reduce((s, c) => s + Number(c.valor), 0);
      const pagasCount = data.filter(c => c.status === 'pago' && c.tipo === 'receita').length;
      const totalCount = data.filter(c => c.tipo === 'receita').length;
      const adimplencia = totalCount > 0 ? (pagasCount / totalCount) * 100 : 100;
      const proximasCobrancas = data.filter(c => ['pendente', 'atrasado'].includes(c.status) && c.tipo === 'receita')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setStats({ lucroLiquido, receitaPendente, contratosAtivos, proximasCobrancas, totalAtrasado, adimplencia });
    } catch (error) {
      toast.error('Erro ao carregar dados: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboardData(); }, [profile]);

  const handleGerarCobrancaPix = async (cobrancaId) => {
    setProcessingId(cobrancaId);
    try {
      const data = await cobrancasService.gerarPix(cobrancaId);
      if (data.success) {
        toast.success('PIX gerado e enviado ao WhatsApp!');
        await fetchDashboardData();
      }
    } catch (error) {
      toast.error('Falha ao processar PIX: ' + error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const openLinkModal = (link) => {
    setActiveLink(link);
    setShowLinkModal(true);
    setCopied(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(activeLink);
    setCopied(true);
    toast.info('Link copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const totalPages = Math.ceil(stats.proximasCobrancas.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = stats.proximasCobrancas.slice(startIndex, startIndex + itemsPerPage);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard title="Saldo Líquido" value={`R$ ${stats.lucroLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={CircleDollarSign} bgIcon="bg-emerald-400/20" desc="Realizado (Pagas - Despesas)" trend="+8.2%" />
        <KpiCard title="A Receber" value={`R$ ${stats.receitaPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={HandCoins} bgIcon="bg-blue-400/20" desc="Pendente + Atrasado" />
        <KpiCard title="Em Atraso" value={`R$ ${(stats.totalAtrasado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={AlertCircle} bgIcon="bg-rose-400/20" desc="Valor crítico em aberto" />
        <KpiCard title="Taxa de Pagamento" value={`${Math.round(stats.adimplencia || 0)}%`}
          icon={Zap} bgIcon="bg-amber-400/20" desc="Geral de adimplência" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Atividade Financeira</h3>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Últimos disparos e recebimentos</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 rounded-full border border-zinc-800">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-zinc-400 uppercase">Live</span>
            </div>
          </div>
          <div className="h-64 mt-4 relative">
            <svg className="w-full h-full" viewBox="0 0 400 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,80 Q50,20 100,50 T200,30 T300,60 T400,10" fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
              <path d="M0,80 Q50,20 100,50 T200,30 T300,60 T400,10 V100 H0 Z" fill="url(#gradient)" />
              <circle cx="100" cy="50" r="4" fill="#6366f1" />
              <circle cx="200" cy="30" r="4" fill="#6366f1" />
              <circle cx="300" cy="60" r="4" fill="#6366f1" />
            </svg>
            <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] font-bold text-zinc-600 uppercase tracking-widest">
              <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl flex flex-col justify-between relative overflow-hidden">
          <h3 className="text-lg font-black text-white uppercase tracking-tight mb-6">Contratos Ativos</h3>
          <div className="flex items-center justify-center py-4">
            <div className="relative w-40 h-40">
              <svg className="w-full h-full rotate-[-90deg]" viewBox="0 0 36 36">
                <path className="stroke-zinc-800" strokeWidth="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path className="stroke-indigo-500" strokeWidth="3" strokeDasharray="75, 100" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-white">{stats.contratosAtivos}</span>
                <span className="text-[9px] text-zinc-500 font-bold uppercase mt-1 tracking-widest">Ativos</span>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-zinc-800 space-y-4">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
              <span className="text-zinc-500">Capacidade Operacional</span>
              <span className="text-white">75%</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden p-[2px]">
              <div className="h-full bg-indigo-500 rounded-full w-[75%]" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-8 border-b border-zinc-800 bg-zinc-800/20 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-black text-white flex items-center gap-3 uppercase tracking-tight">
              <div className="p-2.5 bg-amber-400/10 rounded-xl"><Zap className="text-amber-400" size={22} /></div>
              Cobranças Recentes
            </h3>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1 ml-12">Prioridade de faturamento e ação rápida</p>
          </div>
          <div className="bg-zinc-950 px-4 py-2 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{stats.proximasCobrancas.length} Itens em Fila</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          {stats.proximasCobrancas.length > 0 ? (
            <>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-900/50">
                    <th className="p-6 text-zinc-400 font-black text-[10px] uppercase tracking-[0.2em]">Locatário / Placa</th>
                    <th className="p-6 text-zinc-400 font-black text-[10px] uppercase tracking-[0.2em] hidden sm:table-cell">Vencimento</th>
                    <th className="p-6 text-zinc-400 font-black text-[10px] uppercase tracking-[0.2em] hidden sm:table-cell">Valor</th>
                    <th className="p-6 text-zinc-400 font-black text-[10px] uppercase tracking-[0.2em] text-center hidden md:table-cell">Status</th>
                    <th className="p-6 text-zinc-400 font-black text-[10px] uppercase tracking-[0.2em] text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {currentData.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-800/40 transition-all">
                      <td className="p-6">
                        <div className="text-white font-bold text-sm mb-1">{item.contratos?.locatarios?.nome_completo || "Cobrança Avulsa"}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 bg-zinc-950 rounded text-[9px] text-indigo-400 font-mono uppercase border border-zinc-800">{item.contratos?.veiculos?.placa || "N/A"}</span>
                          <div className="sm:hidden flex flex-wrap items-center gap-x-3 gap-y-2 mt-1">
                            <span className="text-[10px] font-black text-white px-1.5 py-0.5 bg-zinc-800 rounded">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</span>
                            <span className="text-[9px] text-zinc-500 font-mono">{new Date(item.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                            <StatusBadge status={item.status}>{item.status}</StatusBadge>
                            <div className="scale-90 origin-left"><ExpirationTimer dataVencimento={item.data_vencimento} status={item.status} /></div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-3">
                          {[...Array(8)].map((_, i) => (
                            <div key={i} className={`h-1.5 w-3 rounded-full ${i < (item.tentativas_envio || 0) ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-zinc-800'}`} />
                          ))}
                          <span className="text-[9px] text-zinc-500 font-black ml-1.5">{item.tentativas_envio || 0}/8</span>
                        </div>
                      </td>
                      <td className="p-6 hidden sm:table-cell">
                        <div className="text-zinc-300 font-mono text-xs mb-1">{new Date(item.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
                        <ExpirationTimer dataVencimento={item.data_vencimento} status={item.status} />
                      </td>
                      <td className="p-6 hidden sm:table-cell">
                        <div className="text-white font-black text-base">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</div>
                        <div className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mt-0.5 opacity-60">{item.categoria}</div>
                      </td>
                      <td className="p-6 text-center hidden md:table-cell">
                        <StatusBadge status={item.status}>{item.status}</StatusBadge>
                      </td>
                      <td className="p-6 text-right">
                        <div className="flex items-center justify-end gap-1.5 sm:gap-3">
                          {item.payment_link && (
                            <button onClick={() => openLinkModal(item.payment_link)} className="p-2 sm:p-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all">
                              <ExternalLink size={18} />
                            </button>
                          )}
                          <button onClick={() => handleGerarCobrancaPix(item.id)} disabled={processingId === item.id}
                            className={`group flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest transition-all ${
                              processingId === item.id
                                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white shadow-lg hover:shadow-emerald-500/20'
                            }`}>
                            {processingId === item.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <><MessageCircle size={14} className="group-hover:scale-110 transition-transform" /> <span>Cobrar</span></>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination currentPage={currentPage} totalPages={totalPages}
                onPrev={() => setCurrentPage(p => Math.max(p - 1, 1))}
                onNext={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                label={`Página ${currentPage} / ${totalPages}`}
              />
            </>
          ) : (
            <div className="p-24 text-center">
              <div className="bg-zinc-800/30 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-zinc-800">
                <CircleDollarSign className="text-zinc-700" size={36} />
              </div>
              <h4 className="text-white font-bold mb-1 uppercase tracking-tight">Tudo em dia!</h4>
              <p className="text-zinc-600 font-bold text-[10px] uppercase tracking-widest">Nenhuma cobrança pendente identificada no momento.</p>
            </div>
          )}
        </div>
      </div>

      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden ring-1 ring-white/5">
            <div className="p-8 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="text-white font-black uppercase tracking-tight flex items-center gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg"><ExternalLink size={18} className="text-indigo-400" /></div>
                Gateway de Pagamento
              </h3>
              <button onClick={() => setShowLinkModal(false)} className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-xl"><X size={20} /></button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">URL da Fatura</label>
                <div className="flex gap-2">
                  <input readOnly value={activeLink} className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-indigo-300 font-mono outline-none" />
                  <button onClick={handleCopyLink} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20">
                    {copied ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
              </div>
              <a href={activeLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-black rounded-2xl uppercase tracking-widest border border-zinc-700">
                Abrir link externo <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
