import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { 
  CheckCircle, Ban, Search, Loader2, Calendar, 
  Play, RefreshCcw, Plus, X, DollarSign, Tag, Info,
  Trash2, ChevronLeft, ChevronRight, CircleDollarSign,
  MessageSquare
} from 'lucide-react';
import { toast } from 'react-toastify';
import MessageSelectorModal from '../components/MessageSelectorModal';

const Cobrancas = () => {
  const { profile } = useAuth();
  const [cobrancas, setCobrancas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showConfirmBillingModal, setShowConfirmBillingModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Estados para Modal de Mensagem
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [selectedLocatarioData, setSelectedLocatarioData] = useState(null);

  // Estados para Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8; // Paginar por Locatários
  const [expandedLocatarios, setExpandedLocatarios] = useState([]);
  const [innerPages, setInnerPages] = useState({}); // Paginação interna { locId: page }

  // Estados para o Lançamento Manual
  const [locatarios, setLocatarios] = useState([]);
  const [manualData, setManualData] = useState({
    id_locatario: '',
    valor: '',
    categoria: 'manutencao',
    tipo: 'receita', // receita ou despesa
    destino: 'separado', // separado ou somar_fatura
    data_vencimento: new Date().toISOString().split('T')[0]
  });
  const [pendingBill, setPendingBill] = useState(null);
  const [checkingBill, setCheckingBill] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [cobsRes, locsRes] = await Promise.all([
        supabase.from('cobrancas').select(`*, contratos (*, locatarios (nome_completo), veiculos (placa))`).eq('id_usuario', profile.id).order('data_vencimento', { ascending: false }),
        supabase.from('locatarios').select('id, nome_completo').eq('id_usuario', profile.id).eq('ativo', true)
      ]);
      setCobrancas(cobsRes.data || []);
      setLocatarios(locsRes.data || []);
    } catch (error) {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (profile?.id) fetchData(); }, [profile]);

  // Busca fatura pendente ao selecionar locatário
  useEffect(() => {
    const fetchPending = async () => {
      if (manualData.id_locatario && manualData.tipo === 'receita' && manualData.destino === 'somar_fatura') {
        setCheckingBill(true);
        try {
          // Busca contrato ativo do locatário
          const { data: contrato } = await supabase
            .from('contratos')
            .select('id')
            .eq('id_locatario', manualData.id_locatario)
            .eq('status', 'ativo')
            .limit(1)
            .single();

          if (contrato) {
            const { data, error } = await supabase
              .from('cobrancas')
              .select('id, valor, data_vencimento')
              .eq('status', 'pendente')
              .eq('id_contrato', contrato.id)
              .order('data_vencimento', { ascending: true })
              .limit(1)
              .single();
            
            if (!error && data) setPendingBill(data);
            else setPendingBill(null);
          } else {
            setPendingBill(null);
          }
        } catch {
          setPendingBill(null);
        } finally {
          setCheckingBill(false);
        }
      } else {
        setPendingBill(null);
      }
    };
    fetchPending();
  }, [manualData.id_locatario, manualData.destino, manualData.tipo]);

  // --- LÓGICA DE SALVAMENTO MANUAL ---
  const handleSaveManual = async (e) => {
    e.preventDefault();
    try {
      if (manualData.tipo === 'despesa') {
        const { error } = await supabase.from('cobrancas').insert([{
          id_usuario: profile.id,
          valor: manualData.valor,
          categoria: manualData.categoria,
          tipo: 'despesa',
          status: 'pago',
          data_vencimento: manualData.data_vencimento
        }]);
        if (error) throw error;
        toast.success("Despesa registrada com sucesso!");
      } 
      else if (manualData.tipo === 'receita' && manualData.destino === 'somar_fatura') {
        // Se não houver fatura pendente detectada previamente
        if (!pendingBill) {
          toast.warning("Não há fatura PENDENTE para somar. Criando cobrança SEPARADA.");
          // Fallback para separado
          const { data: contrato } = await supabase.from('contratos').select('id').eq('id_locatario', manualData.id_locatario).eq('status', 'ativo').limit(1).single();
          const { error } = await supabase.from('cobrancas').insert([{
            id_usuario: profile.id,
            id_contrato: contrato?.id || null,
            valor: manualData.valor,
            categoria: manualData.categoria,
            tipo: 'receita',
            status: 'pendente',
            data_vencimento: manualData.data_vencimento
          }]);
          if (error) throw error;
        } else {
          const novoValor = Number(pendingBill.valor) + Number(manualData.valor);
          const { error: upErr } = await supabase
            .from('cobrancas')
            .update({ 
              valor: novoValor,
              payment_link: null, 
              mercado_pago_id: null 
            })
            .eq('id', pendingBill.id);

          if (upErr) throw upErr;
          toast.success(`Valor somado à fatura pendente! Novo total: R$ ${novoValor.toFixed(2)}`);
        }
      } 
      else {
        const { data: contrato } = await supabase.from('contratos').select('id').eq('id_locatario', manualData.id_locatario).eq('status', 'ativo').limit(1).single();

        const { error } = await supabase.from('cobrancas').insert([{
          id_usuario: profile.id,
          id_contrato: contrato?.id || null,
          valor: manualData.valor,
          categoria: manualData.categoria,
          tipo: 'receita',
          status: 'pendente',
          data_vencimento: manualData.data_vencimento
        }]);
        if (error) throw error;
        toast.success("Nova cobrança avulsa gerada!");
      }

      setShowManualModal(false);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRunAutomatedCharges = async () => {
    setShowConfirmBillingModal(false);
    setGenerating(true);
    try {
      await supabase.functions.invoke('gerar-cobrancas-diarias', {
        body: { userId: profile.id }
      });
      toast.success("Faturamento processado!");
      fetchData();
    } catch (error) { toast.error(error.message); } finally { setGenerating(false); }
  };

  const handleMarcarPago = async (id) => {
    const { error } = await supabase.from('cobrancas').update({ status: 'pago', data_pagamento: new Date().toISOString() }).eq('id', id);
    if (!error) { toast.success("Baixa realizada!"); fetchData(); }
  };

  // --- NOVA FUNÇÃO DE CANCELAMENTO ---
  const handleCancelar = async (id) => {
    if (!window.confirm("Tem certeza que deseja CANCELAR esta cobrança?")) return;
    try {
      const { error } = await supabase
        .from('cobrancas')
        .update({ status: 'cancelado' }) // Define status como cancelado
        .eq('id', id);
      
      if (error) throw error;
      toast.info("Cobrança cancelada.");
      fetchData();
    } catch (error) {
      toast.error("Erro ao cancelar: " + error.message);
    }
  };

  // Filtragem
  const filteredData = cobrancas.filter(c => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = (c.contratos?.locatarios?.nome_completo || "Lançamento Avulso").toLowerCase().includes(search) ||
                         (c.categoria || "").toLowerCase().includes(search);
    
    const matchesFilter = filterStatus === 'todos' || 
                         (filterStatus === 'despesa' ? c.tipo === 'despesa' : c.status === filterStatus);
    
    // Filtro de Data
    const date = c.data_vencimento;
    const matchesStartDate = !startDate || date >= startDate;
    const matchesEndDate = !endDate || date <= endDate;

    return matchesSearch && matchesFilter && matchesStartDate && matchesEndDate;
  });

  // --- LÓGICA DE AGRUPAMENTO POR LOCATÁRIO ---
  const groupedData = filteredData.reduce((acc, c) => {
    const locId = c.contratos?.id_locatario || 'avulso';
    const locNome = c.contratos?.locatarios?.nome_completo || "Faturamentos Avulsos / Externos";
    
    if (!acc[locId]) {
      acc[locId] = {
        id: locId,
        nome: locNome,
        placa: c.contratos?.veiculos?.placa || "N/A",
        items: [],
        totalPendente: 0,
        totalPago: 0
      };
    }
    acc[locId].items.push(c);
    const val = Number(c.valor);
    if (c.status === 'pago') acc[locId].totalPago += val;
    else if (c.status !== 'cancelado') acc[locId].totalPendente += val;
    
    return acc;
  }, {});

  const sortedGroupedList = Object.values(groupedData).sort((a, b) => b.totalPendente - a.totalPendente);

  const toggleExpand = (id) => {
    setExpandedLocatarios(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Cálculo de Resumo Financeiro da Tela
  const summary = filteredData.reduce((acc, c) => {
    const val = Number(c.valor);
    if (c.tipo === 'receita') {
      if (c.status === 'pago') acc.receitaRealizada += val;
      else if (c.status !== 'cancelado') acc.receitaPendente += val;
    } else {
      acc.despesas += val;
    }
    return acc;
  }, { receitaRealizada: 0, receitaPendente: 0, despesas: 0 });

  // Exportação CSV
  const handleExportCSV = () => {
    const headers = ["Locatário", "Placa", "Vencimento", "Categoria", "Valor", "Status"];
    const rows = filteredData.map(c => [
      c.contratos?.locatarios?.nome_completo || "Lançamento Avulso",
      c.contratos?.veiculos?.placa || "N/A",
      c.data_vencimento,
      c.categoria,
      c.valor,
      c.status
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `cobrancas_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- LÓGICA DE PAGINAÇÃO (SOBRE OS GRUPOS) ---
  const totalPages = Math.ceil(sortedGroupedList.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentGroups = sortedGroupedList.slice(startIndex, startIndex + itemsPerPage);

  const goToNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const goToPrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

  // Resetar página ao filtrar
  useEffect(() => { 
    setCurrentPage(1); 
    setInnerPages({}); // Reseta as páginas internas ao filtrar
  }, [searchTerm, filterStatus, startDate, endDate]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Fluxo de Caixa</h1>
            <p className="text-sm text-slate-500 font-medium italic">Visão agrupada por locatário para melhor organização.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* FILTROS DE DATA */}
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-2">
            <Calendar size={14} className="text-zinc-500" />
            <input 
              type="date" 
              className="bg-transparent py-2 text-[10px] text-zinc-300 font-bold outline-none"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              title="Data Início"
            />
            <span className="text-zinc-700 text-[10px]">até</span>
            <input 
              type="date" 
              className="bg-transparent py-2 text-[10px] text-zinc-300 font-bold outline-none"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              title="Data Fim"
            />
            {(startDate || endDate) && (
              <button 
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="text-zinc-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input 
              type="text" 
              placeholder="Buscar..." 
              className="bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-zinc-300 text-xs font-bold outline-none focus:border-indigo-500 w-40 md:w-auto"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <button 
            onClick={handleExportCSV}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 border border-zinc-700 transition-all"
            title="Exportar CSV"
          >
            <RefreshCcw size={16} /> Exportar
          </button>

          <button 
            onClick={() => setShowManualModal(true)}
            className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 border border-zinc-700 transition-all"
          >
            <Plus size={16} /> Lançamento
          </button>

            <button 
              onClick={() => setShowConfirmBillingModal(true)} 
              disabled={generating} 
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
            >
              {generating ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
              Faturamento Diário
            </button>

          <div className="h-8 w-[1px] bg-slate-800 mx-2 hidden md:block"></div>
          
          <select 
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-400 text-xs font-bold outline-none cursor-pointer"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="todos">Status</option>
            <option value="pendente">Pendentes</option>
            <option value="pago">Pagos</option>
            <option value="atrasado">Atrasados</option>
            <option value="cancelado">Cancelados</option>
            <option value="despesa">Despesas</option>
          </select>
        </div>
      </div>

      {/* BARRA DE RESUMO FINANCEIRO (SOMA DO FILTRO ATUAL) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryTile 
          label="Total Realizado" 
          value={summary.receitaRealizada} 
          color="text-emerald-400" 
          desc="Receitas pagas"
        />
        <SummaryTile 
          label="Total Pendente" 
          value={summary.receitaPendente} 
          color="text-amber-400" 
          desc="Futuro / Atrasado"
        />
        <SummaryTile 
          label="Total Despesas" 
          value={summary.despesas} 
          color="text-red-400" 
          desc="Saídas registradas"
        />
        <SummaryTile 
          label="Saldo Final" 
          value={summary.receitaRealizada - summary.despesas} 
          color="text-white bg-indigo-500/10 border-indigo-500/20" 
          desc="Realizado - Despesas"
          isTotal
        />
      </div>

      <div className="space-y-4">
          {loading ? (
             <div className="py-20 text-center bg-zinc-900 rounded-3xl border border-zinc-800">
               <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} />
             </div>
          ) : currentGroups.length > 0 ? (
            currentGroups.map(group => (
              <div key={group.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl transition-all hover:border-zinc-700">
                {/* CABEÇALHO DO GRUPO (LOCATÁRIO) */}
                <div 
                  onClick={() => toggleExpand(group.id)}
                  className="p-5 flex items-center justify-between cursor-pointer bg-zinc-950/40 hover:bg-zinc-950/60"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${group.totalPendente > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                      {group.totalPendente > 0 ? <Calendar size={20} /> : <CheckCircle size={20} />}
                    </div>
                    <div>
                      <h4 className="text-white font-bold leading-none">{group.nome}</h4>
                      <p className="text-[10px] text-zinc-500 font-mono uppercase mt-1 tracking-widest">{group.placa}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        // Precisamos dos dados do locatário (nome e whatsapp)
                        // Como o group só tem o nome, vamos buscar o objeto completo do items[0] ou similar
                        const locData = group.items[0]?.contratos?.locatarios;
                        if (locData) {
                          setSelectedLocatarioData(locData);
                          setIsMessageModalOpen(true);
                        } else {
                          toast.warning("Dados de contato não encontrados para este faturamento avulso.");
                        }
                      }}
                      className="p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all"
                      title="Enviar Mensagem WhatsApp"
                    >
                      <MessageSquare size={18} />
                    </button>
                    <div className="hidden md:block text-right">
                       <div className="text-[9px] font-black text-zinc-600 uppercase tracking-widest leading-none mb-1">PAGO</div>
                       <div className="text-xs font-bold text-zinc-400">R$ {group.totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div className="text-right">
                       <div className="text-[9px] font-black text-zinc-600 uppercase tracking-widest leading-none mb-1">EM ABERTO</div>
                       <div className={`text-sm font-black ${group.totalPendente > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                         R$ {group.totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                       </div>
                    </div>
                    <div className="h-8 w-[1px] bg-zinc-800 mx-2"></div>
                    <div className={`transition-transform duration-300 ${expandedLocatarios.includes(group.id) ? 'rotate-180' : ''}`}>
                       <ChevronLeft size={20} className="-rotate-90 text-zinc-600" />
                    </div>
                  </div>
                </div>

                {/* LISTA DE COBRANÇAS EXPANSÍVEL COM PAGINAÇÃO INTERNA */}
                {expandedLocatarios.includes(group.id) && (
                  <div className="border-t border-zinc-800/50 bg-zinc-950/20 px-5 pb-5 animate-in slide-in-from-top-2 duration-300">
                    {(() => {
                      const pageInner = innerPages[group.id] || 1;
                      const sizeInner = 5;
                      const totalInner = Math.ceil(group.items.length / sizeInner);
                      const itemsInner = group.items.slice((pageInner - 1) * sizeInner, pageInner * sizeInner);
                      
                      return (
                        <>
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-[9px] uppercase font-black text-zinc-700 tracking-widest border-b border-zinc-800">
                                <th className="py-4">Vencimento</th>
                                <th className="py-4">Categoria</th>
                                <th className="py-4">Valor</th>
                                <th className="py-4 text-center">Status</th>
                                <th className="py-4 text-right">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/30">
                              {itemsInner.map(c => (
                                <tr key={c.id} className="text-xs group/item">
                                  <td className="py-4 font-mono text-zinc-400">
                                    {new Date(c.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}
                                  </td>
                                  <td className="py-4">
                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${c.tipo === 'despesa' ? 'bg-red-500/10 text-red-500' : 'bg-zinc-800 text-zinc-400'}`}>
                                      {c.categoria}
                                    </span>
                                  </td>
                                  <td className="py-4">
                                    <span className={`font-bold ${c.tipo === 'despesa' ? 'text-red-500' : 'text-white'}`}>
                                      {c.tipo === 'despesa' ? '-' : ''} R$ {Number(c.valor).toFixed(2).replace('.', ',')}
                                    </span>
                                  </td>
                                  <td className="py-4 text-center">
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${
                                      c.status === 'pago' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                                      c.status === 'cancelado' ? 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' :
                                      'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                    }`}>
                                      {c.status}
                                    </span>
                                  </td>
                                  <td className="py-4 text-right">
                                    <div className="flex items-center justify-end gap-1 opacity-20 group-hover/item:opacity-100 transition-opacity">
                                      {c.status === 'pendente' && (
                                        <>
                                          <button onClick={() => handleMarcarPago(c.id)} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors" title="Dar Baixa"><CheckCircle size={14} /></button>
                                          <button onClick={() => handleCancelar(c.id)} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" title="Cancelar"><Trash2 size={14} /></button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          
                          {/* CONTROLES DA PAGINAÇÃO INTERNA */}
                          {totalInner > 1 && (
                            <div className="mt-4 flex items-center justify-between border-t border-zinc-800/30 pt-4">
                               <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest">
                                 Página {pageInner} de {totalInner}
                               </span>
                               <div className="flex gap-1">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setInnerPages({...innerPages, [group.id]: Math.max(pageInner - 1, 1)}) }}
                                    disabled={pageInner === 1}
                                    className="p-1 text-zinc-500 hover:text-white disabled:opacity-20"
                                  >
                                    <ChevronLeft size={16} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setInnerPages({...innerPages, [group.id]: Math.min(pageInner + 1, totalInner)}) }}
                                    disabled={pageInner === totalInner}
                                    className="p-1 text-zinc-500 hover:text-white disabled:opacity-20"
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                               </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="py-20 text-center bg-zinc-900 rounded-3xl border border-zinc-800">
              <div className="bg-zinc-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                 <Search className="text-zinc-600" size={32} />
              </div>
              <p className="text-zinc-500 font-medium italic">Nenhum locatário com cobranças para os filtros selecionados.</p>
            </div>
          )}

          {/* RODAPÉ COM PAGINAÇÃO POR GRUPO */}
          {totalPages > 1 && (
            <div className="p-4 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                Exibindo {startIndex + 1}-{Math.min(startIndex + itemsPerPage, sortedGroupedList.length)} de {sortedGroupedList.length} Locatários
              </span>
              <div className="flex gap-2">
                <button 
                  onClick={goToPrevPage} 
                  disabled={currentPage === 1}
                  className="p-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed rounded-2xl text-zinc-300 transition-all border border-zinc-800 shadow-lg"
                >
                  <ChevronLeft size={20} />
                </button>
                <button 
                  onClick={goToNextPage} 
                  disabled={currentPage === totalPages}
                  className="p-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed rounded-2xl text-zinc-300 transition-all border border-zinc-800 shadow-lg"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          )}
      </div>

      {/* MODAL DE LANÇAMENTO MANUAL (MANTIDO IGUAL) */}

      {/* MODAL DE LANÇAMENTO MANUAL (MANTIDO IGUAL) */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden ring-1 ring-white/10">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
              <h3 className="text-white font-bold flex items-center gap-2 uppercase tracking-widest text-sm"><Tag className="text-indigo-400" size={18}/> Novo Lançamento Manual</h3>
              <button onClick={() => setShowManualModal(false)} className="text-zinc-500 hover:text-white"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveManual} className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                {/* TIPO DE LANÇAMENTO */}
                <div className="col-span-2 space-y-2">
                   <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Natureza da Operação</label>
                   <div className="grid grid-cols-2 gap-3">
                      <button 
                        type="button" 
                        onClick={() => setManualData({...manualData, tipo: 'receita'})} 
                        className={`flex flex-col items-center gap-2 p-4 rounded-3xl transition-all border ${manualData.tipo === 'receita' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-xl shadow-emerald-500/5' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                      >
                         <CircleDollarSign size={24} />
                         <span className="text-xs font-black uppercase">Receita (Entrada)</span>
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setManualData({...manualData, tipo: 'despesa', destino: 'separado'})} 
                        className={`flex flex-col items-center gap-2 p-4 rounded-3xl transition-all border ${manualData.tipo === 'despesa' ? 'bg-red-500/10 border-red-500 text-red-400 shadow-xl shadow-red-500/5' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                      >
                         <DollarSign size={24} />
                         <span className="text-xs font-black uppercase">Despesa (Saída)</span>
                      </button>
                   </div>
                </div>

                {/* LOCATÁRIO (Apenas se for Receita) */}
                {manualData.tipo === 'receita' && (
                  <div className="col-span-2 space-y-2 animate-in slide-in-from-top-2 duration-300">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Locatário Responsável</label>
                    <select 
                      required 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm outline-none focus:border-indigo-500 transition-colors" 
                      value={manualData.id_locatario} 
                      onChange={e => setManualData({...manualData, id_locatario: e.target.value})}
                    >
                       <option value="">Selecione o locatário...</option>
                       {locatarios.map(l => <option key={l.id} value={l.id}>{l.nome_completo}</option>)}
                    </select>
                  </div>
                )}

                {/* DESTINO DO VALOR / COMO COBRAR */}
                {manualData.id_locatario && manualData.tipo === 'receita' && (
                  <div className="col-span-2 space-y-3 animate-in fade-in duration-500">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                       <Info size={12}/> Como cobrar esse valor?
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div 
                        onClick={() => setManualData({...manualData, destino: 'somar_fatura'})}
                        className={`p-4 rounded-3xl border cursor-pointer transition-all ${manualData.destino === 'somar_fatura' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                      >
                        <div className="font-black text-[10px] uppercase">Somar na Fatura</div>
                        <p className="text-[9px] mt-1 opacity-60 leading-tight">Adiciona ao boleto de hoje se existir.</p>
                        
                        {manualData.destino === 'somar_fatura' && (
                          <div className="mt-3 pt-3 border-t border-indigo-500/20">
                            {checkingBill ? (
                               <Loader2 size={12} className="animate-spin" />
                            ) : pendingBill ? (
                               <span className="text-[9px] font-bold text-white bg-indigo-500 px-2 py-0.5 rounded">Fatura encontrada: R$ {Number(pendingBill.valor).toFixed(2)}</span>
                            ) : (
                               <span className="text-[9px] font-bold text-amber-500">Nenhuma fatura hoje (gerará nova)</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div 
                        onClick={() => setManualData({...manualData, destino: 'separado'})}
                        className={`p-4 rounded-3xl border cursor-pointer transition-all ${manualData.destino === 'separado' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                      >
                        <div className="font-black text-[10px] uppercase">Cobrar Separado</div>
                        <p className="text-[9px] mt-1 opacity-60 leading-tight">Gera uma nova cobrança isolada.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase">Valor (R$)</label>
                  <input required type="number" step="0.01" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-indigo-500" value={manualData.valor} onChange={e => setManualData({...manualData, valor: e.target.value})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase">Data Referência</label>
                  <input required type="date" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-indigo-500" value={manualData.data_vencimento} onChange={e => setManualData({...manualData, data_vencimento: e.target.value})} />
                </div>

                <div className="col-span-2 space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase">Categoria</label>
                  <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm outline-none" value={manualData.categoria} onChange={e => setManualData({...manualData, categoria: e.target.value})}>
                     <option value="aluguel">Aluguel (Ajuste)</option>
                     <option value="manutencao">Manutenção / Peças</option>
                     <option value="multa">Multa de Trânsito</option>
                     <option value="bonus">Bônus / Crédito</option>
                     <option value="limpeza">Limpeza / Estética</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-600/20 active:scale-95 transition-all uppercase tracking-widest text-xs">
                Confirmar Lançamento
              </button>
            </form>
          </div>
        </div>
      )}
      {/* MODAL DE CONFIRMAÇÃO DE FATURAMENTO (CUSTOMIZADO) */}
      {showConfirmBillingModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center space-y-6">
              <div className="mx-auto w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-500 animate-pulse">
                <RefreshCcw size={40} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">Iniciar Faturamento Diário?</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  O sistema irá processar todos os **contratos ativos** vinculados à sua conta que possuem recorrência para hoje. Isso gerará novas cobranças pendentes no sistema.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button 
                  onClick={handleRunAutomatedCharges}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-2xl transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/20 uppercase text-xs tracking-widest"
                >
                  Sim, Iniciar Agora
                </button>
                <button 
                  onClick={() => setShowConfirmBillingModal(false)}
                  className="w-full bg-transparent hover:bg-zinc-800 text-zinc-500 font-bold py-4 rounded-2xl transition-all uppercase text-xs tracking-widest"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* MODAL MENSAGENS */}
      <MessageSelectorModal 
        isOpen={isMessageModalOpen}
        onClose={() => setIsMessageModalOpen(false)}
        locatario={selectedLocatarioData}
        usuario={profile}
      />
    </div>
  );
};

// Componente Auxiliar para Mini Cards de Resumo
const SummaryTile = ({ label, value, color, desc, isTotal = false }) => (
  <div className={`p-4 rounded-2xl border ${isTotal ? color : 'bg-zinc-900 border-zinc-800'}`}>
    <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{label}</div>
    <div className={`text-xl font-black mt-1 ${isTotal ? 'text-white' : color}`}>
      R$ {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </div>
    <div className="text-[8px] text-zinc-600 font-bold uppercase mt-1 italic">{desc}</div>
  </div>
);

export default Cobrancas;