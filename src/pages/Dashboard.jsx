import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import ExpirationTimer from '../components/ExpirationTimer';
import { toast } from 'react-toastify';
import { 
  CircleDollarSign, 
  HandCoins, 
  FileStack, 
  MessageCircle, 
  Loader2,
  Zap,
  Copy,
  ExternalLink,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  AlertCircle
} from 'lucide-react';

const Dashboard = () => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [activeLink, setActiveLink] = useState("");
  const [copied, setCopied] = useState(false);

  // Estados de Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8; // Quantidade de itens por página

  const [stats, setStats] = useState({
    lucroLiquido: 0,
    receitaPendente: 0,
    contratosAtivos: 0,
    proximasCobrancas: [],
    totalAtrasado: 0,
    adimplencia: 0
  });

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('cobrancas')
        .select(`
          id, valor, status, tipo, categoria, data_vencimento, 
          payment_link, tentativas_envio, created_at,
          contratos (
            id, status, 
            locatarios ( nome_completo ),
            veiculos ( placa )
          )
        `)
        .eq('id_usuario', profile.id)
        // Ordena por criação DESC (Recentes primeiro) conforme solicitado
        .order('created_at', { ascending: false }); 

      if (error) throw error;

      // --- LÓGICA DE CÁLCULO FINANCEIRO ---
      
      // 1. Receita Realizada (Entradas já pagas)
      const totalReceitaPaga = data
        .filter(c => c.status === 'pago' && c.tipo === 'receita')
        .reduce((sum, c) => sum + Number(c.valor), 0);

      // 2. Despesas Totais (Saídas registradas)
      const totalDespesas = data
        .filter(c => c.tipo === 'despesa')
        .reduce((sum, c) => sum + Number(c.valor), 0);

      // 3. Lucro Líquido (Receita Paga - Despesas)
      const lucroLiquido = totalReceitaPaga - totalDespesas;

      // 4. Receita Pendente (Apenas o que é 'receita' e não foi pago ainda)
      const receitaPendente = data
        .filter(c => ['pendente', 'atrasado'].includes(c.status) && c.tipo === 'receita')
        .reduce((sum, c) => sum + Number(c.valor), 0);

      const contratosAtivos = new Set(
        data.filter(c => c.contratos?.status === 'ativo').map(c => c.contratos.id)
      ).size;

      // 5. Métricas Adicionais
      const totalAtrasado = data
        .filter(c => c.status === 'atrasado' && c.tipo === 'receita')
        .reduce((sum, c) => sum + Number(c.valor), 0);

      const cobrançasPagasCount = data.filter(c => c.status === 'pago' && c.tipo === 'receita').length;
      const totalCobrançasCount = data.filter(c => c.tipo === 'receita').length;
      const adimplencia = totalCobrançasCount > 0 ? (cobrançasPagasCount / totalCobrançasCount) * 100 : 100;

      // 6. Fila de Cobrança (Apenas 'receita' pendente/atrasada)
      const proximasCobrancas = data
        .filter(c => ['pendente', 'atrasado'].includes(c.status) && c.tipo === 'receita');

      setStats({ 
        lucroLiquido, 
        receitaPendente, 
        contratosAtivos, 
        proximasCobrancas,
        totalAtrasado,
        adimplencia
      });
    } catch (error) {
      toast.error("Erro ao carregar dados: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.id) fetchDashboardData();
  }, [profile]);

  const handleGerarCobrancaPix = async (cobrancaId) => {
    setProcessingId(cobrancaId);
    try {
      const { data, error } = await supabase.functions.invoke('gerar-cobranca-pix', {
        body: { cobrancaId },
      });
      if (error) throw error;
      if (data.success) {
        toast.success("PIX gerado e enviado ao WhatsApp!");
        await fetchDashboardData();
      }
    } catch (error) {
      toast.error("Falha ao processar PIX: " + error.message);
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
    toast.info("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  // --- LÓGICA DE PAGINAÇÃO ---
  const totalPages = Math.ceil(stats.proximasCobrancas.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = stats.proximasCobrancas.slice(startIndex, startIndex + itemsPerPage);

  const goToNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const goToPrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      {/* Cards de Indicadores (KPIs) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard 
          title="Saldo Líquido" 
          value={`R$ ${stats.lucroLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} 
          icon={<CircleDollarSign className="text-emerald-400" />} 
          bgIcon="bg-emerald-400/20"
          desc="Realizado (Pagas - Despesas)"
          trend="+8.2%"
        />
        <KpiCard 
          title="A Receber" 
          value={`R$ ${stats.receitaPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} 
          icon={<HandCoins className="text-blue-400" />} 
          bgIcon="bg-blue-400/20"
          desc="Pendente + Atrasado"
        />
        <KpiCard 
          title="Em Atraso" 
          value={`R$ ${(stats.totalAtrasado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} 
          icon={<AlertCircle className="text-rose-400" />} 
          bgIcon="bg-rose-400/20"
          desc="Valor crítico em aberto"
        />
        <KpiCard 
          title="Taxa de Pagamento" 
          value={`${Math.round(stats.adimplencia || 0)}%`} 
          icon={<Zap className="text-amber-400" />} 
          bgIcon="bg-amber-400/20"
          desc="Geral de adimplência"
        />
      </div>

      {/* Seção Central: Gráfico e Resumo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[100px] -mr-32 -mt-32 rounded-full" />
           <div className="flex items-center justify-between mb-8">
              <div>
                 <h3 className="text-lg font-black text-white uppercase tracking-tight">Atividade Financeira</h3>
                 <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Últimos disparos e recebimentos</p>
              </div>
              <div className="flex items-center gap-2">
                 <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950 rounded-full border border-slate-800">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-black text-zinc-400 uppercase">Live</span>
                 </div>
              </div>
           </div>
           
           {/* Gráfico Simples Customizado com SVG */}
           <div className="h-64 mt-4 relative">
              <svg className="w-full h-full" viewBox="0 0 400 100" preserveAspectRatio="none">
                <defs>
                   <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                   </linearGradient>
                </defs>
                <path 
                  d="M0,80 Q50,20 100,50 T200,30 T300,60 T400,10" 
                  fill="none" 
                  stroke="#6366f1" 
                  strokeWidth="3" 
                  strokeLinecap="round"
                />
                <path 
                  d="M0,80 Q50,20 100,50 T200,30 T300,60 T400,10 V100 H0 Z" 
                  fill="url(#gradient)" 
                />
                {/* Pontos */}
                <circle cx="100" cy="50" r="4" fill="#6366f1" />
                <circle cx="200" cy="30" r="4" fill="#6366f1" />
                <circle cx="300" cy="60" r="4" fill="#6366f1" />
              </svg>
              <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] font-bold text-zinc-600 uppercase tracking-widest mt-4">
                 <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span>
              </div>
           </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 left-0 w-32 h-32 bg-indigo-500/5 blur-[60px] -ml-16 -mt-16 rounded-full" />
            <div className="relative z-10">
              <h3 className="text-lg font-black text-white uppercase tracking-tight mb-6">Contratos Ativos</h3>
              <div className="flex items-center justify-center py-4">
                 <div className="relative w-40 h-40">
                    <svg className="w-full h-full rotate-[-90deg]" viewBox="0 0 36 36">
                       <path className="stroke-slate-800" strokeWidth="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                       <path className="stroke-indigo-500" strokeWidth="3" strokeDasharray="75, 100" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                       <span className="text-4xl font-black text-white leading-none tracking-tighter">{stats.contratosAtivos}</span>
                       <span className="text-[9px] text-zinc-500 font-bold uppercase mt-1 tracking-widest">Ativos</span>
                    </div>
                 </div>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-800 space-y-4 relative z-10">
               <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                  <span className="text-zinc-500">Capacidade Operacional</span>
                  <span className="text-white">75%</span>
               </div>
               <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden p-[2px]">
                  <div className="h-full bg-indigo-500 rounded-full w-[75%]" />
               </div>
            </div>
        </div>
      </div>

      {/* Tabela de Próximas Cobranças */}
      <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-8 border-b border-slate-800 bg-slate-800/20 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-black text-white flex items-center gap-3 uppercase tracking-tight">
              <div className="p-2.5 bg-amber-400/10 rounded-xl">
                 <Zap className="text-amber-400" size={22} />
              </div>
              Cobranças Recentes
            </h3>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1 ml-12">Prioridade de faturamento e ação rápida</p>
          </div>
          <div className="bg-zinc-950 px-4 py-2 rounded-2xl border border-slate-800">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
              {stats.proximasCobrancas.length} Itens em Fila
            </span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          {stats.proximasCobrancas.length > 0 ? (
            <>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/50">
                    <th className="p-6 text-slate-400 font-black text-[10px] uppercase tracking-[0.2em]">Locatário / Placa</th>
                    <th className="p-6 text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] hidden sm:table-cell">Vencimento</th>
                    <th className="p-6 text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] hidden sm:table-cell">Valor</th>
                    <th className="p-6 text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] text-center hidden md:table-cell">Status</th>
                    <th className="p-6 text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                {currentData.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-all duration-300">
                    <td className="p-6">
                      <div className="text-white font-bold text-sm tracking-tight mb-1">
                        {item.contratos?.locatarios?.nome_completo || "Cobrança Avulsa"}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex px-2 py-0.5 bg-slate-950 rounded text-[9px] text-indigo-400 font-mono uppercase border border-slate-800">
                          {item.contratos?.veiculos?.placa || "N/A"}
                        </div>
                        {/* Mobile Only: Informações Consolidadas */}
                        <div className="sm:hidden flex flex-wrap items-center gap-x-3 gap-y-2 mt-1">
                           <span className="text-[10px] font-black text-white px-1.5 py-0.5 bg-slate-800 rounded">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</span>
                           <span className="text-[9px] text-zinc-500 font-mono">
                             {new Date(item.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}
                           </span>
                           <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border ${
                              item.status === 'atrasado' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                           }`}>
                              {item.status}
                           </span>
                           <div className="scale-90 origin-left">
                              <ExpirationTimer dataVencimento={item.data_vencimento} status={item.status} />
                           </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mt-3">
                        {[...Array(8)].map((_, i) => (
                          <div key={i} className={`h-1.5 w-3 rounded-full ${i < (item.tentativas_envio || 0) ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-slate-800'}`} />
                        ))}
                        <span className="text-[9px] text-zinc-500 font-black ml-1.5">{item.tentativas_envio || 0}/8</span>
                      </div>
                    </td>

                    <td className="p-6 hidden sm:table-cell">
                      <div className="text-zinc-300 font-mono text-xs mb-1">
                        {new Date(item.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </div>
                      <ExpirationTimer dataVencimento={item.data_vencimento} status={item.status} />
                    </td>

                    <td className="p-6 hidden sm:table-cell">
                      <div className="text-white font-black text-base tracking-tighter">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</div>
                      <div className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mt-0.5 opacity-60">{item.categoria}</div>
                    </td>

                    <td className="p-6 text-center hidden md:table-cell">
                      <span className={`px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-[0.15em] border ${
                        item.status === 'atrasado' 
                          ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' 
                          : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      }`}>
                        {item.status}
                      </span>
                    </td>

                    <td className="p-6 text-right flex items-center justify-end gap-1.5 sm:gap-3">
                      {item.payment_link && (
                        <button onClick={() => openLinkModal(item.payment_link)} className="p-2 sm:p-2.5 text-zinc-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all">
                          <ExternalLink size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => handleGerarCobrancaPix(item.id)}
                        disabled={processingId === item.id}
                        className={`group flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest transition-all ${
                          processingId === item.id 
                            ? 'bg-slate-800 text-zinc-500 cursor-not-allowed' 
                            : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white shadow-lg hover:shadow-emerald-500/20'
                        }`}
                      >
                        {processingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <><MessageCircle size={14} className="group-hover:scale-110 transition-transform" /> <span className="hidden xs:inline">Cobrar Cliente</span><span className="xs:hidden">Cobrar</span></>}
                      </button>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>

              {/* CONTROLES DE PAGINAÇÃO */}
              {totalPages > 1 && (
                <div className="p-6 border-t border-slate-800 bg-slate-900/20 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em]">
                    Página {currentPage} / {totalPages}
                  </span>
                  <div className="flex gap-3">
                    <button 
                      onClick={goToPrevPage} 
                      disabled={currentPage === 1}
                      className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-zinc-300 transition-all border border-slate-800 shadow-xl"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button 
                      onClick={goToNextPage} 
                      disabled={currentPage === totalPages}
                      className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-zinc-300 transition-all border border-slate-800 shadow-xl"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-24 text-center">
              <div className="bg-slate-800/30 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-slate-800">
                 <CircleDollarSign className="text-zinc-700" size={36} />
              </div>
              <h4 className="text-white font-bold mb-1 uppercase tracking-tight">Tudo em dia!</h4>
              <p className="text-zinc-600 font-bold text-[10px] uppercase tracking-widest">Nenhuma cobrança pendente identificada no momento.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Link de Pagamento */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden ring-1 ring-white/5">
            <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
              <h3 className="text-white font-black uppercase tracking-tight flex items-center gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg">
                   <ExternalLink size={18} className="text-indigo-400" />
                </div>
                Gateway de Pagamento
              </h3>
              <button onClick={() => setShowLinkModal(false)} className="p-2 text-zinc-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"><X size={20} /></button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">URL da Fatura</label>
                <div className="flex gap-2">
                  <input readOnly value={activeLink} className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-indigo-300 font-mono outline-none focus:border-indigo-500/50 transition-colors" />
                  <button onClick={handleCopyLink} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20">
                    {copied ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
              </div>
              <a href={activeLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-4 bg-slate-800 hover:bg-slate-700 text-white text-xs font-black rounded-2xl transition-all uppercase tracking-widest border border-slate-700">
                 Abrir link externo <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Componente de Card com descrição e glassmorphism
const KpiCard = ({ title, value, icon, bgIcon, desc, trend }) => (
  <div className="bg-slate-900/40 backdrop-blur-md p-7 rounded-3xl border border-slate-800 shadow-xl flex flex-col gap-6 group hover:border-indigo-500/40 transition-all duration-500 relative overflow-hidden h-full">
    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
       {React.cloneElement(icon, { size: 64 })}
    </div>
    <div className="flex items-center justify-between relative z-10">
      <div className={`p-4 rounded-2xl transition-transform group-hover:scale-110 duration-500 ${bgIcon}`}>
        {React.cloneElement(icon, { size: 28 })}
      </div>
      {trend && (
         <div className="px-2 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] font-black rounded-lg border border-emerald-500/20">
            {trend}
         </div>
      )}
    </div>
    <div className="relative z-10 mt-auto">
      <div className="text-3xl font-black text-white tracking-tighter leading-none mb-2">{value}</div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{title}</div>
        <div className="text-[9px] text-zinc-600 font-bold uppercase tracking-tight">{desc}</div>
      </div>
    </div>
  </div>
);

export default Dashboard;