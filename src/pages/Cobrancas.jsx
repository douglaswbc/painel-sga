import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle, Ban, Search, Loader2, Calendar,
  RefreshCcw, Plus, X, DollarSign, Tag, Info,
  Trash2, ChevronLeft, ChevronRight, CircleDollarSign,
  MessageSquare
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { useBilling } from '../hooks/useBilling';
import { cobrancasService } from '../services/cobrancas';
import { contratosService } from '../services/contratos';
import { locatariosService } from '../services/locatarios';
import { supabase } from '../services/supabase';
import { Button } from '../components/ui/Button';
import { KpiCard } from '../components/ui/KpiCard';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import MessageSelectorModal from '../components/MessageSelectorModal';

const SummaryTile = ({ label, value, color, desc, isTotal = false }) => (
  <div className={`p-4 rounded-2xl border ${isTotal ? color : 'bg-zinc-900 border-zinc-800'}`}>
    <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{label}</div>
    <div className={`text-xl font-black mt-1 ${isTotal ? 'text-white' : color}`}>
      R$ {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </div>
    <div className="text-[8px] text-zinc-600 font-bold uppercase mt-1 italic">{desc}</div>
  </div>
);

const Cobrancas = () => {
  const { profile } = useAuth();
  const { cobrancas, locatarios, loading, fetch: fetchCobrancas, markAsPaid, cancel, runDailyBilling } = useBilling(profile?.id);
  const [generating, setGenerating] = useState(false);
  const [showConfirmBillingModal, setShowConfirmBillingModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [selectedLocatarioData, setSelectedLocatarioData] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const [expandedLocatarios, setExpandedLocatarios] = useState([]);
  const [innerPages, setInnerPages] = useState({});

  const [manualData, setManualData] = useState({
    id_locatario: '', valor: '', categoria: 'manutencao',
    tipo: 'receita', destino: 'separado',
    data_vencimento: new Date().toISOString().split('T')[0]
  });
  const [pendingBill, setPendingBill] = useState(null);
  const [checkingBill, setCheckingBill] = useState(false);

  const [showCobrarModal, setShowCobrarModal] = useState(false);
  const [contratosAtivos, setContratosAtivos] = useState([]);
  const [selectedContrato, setSelectedContrato] = useState(null);
  const [cobrandoContrato, setCobrandoContrato] = useState(false);

  const [showBaixaModal, setShowBaixaModal] = useState(false);
  const [baixaTarget, setBaixaTarget] = useState(null);
  const [baixaLoading, setBaixaLoading] = useState(false);

  const handleMarcarPago = (cobranca) => {
    setBaixaTarget(cobranca);
    setShowBaixaModal(true);
  };

  const handleConfirmarBaixa = async (notificar) => {
    if (!baixaTarget) return;
    const alvo = baixaTarget;
    setBaixaLoading(true);
    try {
      await markAsPaid(alvo.id);
      setShowBaixaModal(false);
      if (notificar) {
        // Envia a confirmacao de pagamento pelo canal ativo (Meta ou Zernio),
        // usando o template configurado em Templates Meta.
        const { data, error } = await supabase.functions.invoke('zernio-whatsapp', {
          body: { action: 'send_payment_confirmation', chargeId: alvo.id },
        });
        if (error) throw new Error(data?.error || error.message);
        if (data?.error) {
          if (data.needsTemplate) {
            const locatarioId = alvo.contratos?.id_locatario;
            if (locatarioId) {
              const locData = await locatariosService.getById(locatarioId);
              setSelectedLocatarioData(locData);
              setIsMessageModalOpen(true);
              toast.info('Nenhum template de confirmação configurado. Escolha um template para enviar.');
            } else {
              toast.warning('Locatário não encontrado para notificação.');
            }
          } else {
            throw new Error(data.error);
          }
        } else {
          const canal = data?.channel?.providerLabel || 'canal ativo';
          toast.success(`Confirmação de pagamento enviada por ${data?.templateName || 'template'} (${canal}).`);
        }
      }
      setBaixaTarget(null);
    } catch (err) {
      toast.error(`Erro ao dar baixa: ${err.message}`);
    } finally {
      setBaixaLoading(false);
    }
  };

  const handleCancelar = async (id) => {
    if (!window.confirm("Tem certeza que deseja CANCELAR esta cobrança?")) return;
    try { await cancel(id); } catch (err) { toast.error("Erro ao cancelar: " + err.message); }
  };

  const handleRunAutomatedCharges = async () => {
    setShowConfirmBillingModal(false);
    setGenerating(true);
    try {
      const result = await runDailyBilling();
      const outcomes = Array.isArray(result?.results) ? result.results : [];
      const failed = outcomes.filter(item => item.status === 'error');
      const created = outcomes.filter(item => item.status === 'ok').length;
      const skipped = outcomes.filter(item => item.status === 'skipped_duplicate').length;

      if (failed.length) {
        const details = failed.slice(0, 3).map(item => `${item.id?.slice(0, 8) || 'contrato'}: ${item.msg || 'falha'}`).join(' | ');
        toast.error(`${failed.length} contrato(s) falharam. ${details}`);
      } else if (created || skipped) {
        toast.success(`Faturamento concluído: ${created} cobrança(s) criada(s), ${skipped} já existente(s).`);
      } else {
        toast.info(result?.message || 'Não há contratos vencidos para faturar.');
      }
    } catch (error) { toast.error(error.message); }
    finally { setGenerating(false); }
  };

  const handleOpenCobrar = async () => {
    setShowCobrarModal(true);
    setSelectedContrato(null);
    try {
      const all = await contratosService.list(profile.id);
      setContratosAtivos(all.filter(c => c.status === 'ativo'));
    } catch { toast.error('Erro ao carregar contratos'); }
  };

  const handleCobrarContrato = async () => {
    if (!selectedContrato) return;
    setCobrandoContrato(true);
    try {
      const result = await cobrancasService.cobrarContrato(selectedContrato.id);
      if (result.status === 'skipped_duplicate') {
        toast.warning(result.msg || 'Ja existe cobranca para este periodo.');
      } else if (result.status === 'error') {
        toast.error(result.msg);
      } else {
        toast.success('Cobranca gerada com sucesso!');
      }
      setShowCobrarModal(false);
      setSelectedContrato(null);
      fetchCobrancas();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCobrandoContrato(false);
    }
  };

  const handleSaveManual = async (e) => {
    e.preventDefault();
    try {
      if (manualData.tipo === 'despesa') {
        await cobrancasService.create({
          id_usuario: profile.id, valor: manualData.valor,
          categoria: manualData.categoria, tipo: 'despesa',
          status: 'pago', data_vencimento: manualData.data_vencimento,
          data_pagamento: new Date(`${manualData.data_vencimento}T12:00:00`).toISOString(),
        });
        toast.success("Despesa registrada com sucesso!");
      } else if (manualData.tipo === 'receita' && manualData.destino === 'somar_fatura') {
        if (!pendingBill) {
          toast.warning("Não há fatura PENDENTE para somar. Criando cobrança SEPARADA.");
          const contrato = await contratosService.getAtivoByLocatario(manualData.id_locatario);
          await cobrancasService.create({
            id_usuario: profile.id, id_contrato: contrato?.id || null, id_locatario: manualData.id_locatario,
            valor: manualData.valor, categoria: manualData.categoria,
            tipo: 'receita', status: 'pendente', data_vencimento: manualData.data_vencimento,
          });
        } else {
          const novoValor = Number(pendingBill.valor) + Number(manualData.valor);
          await cobrancasService.update(pendingBill.id, {
            valor: novoValor, payment_link: null, mercado_pago_id: null,
          });
          toast.success(`Valor somado à fatura pendente! Novo total: R$ ${novoValor.toFixed(2)}`);
        }
      } else {
        const contrato = await contratosService.getAtivoByLocatario(manualData.id_locatario);
        await cobrancasService.create({
          id_usuario: profile.id, id_contrato: contrato?.id || null, id_locatario: manualData.id_locatario,
          valor: manualData.valor, categoria: manualData.categoria,
          tipo: 'receita', status: 'pendente', data_vencimento: manualData.data_vencimento,
        });
        toast.success("Nova cobrança avulsa gerada!");
      }
      setShowManualModal(false);
      fetchCobrancas();
    } catch (err) { toast.error(err.message); }
  };

  useEffect(() => {
    const fetchPending = async () => {
      if (manualData.id_locatario && manualData.tipo === 'receita' && manualData.destino === 'somar_fatura') {
        setCheckingBill(true);
        try {
          const contrato = await contratosService.getAtivoByLocatario(manualData.id_locatario);
          if (contrato) {
            const bill = await cobrancasService.getPendingByContrato(contrato.id);
            setPendingBill(bill);
          } else { setPendingBill(null); }
        } catch { setPendingBill(null); }
        finally { setCheckingBill(false); }
      } else { setPendingBill(null); }
    };
    fetchPending();
  }, [manualData.id_locatario, manualData.destino, manualData.tipo]);

  const filteredData = useMemo(() => {
    return cobrancas.filter(c => {
      const search = searchTerm.toLowerCase();
      const matchesSearch = (c.contratos?.locatarios?.nome_completo || "Lançamento Avulso").toLowerCase().includes(search) ||
        (c.categoria || "").toLowerCase().includes(search);
      const matchesFilter = filterStatus === 'todos' ||
        (filterStatus === 'despesa' ? c.tipo === 'despesa' : c.status === filterStatus);
      const date = c.data_vencimento;
      return matchesSearch && matchesFilter && (!startDate || date >= startDate) && (!endDate || date <= endDate);
    });
  }, [cobrancas, searchTerm, filterStatus, startDate, endDate]);

  const groupedData = useMemo(() => {
    const groups = filteredData.reduce((acc, c) => {
      const locId = c.contratos?.id_locatario || 'avulso';
      const locNome = c.contratos?.locatarios?.nome_completo || "Faturamentos Avulsos / Externos";
      if (!acc[locId]) {
        acc[locId] = { id: locId, nome: locNome, placa: c.contratos?.veiculos?.placa || "N/A", items: [], totalPendente: 0, totalPago: 0 };
      }
      acc[locId].items.push(c);
      const val = Number(c.valor);
      if (c.status === 'pago') acc[locId].totalPago += val;
      else if (c.status !== 'cancelado') acc[locId].totalPendente += val;
      return acc;
    }, {});
    return Object.values(groups).sort((a, b) => b.totalPendente - a.totalPendente);
  }, [filteredData]);

  const summary = useMemo(() => {
    return filteredData.reduce((acc, c) => {
      const val = Number(c.valor);
      if (c.tipo === 'receita') {
        if (c.status === 'pago') acc.receitaRealizada += val;
        else if (c.status !== 'cancelado') acc.receitaPendente += val;
      } else { acc.despesas += val; }
      return acc;
    }, { receitaRealizada: 0, receitaPendente: 0, despesas: 0 });
  }, [filteredData]);

  const totalPages = Math.ceil(groupedData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentGroups = groupedData.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => { setCurrentPage(1); setInnerPages({}); }, [searchTerm, filterStatus, startDate, endDate]);

  const handleExportCSV = () => {
    const headers = ["Locatário", "Placa", "Vencimento", "Categoria", "Valor", "Status"];
    const rows = filteredData.map(c => [
      c.contratos?.locatarios?.nome_completo || "Lançamento Avulso",
      c.contratos?.veiculos?.placa || "N/A", c.data_vencimento, c.categoria, c.valor, c.status
    ]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cobrancas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    link.remove();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxo de Caixa"
        description="Visão agrupada por locatário para melhor organização."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-2">
          <Calendar size={14} className="text-zinc-500" />
          <input type="date" className="bg-transparent py-2 text-[10px] text-zinc-300 font-bold outline-none" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <span className="text-zinc-700 text-[10px]">até</span>
          <input type="date" className="bg-transparent py-2 text-[10px] text-zinc-300 font-bold outline-none" value={endDate} onChange={e => setEndDate(e.target.value)} />
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); }} className="text-zinc-500 hover:text-white"><X size={14} /></button>
          )}
        </div>

        <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Buscar..." className="w-40 md:w-auto" />

        <Button variant="secondary" icon={RefreshCcw} size="sm" onClick={handleExportCSV}>Exportar</Button>
        <Button variant="secondary" icon={Plus} size="sm" onClick={() => setShowManualModal(true)}>Lançamento</Button>
        <Button variant="secondary" icon={CircleDollarSign} size="sm" onClick={handleOpenCobrar}>Cobrar</Button>
        <Button icon={RefreshCcw} size="sm" onClick={() => setShowConfirmBillingModal(true)} disabled={generating}>
          {generating ? 'Processando...' : 'Faturamento Diário'}
        </Button>

        <div className="h-8 w-[1px] bg-slate-800 mx-2 hidden md:block" />

        <select className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-400 text-xs font-bold outline-none cursor-pointer" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="todos">Status</option>
          <option value="pendente">Pendentes</option>
          <option value="pago">Pagos</option>
          <option value="atrasado">Atrasados</option>
          <option value="cancelado">Cancelados</option>
          <option value="despesa">Despesas</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryTile label="Total Realizado" value={summary.receitaRealizada} color="text-emerald-400" desc="Receitas pagas" />
        <SummaryTile label="Total Pendente" value={summary.receitaPendente} color="text-amber-400" desc="Futuro / Atrasado" />
        <SummaryTile label="Total Despesas" value={summary.despesas} color="text-red-400" desc="Saídas registradas" />
        <SummaryTile label="Saldo Final" value={summary.receitaRealizada - summary.despesas} color="text-white bg-indigo-500/10 border-indigo-500/20" desc="Realizado - Despesas" isTotal />
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="py-20 text-center bg-zinc-900 rounded-3xl border border-zinc-800">
            <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} />
          </div>
        ) : currentGroups.length > 0 ? currentGroups.map(group => (
          <div key={group.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl transition-all hover:border-zinc-700">
            <div onClick={() => setExpandedLocatarios(prev => prev.includes(group.id) ? prev.filter(i => i !== group.id) : [...prev, group.id])}
              className="p-5 flex items-center justify-between cursor-pointer bg-zinc-950/40 hover:bg-zinc-950/60">
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
                <button onClick={(e) => { e.stopPropagation(); const locData = group.items[0]?.contratos?.locatarios; if (locData) { setSelectedLocatarioData(locData); setIsMessageModalOpen(true); } else { toast.warning("Dados de contato não encontrados."); } }}
                  className="p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all" title="Enviar Mensagem WhatsApp">
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
                              <td className="py-4 font-mono text-zinc-400">{new Date(c.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                              <td className="py-4">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${c.tipo === 'despesa' ? 'bg-red-500/10 text-red-500' : 'bg-zinc-800 text-zinc-400'}`}>{c.categoria}</span>
                              </td>
                              <td className="py-4">
                                <span className={`font-bold ${c.tipo === 'despesa' ? 'text-red-500' : 'text-white'}`}>{c.tipo === 'despesa' ? '-' : ''} R$ {Number(c.valor).toFixed(2).replace('.', ',')}</span>
                              </td>
                              <td className="py-4 text-center">
                                <StatusBadge status={c.status}>{c.status}</StatusBadge>
                              </td>
                              <td className="py-4 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-20 group-hover/item:opacity-100 transition-opacity">
                                  {c.status === 'pendente' && (
                                    <>
                                      <button onClick={() => handleMarcarPago(c)} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-lg" title="Dar Baixa"><CheckCircle size={14} /></button>
                                      <button onClick={() => handleCancelar(c.id)} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg" title="Cancelar"><Trash2 size={14} /></button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {totalInner > 1 && (
                        <div className="mt-4 flex items-center justify-between border-t border-zinc-800/30 pt-4">
                          <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest">Página {pageInner} de {totalInner}</span>
                          <div className="flex gap-1">
                            <button onClick={(e) => { e.stopPropagation(); setInnerPages({ ...innerPages, [group.id]: Math.max(pageInner - 1, 1) }); }} disabled={pageInner === 1}
                              className="p-1 text-zinc-500 hover:text-white disabled:opacity-20"><ChevronLeft size={16} /></button>
                            <button onClick={(e) => { e.stopPropagation(); setInnerPages({ ...innerPages, [group.id]: Math.min(pageInner + 1, totalInner) }); }} disabled={pageInner === totalInner}
                              className="p-1 text-zinc-500 hover:text-white disabled:opacity-20"><ChevronRight size={16} /></button>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )) : (
          <div className="py-20 text-center bg-zinc-900 rounded-3xl border border-zinc-800">
            <div className="bg-zinc-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 font-medium italic">Nenhum locatário com cobranças para os filtros selecionados.</p>
          </div>
        )}

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPrev={() => setCurrentPage(p => Math.max(p - 1, 1))}
          onNext={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
          label={`Exibindo ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, groupedData.length)} de ${groupedData.length} Locatários`}
        />
      </div>

      <Modal isOpen={showManualModal} onClose={() => setShowManualModal(false)} title="Novo Lançamento Manual" size="max-w-lg">
        <form onSubmit={handleSaveManual}>
          <ModalBody>
            <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Natureza da Operação</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setManualData({ ...manualData, tipo: 'receita' })}
                  className={`flex flex-col items-center gap-2 p-4 rounded-3xl transition-all border ${manualData.tipo === 'receita' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                  <CircleDollarSign size={24} /><span className="text-xs font-black uppercase">Receita (Entrada)</span>
                </button>
                <button type="button" onClick={() => setManualData({ ...manualData, tipo: 'despesa', destino: 'separado' })}
                  className={`flex flex-col items-center gap-2 p-4 rounded-3xl transition-all border ${manualData.tipo === 'despesa' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                  <DollarSign size={24} /><span className="text-xs font-black uppercase">Despesa (Saída)</span>
                </button>
              </div>
            </div>

            {manualData.tipo === 'receita' && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Locatário Responsável</label>
                <select required className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm outline-none focus:border-indigo-500"
                  value={manualData.id_locatario} onChange={e => setManualData({ ...manualData, id_locatario: e.target.value })}>
                  <option value="">Selecione o locatário...</option>
                  {locatarios.map(l => <option key={l.id} value={l.id}>{l.nome_completo}</option>)}
                </select>
              </div>
            )}

            {manualData.id_locatario && manualData.tipo === 'receita' && (
              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Info size={12} /> Como cobrar esse valor?</label>
                <div className="grid grid-cols-2 gap-3">
                  <div onClick={() => setManualData({ ...manualData, destino: 'somar_fatura' })}
                    className={`p-4 rounded-3xl border cursor-pointer transition-all ${manualData.destino === 'somar_fatura' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                    <div className="font-black text-[10px] uppercase">Somar na Fatura</div>
                    <p className="text-[9px] mt-1 opacity-60">Adiciona ao boleto de hoje se existir.</p>
                    {manualData.destino === 'somar_fatura' && (
                      <div className="mt-3 pt-3 border-t border-indigo-500/20">
                        {checkingBill ? <Loader2 size={12} className="animate-spin" /> : pendingBill
                          ? <span className="text-[9px] font-bold text-white bg-indigo-500 px-2 py-0.5 rounded">Fatura encontrada: R$ {Number(pendingBill.valor).toFixed(2)}</span>
                          : <span className="text-[9px] font-bold text-amber-500">Nenhuma fatura hoje (gerará nova)</span>}
                      </div>
                    )}
                  </div>
                  <div onClick={() => setManualData({ ...manualData, destino: 'separado' })}
                    className={`p-4 rounded-3xl border cursor-pointer transition-all ${manualData.destino === 'separado' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                    <div className="font-black text-[10px] uppercase">Cobrar Separado</div>
                    <p className="text-[9px] mt-1 opacity-60">Gera uma nova cobrança isolada.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase">Valor (R$)</label>
                <input required type="number" step="0.01" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-indigo-500"
                  value={manualData.valor} onChange={e => setManualData({ ...manualData, valor: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase">Data Referência</label>
                <input required type="date" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-indigo-500"
                  value={manualData.data_vencimento} onChange={e => setManualData({ ...manualData, data_vencimento: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase">Categoria</label>
              <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm outline-none"
                value={manualData.categoria} onChange={e => setManualData({ ...manualData, categoria: e.target.value })}>
                <option value="aluguel">Aluguel (Ajuste)</option>
                <option value="manutencao">Manutenção / Peças</option>
                <option value="multa">Multa de Trânsito</option>
                <option value="bonus">Bônus / Crédito</option>
                <option value="limpeza">Limpeza / Estética</option>
              </select>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="submit" className="w-full">Confirmar Lançamento</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal isOpen={showBaixaModal} onClose={() => { if (!baixaLoading) { setShowBaixaModal(false); setBaixaTarget(null); } }} title="Confirmar Baixa" size="max-w-sm">
        <div className="p-4 space-y-4">
          <p className="text-zinc-300 text-sm leading-relaxed">
            Deseja apenas dar baixa nesta cobranca ou tambem notificar o locatario?
          </p>
          {baixaTarget && (
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Cobranca</p>
              <p className="text-white font-bold text-sm">{baixaTarget.contratos?.locatarios?.nome_completo || 'Avulso'}</p>
              <p className="text-emerald-400 font-black">R$ {Number(baixaTarget.valor).toFixed(2).replace('.', ',')}</p>
            </div>
          )}
          <div className="flex flex-col gap-3 pt-2">
            <Button onClick={() => handleConfirmarBaixa(false)} disabled={baixaLoading} variant="secondary" className="w-full">
              {baixaLoading ? 'Processando...' : 'Apenas Dar Baixa'}
            </Button>
            <Button onClick={() => handleConfirmarBaixa(true)} disabled={baixaLoading} className="w-full">
              {baixaLoading ? 'Processando...' : 'Dar Baixa e Notificar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showConfirmBillingModal} onClose={() => setShowConfirmBillingModal(false)} title="Iniciar Faturamento Diário?" size="max-w-md">
        <div className="p-8 text-center space-y-6">
          <div className="mx-auto w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-500 animate-pulse">
            <RefreshCcw size={40} />
          </div>
          <p className="text-zinc-400 text-sm leading-relaxed">
            O sistema irá processar todos os contratos ativos vinculados à sua conta que possuem recorrência para hoje. Isso gerará novas cobranças pendentes no sistema.
          </p>
          <div className="flex flex-col gap-3 pt-4">
            <Button onClick={handleRunAutomatedCharges} className="w-full">Sim, Iniciar Agora</Button>
            <Button variant="ghost" onClick={() => setShowConfirmBillingModal(false)} className="w-full">Cancelar</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCobrarModal} onClose={() => { setShowCobrarModal(false); setSelectedContrato(null); }} title="Cobrar Contrato" size="max-w-lg">
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Contrato Ativo</label>
            <select
              className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm outline-none focus:border-indigo-500"
              value={selectedContrato?.id || ''}
              onChange={e => {
                const found = contratosAtivos.find(c => c.id === e.target.value);
                setSelectedContrato(found || null);
              }}
            >
              <option value="">Selecione o contrato...</option>
              {contratosAtivos.map(c => (
                <option key={c.id} value={c.id}>
                  {c.locatarios?.nome_completo} — {c.veiculos?.placa} (R$ {Number(c.valor).toFixed(2)})
                </option>
              ))}
            </select>
          </div>

          {selectedContrato && (
            <div className="p-5 bg-zinc-950 border border-zinc-800 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Locatario</p>
                  <p className="text-white font-bold">{selectedContrato.locatarios?.nome_completo}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Veiculo</p>
                  <p className="text-indigo-400 font-mono font-bold">{selectedContrato.veiculos?.placa} — {selectedContrato.veiculos?.modelo}</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-800/50 pt-3">
                <div>
                  <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Valor</p>
                  <p className="text-emerald-400 font-black text-lg">R$ {Number(selectedContrato.valor).toFixed(2).replace('.', ',')}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Proximo Vencimento</p>
                  <p className="text-amber-400 font-bold text-sm">{new Date(selectedContrato.proxima_cobranca).toLocaleDateString('pt-BR')}</p>
                </div>
              </div>
              <div className="text-right border-t border-zinc-800/50 pt-3">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Status</p>
                <StatusBadge status={selectedContrato.status}>{selectedContrato.status}</StatusBadge>
              </div>
            </div>
          )}

          {contratosAtivos.length === 0 && (
            <p className="text-zinc-500 text-sm text-center py-4 italic">Nenhum contrato ativo encontrado.</p>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setShowCobrarModal(false); setSelectedContrato(null); }}>Cancelar</Button>
          <Button onClick={handleCobrarContrato} disabled={!selectedContrato || cobrandoContrato}>
            {cobrandoContrato ? 'Gerando...' : 'Confirmar Cobranca'}
          </Button>
        </ModalFooter>
      </Modal>

      <MessageSelectorModal
        isOpen={isMessageModalOpen}
        onClose={() => setIsMessageModalOpen(false)}
        locatario={selectedLocatarioData}
        usuario={profile}
      />
    </div>
  );
};

export default Cobrancas;
