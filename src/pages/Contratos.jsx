import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Pencil, Trash2, X, CheckCircle2, 
  Pause, User, Car, Loader2, DollarSign, Calendar, AlertTriangle 
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';

const getRecurrenceLabel = (rec) => {
  try {
    if (!rec) return 'N/A';
    if (typeof rec === 'string' && rec.startsWith('{')) {
      const config = JSON.parse(rec);
      const unitMap = { daily: 'dia(s)', weekly: 'semana(s)', monthly: 'mês(es)', yearly: 'ano(s)' };
      let label = `A cada ${config.intervalo} ${unitMap[config.frequencia] || 'vezes'}`;

      if (config.horario) label += ` às ${config.horario}`;

      if (config.frequencia === 'weekly' && config.dias?.length > 0) {
        const dayMap = { 
          dom: 'Dom', sun: 'Dom', 
          seg: 'Seg', mon: 'Seg', 
          ter: 'Ter', tue: 'Ter', 
          qua: 'Qua', wed: 'Qua', 
          qui: 'Qui', thu: 'Qui', 
          sex: 'Sex', fri: 'Sex', 
          sab: 'Sáb', sat: 'Sáb' 
        };
        const selectedDays = [...new Set(config.dias.map(d => dayMap[d.toLowerCase()]).filter(Boolean))];
        if (selectedDays.length > 0) label += ` (${selectedDays.join(', ')})`;
      }

      if (config.termina?.tipo === 'data' && config.termina.valor) {
        label += ` • Até ${new Date(config.termina.valor).toLocaleDateString('pt-BR')}`;
      } else if (config.termina?.tipo === 'ocorrencia' && config.termina.valor) {
        label += ` • Até ${config.termina.valor} cobranças`;
      } else if (config.termina?.tipo === 'periodo' && config.termina.valor) {
        const unitLabel = { s: 'semanas', m: 'meses', a: 'anos' }[config.termina.unidade] || 'período';
        label += ` • Durante ${config.termina.valor} ${unitLabel}`;
      }

      if (config.expiracao) {
        label += ` • Expira em ${config.expiracao}h`;
      }

      return label;
    }
    return rec.replace('@', ' às ').replace('@', ' ');
  } catch (e) {
    return 'Recorrência customizada';
  }
};

const Contratos = () => {
  const { profile } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [locatarios, setLocatarios] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [formData, setFormData] = useState({
    recorrencia: 'weekly@mon@20:00',
    status: 'ativo',
    valor: '',
    data_inicio: '',
    id_locatario: '',
    id_veiculo: '',
    horario_faturamento: '20:00',
    expiracao_horas: 24,
    recorrencia_config: {
      frequencia: 'weekly',
      intervalo: 1,
      dias: ['seg'],
      termina: { tipo: 'nunca', valor: null }
    }
  });

  const [showCustomRecurrence, setShowCustomRecurrence] = useState(false);

  useEffect(() => {
    if (profile?.id) fetchData();
  }, [profile]);

  // 1. BUSCA DE DADOS COMPLETA
  const fetchData = async () => {
    try {
      setLoading(true);
      const [contractsRes, locatariosRes, veiculosRes] = await Promise.all([
        supabase
          .from('contratos')
          .select(`*, locatarios(nome_completo), veiculos(placa, modelo)`)
          .eq('id_usuario', profile.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('locatarios')
          .select('id, nome_completo')
          .eq('id_usuario', profile.id)
          .eq('ativo', true),
        supabase
          .from('veiculos')
          .select('id, placa, modelo')
          .eq('id_usuario', profile.id)
          .eq('ativo', true)
      ]);

      if (contractsRes.error) throw contractsRes.error;
      
      setContracts(contractsRes.data || []);
      setLocatarios(locatariosRes.data || []);
      setVeiculos(veiculosRes.data || []);
    } catch (err) {
      toast.error('Erro ao buscar dados dos contratos');
    } finally {
      setLoading(false);
    }
  };


  // 2. LÓGICA DE FILTRAGEM: VEÍCULOS DISPONÍVEIS
  const availableVehicles = useMemo(() => {
    // Pegamos IDs de carros que estão em contratos ATIVOS
    // Se estivermos editando, o carro do contrato atual NÃO deve ser bloqueado
    const occupiedVehicleIds = contracts
      .filter(c => c.status === 'ativo' && (!editingContract || c.id !== editingContract.id))
      .map(c => c.id_veiculo);

    return veiculos.filter(v => !occupiedVehicleIds.includes(v.id));
  }, [veiculos, contracts, editingContract]);

  // 3. SIMULADOR DE CONTRATO (PREVISÃO)
  const contractSummary = useMemo(() => {
    if (!formData.data_inicio || !formData.recorrencia_config) return null;

    const config = formData.recorrencia_config;
    const startDate = new Date(formData.data_inicio + 'T00:00:00');
    let simulatedCount = 0;
    let lastDate = null;

    const dayMapIndex = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const selectedDayIndices = config.dias.map(d => dayMapIndex[d.toLowerCase()]);

    if (config.termina.tipo === 'nunca') return null;

    let checkDate = new Date(startDate);
    const safetyLimit = 2000; // Evita loop infinito

    if (config.termina.tipo === 'ocorrencia') {
      const target = config.termina.valor || 1;
      while (simulatedCount < target && simulatedCount < safetyLimit) {
        if (config.frequencia === 'weekly') {
          if (selectedDayIndices.includes(checkDate.getDay())) {
            simulatedCount++;
            lastDate = new Date(checkDate);
          }
          if (checkDate.getDay() === 6) {
            checkDate.setDate(checkDate.getDate() + (7 * (config.intervalo - 1)) + 1);
          } else {
            checkDate.setDate(checkDate.getDate() + 1);
          }
        } else {
          simulatedCount++;
          lastDate = new Date(checkDate);
          if (config.frequencia === 'daily') checkDate.setDate(checkDate.getDate() + config.intervalo);
          else if (config.frequencia === 'monthly') checkDate.setMonth(checkDate.getMonth() + config.intervalo);
          else if (config.frequencia === 'yearly') checkDate.setFullYear(checkDate.getFullYear() + config.intervalo);
        }
      }
    } else if (config.termina.tipo === 'data' || config.termina.tipo === 'periodo') {
      let endDate;
      if (config.termina.tipo === 'data') {
        endDate = new Date(config.termina.valor + 'T23:59:59');
      } else {
        // Por Período (calcula a data final baseada na data de início)
        endDate = new Date(startDate);
        const val = config.termina.valor || 1;
        if (config.termina.unidade === 's') endDate.setDate(endDate.getDate() + (val * 7));
        else if (config.termina.unidade === 'm') endDate.setMonth(endDate.getMonth() + val);
        else if (config.termina.unidade === 'a') endDate.setFullYear(endDate.getFullYear() + val);
        endDate.setHours(23, 59, 59);
      }

      while (checkDate <= endDate && simulatedCount < safetyLimit) {
        if (config.frequencia === 'weekly') {
          if (selectedDayIndices.includes(checkDate.getDay())) {
            simulatedCount++;
            lastDate = new Date(checkDate);
          }
          if (checkDate.getDay() === 6) {
            checkDate.setDate(checkDate.getDate() + (7 * (config.intervalo - 1)) + 1);
          } else {
            checkDate.setDate(checkDate.getDate() + 1);
          }
        } else {
          simulatedCount++;
          lastDate = new Date(checkDate);
          if (config.frequencia === 'daily') checkDate.setDate(checkDate.getDate() + config.intervalo);
          else if (config.frequencia === 'monthly') checkDate.setMonth(checkDate.getMonth() + config.intervalo);
          else if (config.frequencia === 'yearly') checkDate.setFullYear(checkDate.getFullYear() + config.intervalo);
        }
      }
    }

    return { 
      totalCharges: simulatedCount, 
      estimatedEndDate: lastDate, 
      totalValue: simulatedCount * (formData.valor || 0) 
    };
  }, [formData.data_inicio, formData.recorrencia_config, formData.valor]);

  // 4. SALVAR / EDITAR COM TIMESTAMP ISO E COBRANÇA INICIAL
  const handleSave = async (e) => {
    e.preventDefault();
    try {
      // Cálculo do Timestamp ISO para proxima_cobranca (Brasília)
      // Se for configuração complexa, usamos o horário definido nela
      const horario = formData.horario_faturamento || '20:00';
      
      let dataCalculada = new Date(`${formData.data_inicio}T${horario}:00`);
      
      // Se for semanal, garante que a primeira cobrança seja em um dos dias selecionados
      if (showCustomRecurrence && formData.recorrencia_config.frequencia === 'weekly') {
        const dayMapIndex = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        const selectedDayIndices = formData.recorrencia_config.dias.map(d => dayMapIndex[d.toLowerCase()]);
        
        // Procura o primeiro dia válido a partir da data_inicio
        let encontrou = false;
        for (let i = 0; i < 7; i++) {
          if (selectedDayIndices.includes(dataCalculada.getDay())) {
            encontrou = true;
            break;
          }
          dataCalculada.setDate(dataCalculada.getDate() + 1);
        }
      }

      const proximaCobrancaISO = dataCalculada.toISOString();

      // Se for configuração complexa, empacotamos TUDO no JSON da recorrência
      // para evitar erro de colunas inexistentes no banco (como expiracao_horas)
      let recorrenciaFinal = formData.recorrencia;
      if (showCustomRecurrence) {
        recorrenciaFinal = JSON.stringify({
          ...formData.recorrencia_config,
          horario: formData.horario_faturamento,
          expiracao: formData.expiracao_horas
        });
      }

      // Payload explícito para evitar enviar colunas que não existem no banco
      const payload = { 
        recorrencia: recorrenciaFinal,
        status: formData.status || 'ativo',
        valor: formData.valor,
        data_inicio: formData.data_inicio,
        id_locatario: formData.id_locatario,
        id_veiculo: formData.id_veiculo,
        id_usuario: profile.id,
        proxima_cobranca: proximaCobrancaISO 
      };

      if (editingContract) {
        const { error } = await supabase
          .from('contratos')
          .update(payload)
          .eq('id', editingContract.id);
        
        if (error) throw error;
        toast.success('Contrato atualizado');
      } else {
        // Cria Contrato + Primeira Cobrança
        const { data: novoContrato, error: contratoError } = await supabase
          .from('contratos')
          .insert([payload])
          .select()
          .single();

        if (contratoError) throw contratoError;
        toast.success('Contrato gerado com sucesso!');
      }

      setShowModal(false);
      fetchData();
    } catch (err) {
      toast.error(err.code === '23505' ? 'Este veículo já possui um contrato ativo!' : err.message);
    }
  };

  // 4. ALTERAR STATUS (ATIVO / PAUSADO)
  const toggleContractStatus = async (contract) => {
    const newStatus = contract.status === 'ativo' ? 'pausado' : 'ativo';
    try {
      const { error } = await supabase
        .from('contratos')
        .update({ status: newStatus })
        .eq('id', contract.id);
      
      if (error) throw error;
      toast.success(`Contrato ${newStatus === 'ativo' ? 'ativado' : 'pausado'}`);
      fetchData();
    } catch (err) {
      toast.error('Erro ao atualizar status. Verifique se o veículo está disponível.');
    }
  };

  // 5. EXCLUSÃO
  const deleteContract = async (id) => {
    if (!confirm('Deseja excluir este contrato? As cobranças vinculadas podem ser afetadas.')) return;
    try {
      const { error } = await supabase.from('contratos').delete().eq('id', id);
      if (error) throw error;
      toast.success('Contrato removido');
      fetchData();
    } catch (err) {
      toast.error('Erro ao excluir contrato.');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestão de Contratos</h2>
          <p className="text-sm text-zinc-500 font-medium">Controle de frotas e recorrências.</p>
        </div>
        <button 
          onClick={() => {
            setEditingContract(null);
            setFormData({ 
              recorrencia: 'weekly@mon@20:00', 
              status: 'ativo', 
              valor: '', 
              data_inicio: '', 
              id_locatario: '', 
              id_veiculo: '',
              horario_faturamento: '20:00',
              expiracao_horas: 24,
              recorrencia_config: { frequencia: 'weekly', intervalo: 1, dias: ['mon'], termina: { tipo: 'nunca', valor: null } }
            });
            setShowCustomRecurrence(false);
            setShowModal(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/20"
        >
          <Plus size={20} />
          Novo Contrato
        </button>
      </div>

      {/* TABLE DESKTOP (Oculta em Mobile) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-zinc-950/50 text-zinc-500 border-b border-zinc-800 font-bold tracking-widest">
              <tr>
                <th className="px-6 py-5">Locatário / Veículo</th>
                <th className="px-6 py-5">Valor Semanal</th>
                <th className="px-6 py-5">Recorrência</th>
                <th className="px-6 py-5 text-center">Status</th>
                <th className="px-6 py-5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr><td colSpan={5} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-500" size={32} /></td></tr>
              ) : contracts.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-zinc-100 font-bold">
                        <User size={14} className="text-indigo-400" />
                        {item.locatarios?.nome_completo}
                      </div>
                      <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium">
                        <Car size={14} className="text-zinc-600" />
                        {item.veiculos?.modelo} • <span className="text-indigo-500 font-mono font-bold">{item.veiculos?.placa}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-emerald-400 font-black text-base">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-zinc-300 text-xs flex flex-col gap-0.5">
                       <span className="capitalize font-semibold">{getRecurrenceLabel(item.recorrencia)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button 
                      onClick={() => toggleContractStatus(item)}
                      className={`mx-auto px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-2 border transition-all ${
                        item.status === 'ativo' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      }`}
                    >
                      {item.status === 'ativo' ? <CheckCircle2 size={12} /> : <Pause size={12} />}
                      {item.status}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right space-x-1">
                    <button 
                      onClick={() => { 
                        let dataToSet = { 
                          ...item,
                          horario_faturamento: '20:00',
                          expiracao_horas: 24,
                          recorrencia_config: { frequencia: 'weekly', intervalo: 1, dias: ['seg'], termina: { tipo: 'nunca', valor: null } }
                        };
                        let isCustom = false;
                        
                        if (item.recorrencia?.startsWith('{')) {
                           try {
                              const config = JSON.parse(item.recorrencia);
                              dataToSet.recorrencia_config = config;
                              dataToSet.horario_faturamento = config.horario || '20:00';
                              dataToSet.expiracao_horas = config.expiracao || 24;
                              isCustom = true;
                           } catch (e) {}
                        }
                        
                        setEditingContract(item); 
                        setFormData(dataToSet); 
                        setShowCustomRecurrence(isCustom);
                        setShowModal(true); 
                      }} 
                      className="p-2.5 text-zinc-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all"
                    >
                      <Pencil size={18} />
                    </button>
                    <button onClick={() => deleteContract(item.id)} className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"><Trash2 size={18} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CARDS MOBILE (Ocultos em Desktop) */}
      <div className="md:hidden space-y-4">
        {loading ? (
          <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-indigo-500" size={32} /></div>
        ) : contracts.map((item) => (
          <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-xl">
             <div className="flex justify-between items-start">
                <div className="space-y-1">
                   <div className="flex items-center gap-2 text-white font-black uppercase text-sm tracking-tight">
                      <User size={14} className="text-indigo-500" /> {item.locatarios?.nome_completo}
                   </div>
                   <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold">
                      <Car size={14} /> {item.veiculos?.modelo} • <span className="text-indigo-500 font-mono underline decoration-indigo-500/30">{item.veiculos?.placa}</span>
                   </div>
                </div>
                <button 
                  onClick={() => toggleContractStatus(item)}
                  className={`px-3 py-1.5 rounded-full text-[8px] font-black uppercase flex items-center gap-2 border transition-all ${
                    item.status === 'ativo' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                  }`}
                >
                  {item.status === 'ativo' ? <CheckCircle2 size={10} /> : <Pause size={10} />}
                  {item.status}
                </button>
             </div>

             <div className="flex items-end justify-between border-y border-zinc-800/50 py-3">
                <div className="space-y-0.5">
                   <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">Faturamento Semanal</p>
                   <p className="text-emerald-400 font-black text-xl leading-none">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</p>
                </div>
                <div className="text-right space-y-0.5">
                   <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">Recorrência</p>
                   <p className="text-zinc-300 font-bold text-[10px] flex items-center justify-end gap-1 uppercase">
                      {getRecurrenceLabel(item.recorrencia)}
                   </p>
                </div>
             </div>

             <div className="flex gap-2">
                <button 
                  onClick={() => { 
                    let dataToSet = { 
                      ...item,
                      horario_faturamento: '20:00',
                      expiracao_horas: 24,
                      recorrencia_config: { frequencia: 'weekly', intervalo: 1, dias: ['mon'], termina: { tipo: 'nunca', valor: null } }
                    };
                    let isCustom = false;

                    if (item.recorrencia?.startsWith('{')) {
                        try {
                          const config = JSON.parse(item.recorrencia);
                          dataToSet.recorrencia_config = config;
                          dataToSet.horario_faturamento = config.horario || '20:00';
                          dataToSet.expiracao_horas = config.expiracao || 24;
                          isCustom = true;
                        } catch (e) {}
                    }

                    setEditingContract(item); 
                    setFormData(dataToSet); 
                    setShowCustomRecurrence(isCustom);
                    setShowModal(true); 
                  }} 
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-500/10 text-indigo-500 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  <Pencil size={14} /> Editar
                </button>
                <button onClick={() => deleteContract(item.id)} className="px-4 bg-red-500/10 text-red-500 py-3 rounded-xl border border-red-500/5"><Trash2 size={16} /></button>
             </div>
          </div>
        ))}
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/90 backdrop-blur-sm animate-in fade-in duration-200 py-10 px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden ring-1 ring-white/10 mx-auto relative focus:outline-none">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
              <h3 className="text-xl font-bold text-white">{editingContract ? 'Editar Contrato' : 'Assinar Novo Contrato'}</h3>
              <button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-white transition-colors"><X size={24} /></button>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-6">
               <div className="grid grid-cols-1 gap-6">
                  {/* SELECT LOCATARIO */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Locatário (Cliente)</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                      <select required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-zinc-100 focus:border-indigo-500 outline-none appearance-none" value={formData.id_locatario || ''} onChange={e => setFormData({...formData, id_locatario: e.target.value})}>
                        <option value="">Selecione um locatário...</option>
                        {locatarios.map(l => <option key={l.id} value={l.id}>{l.nome_completo}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* SELECT VEICULO DISPONÍVEL */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Veículo Disponível</label>
                    <div className="relative">
                      <Car className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                      <select 
                        required 
                        disabled={availableVehicles.length === 0 && !editingContract}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-zinc-100 focus:border-indigo-500 outline-none appearance-none disabled:opacity-50" 
                        value={formData.id_veiculo || ''} 
                        onChange={e => setFormData({...formData, id_veiculo: e.target.value})}
                      >
                        <option value="">
                          {availableVehicles.length === 0 && !editingContract ? "Nenhum veículo livre no momento" : "Selecione um veículo..."}
                        </option>
                        {availableVehicles.map(v => <option key={v.id} value={v.id}>{v.placa} - {v.modelo}</option>)}
                      </select>
                    </div>
                    {availableVehicles.length === 0 && !editingContract && (
                      <p className="text-[10px] text-amber-500 font-bold flex items-center gap-1 mt-1">
                        <AlertTriangle size={12} /> Não há veículos ativos livres na frota.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Valor Semanal</label>
                      <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                        <input required type="number" step="0.01" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-zinc-100 focus:border-indigo-500 outline-none font-bold" value={formData.valor || ''} onChange={e => setFormData({...formData, valor: Number(e.target.value)})} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Início</label>
                      <div className="relative">
                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                        <input required type="date" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-zinc-100 focus:border-indigo-500 outline-none" value={formData.data_inicio || ''} onChange={e => setFormData({...formData, data_inicio: e.target.value})} />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Horário de Geração</label>
                      <input type="time" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:border-indigo-500 outline-none font-bold" value={formData.horario_faturamento} onChange={e => setFormData({...formData, horario_faturamento: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                       <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Expiração (Horas)</label>
                       <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:border-indigo-500 outline-none font-bold" value={formData.expiracao_horas} onChange={e => setFormData({...formData, expiracao_horas: Number(e.target.value)})} />
                    </div>
                  </div>

                  <div className="space-y-4 pt-2">
                    <label className="text-xs font-black text-zinc-500 uppercase tracking-widest block">Recorrência do Contrato</label>
                    
                    {!showCustomRecurrence ? (
                      <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl group hover:border-indigo-500/50 transition-all">
                        <div className="text-sm font-bold text-zinc-300">
                           {typeof formData.recorrencia === 'string' && !formData.recorrencia.startsWith('{') ? (
                             <span className="capitalize">{formData.recorrencia.replace('@', ' às ').replace('@', ' ')}</span>
                           ) : (
                             <span className="text-indigo-400">Recorrência personalizada configurada</span>
                           )}
                        </div>
                        <button 
                          type="button"
                          onClick={() => setShowCustomRecurrence(true)}
                          className="text-[10px] font-black text-white uppercase tracking-widest bg-indigo-600 px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
                        >
                          Alterar
                        </button>
                      </div>
                    ) : (
                      <div className="p-6 bg-zinc-950 border-2 border-indigo-500/30 rounded-3xl space-y-6 animate-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center justify-between">
                           <h4 className="text-xs font-black text-white uppercase tracking-widest">Recorrência Personalizada</h4>
                           <button type="button" onClick={() => setShowCustomRecurrence(false)} className="text-[10px] font-black text-emerald-500 uppercase bg-emerald-500/10 px-4 py-2 rounded-xl hover:bg-emerald-500/20 transition-all">Concluído</button>
                        </div>

                         <div className="space-y-3">
                            <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Ritmo da Cobrança (Intervalo)</p>
                            <div className="flex items-center gap-3">
                               <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 focus-within:border-indigo-500 transition-all">
                                  <span className="text-[10px] font-black text-zinc-600 uppercase">A cada</span>
                                  <input 
                                    type="number" 
                                    min="1" 
                                    className="w-16 bg-transparent text-white font-black outline-none" 
                                    value={formData.recorrencia_config?.intervalo || 1} 
                                     onChange={e => {
                                       const val = Number(e.target.value);
                                       setFormData(prev => {
                                         const config = prev.recorrencia_config;
                                         let termina = config.termina;
                                         if (termina?.tipo === 'ocorrencia') {
                                           const dias = config.dias?.length || 1;
                                           termina = { ...termina, valor: val * dias };
                                         }
                                         return { ...prev, recorrencia_config: { ...config, intervalo: val, termina } };
                                       });
                                     }} 
                                   />
                                  <select 
                                    className="flex-1 bg-transparent text-zinc-300 font-bold outline-none appearance-none" 
                                    value={formData.recorrencia_config?.frequencia || 'weekly'} 
                                    onChange={e => {
                                      const val = e.target.value;
                                      setFormData(prev => ({
                                        ...prev, 
                                        recorrencia_config: {
                                          ...prev.recorrencia_config, 
                                          frequencia: val
                                        }
                                      }));
                                    }}
                                  >
                                     <option value="daily">Dias</option>
                                     <option value="weekly">Semanas</option>
                                     <option value="monthly">Meses</option>
                                     <option value="yearly">Anos</option>
                                  </select>
                               </div>
                            </div>
                         </div>

                        {formData.recorrencia_config?.frequencia === 'weekly' && (
                          <div className="space-y-3">
                             <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Repetir às/aos</p>
                             <div className="flex justify-between items-center bg-zinc-900/50 p-2 rounded-2xl border border-zinc-800">
                                {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].map((day, idx) => {
                                  const label = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][idx];
                                  const isSelected = formData.recorrencia_config?.dias?.includes(day);
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      onClick={() => {
                                        const currentDays = formData.recorrencia_config?.dias || [];
                                        const newDays = isSelected 
                                          ? currentDays.filter(d => d !== day)
                                          : [...currentDays, day];
                                        
                                        setFormData(prev => {
                                          const config = prev.recorrencia_config;
                                          let termina = config.termina;
                                          // Recálculo DIRETO: intervalo × dias selecionados (sem proporcionalidade)
                                          if (termina?.tipo === 'ocorrencia') {
                                            const intervalo = config.intervalo || 1;
                                            termina = { ...termina, valor: intervalo * (newDays.length || 1) };
                                          }
                                          return {
                                            ...prev,
                                            recorrencia_config: { ...config, dias: newDays, termina }
                                          };
                                        });
                                      }}
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black transition-all ${
                                        isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 scale-110' : 'bg-transparent text-zinc-600 hover:text-zinc-400'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                             </div>
                          </div>
                        )}

                        <div className="space-y-4">
                           <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Termina</p>
                           <div className="space-y-4">
                              <label className="flex items-center gap-4 cursor-pointer group">
                                 <input type="radio" className="hidden" checked={formData.recorrencia_config?.termina?.tipo === 'nunca'} onChange={() => setFormData({...formData, recorrencia_config: {...formData.recorrencia_config, termina: {tipo: 'nunca', valor: null}}})} />
                                 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${formData.recorrencia_config?.termina?.tipo === 'nunca' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-950'}`}>
                                    {formData.recorrencia_config?.termina?.tipo === 'nunca' && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-in zoom-in duration-200" />}
                                 </div>
                                 <span className="text-xs font-bold text-zinc-400 group-hover:text-zinc-200 transition-colors">Nunca</span>
                              </label>

                              <label className="flex items-center gap-4 cursor-pointer group">
                                 <input type="radio" className="hidden" checked={formData.recorrencia_config?.termina?.tipo === 'data'} onChange={() => setFormData({...formData, recorrencia_config: {...formData.recorrencia_config, termina: {tipo: 'data', valor: ''}}})} />
                                 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${formData.recorrencia_config?.termina?.tipo === 'data' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-950'}`}>
                                    {formData.recorrencia_config?.termina?.tipo === 'data' && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-in zoom-in duration-200" />}
                                 </div>
                                 <span className="text-xs font-bold text-zinc-400 group-hover:text-zinc-200 min-w-[20px]">Em</span>
                                 <input type="date" disabled={formData.recorrencia_config?.termina?.tipo !== 'data'} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 outline-none text-[10px] font-black disabled:opacity-30 focus:border-indigo-500 transition-all text-white" value={formData.recorrencia_config?.termina?.tipo === 'data' ? formData.recorrencia_config?.termina?.valor || '' : ''} onChange={e => setFormData({...formData, recorrencia_config: {...formData.recorrencia_config, termina: {tipo: 'data', valor: e.target.value}}})} />
                              </label>

                              <label className="flex items-center gap-4 cursor-pointer group">
                                 <input type="radio" className="hidden" checked={formData.recorrencia_config?.termina?.tipo === 'ocorrencia'} onChange={() => {
                                   const dias = formData.recorrencia_config?.dias?.length || 1;
                                   const intervalo = formData.recorrencia_config?.intervalo || 1;
                                   setFormData({...formData, recorrencia_config: {...formData.recorrencia_config, termina: {tipo: 'ocorrencia', valor: dias * intervalo}}});
                                 }} />
                                 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${formData.recorrencia_config?.termina?.tipo === 'ocorrencia' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-950'}`}>
                                    {formData.recorrencia_config?.termina?.tipo === 'ocorrencia' && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-in zoom-in duration-200" />}
                                 </div>
                                 <span className="text-xs font-bold text-zinc-400 group-hover:text-zinc-200 transition-colors">Após</span>
                                 <div className="flex items-center gap-2">
                                    <input type="number" disabled={formData.recorrencia_config?.termina?.tipo !== 'ocorrencia'} className="w-16 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 outline-none text-[10px] font-black disabled:opacity-30 focus:border-indigo-500 text-white" value={formData.recorrencia_config?.termina?.tipo === 'ocorrencia' ? formData.recorrencia_config?.termina?.valor : ''} onChange={e => setFormData({...formData, recorrencia_config: {...formData.recorrencia_config, termina: {tipo: 'ocorrencia', valor: Number(e.target.value)}}})} />
                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-tighter">ocorrências</span>
                                 </div>
                              </label>

                              {/* Helper de Automação Requisitado */}
                              {formData.recorrencia_config?.termina?.tipo === 'ocorrencia' && (
                                <div className="ml-9 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800 space-y-2">
                                   <p className="text-[9px] text-zinc-500 font-black uppercase">Sugestão por Duração</p>
                                   <div className="flex gap-2">
                                      {[4, 8, 12, 24, 48].map(weeks => (
                                        <button 
                                          key={weeks}
                                          type="button"
                                          onClick={() => {
                                            const daysPerWeek = formData.recorrencia_config?.dias?.length || 1;
                                            const total = (weeks / (formData.recorrencia_config?.intervalo || 1)) * daysPerWeek;
                                            setFormData(prev => ({
                                              ...prev,
                                              recorrencia_config: {
                                                ...prev.recorrencia_config,
                                                termina: { ...prev.recorrencia_config.termina, valor: Math.ceil(total) }
                                              }
                                            }));
                                          }}
                                          className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-[9px] font-bold text-zinc-300 rounded-lg transition-colors"
                                        >
                                          {weeks} sem.
                                        </button>
                                      ))}
                                   </div>
                                </div>
                              )}
                           </div>
                        </div>

                        {/* RESUMO DA PREVISÃO */}
                        {contractSummary && (
                          <div className="p-5 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl space-y-3 animate-in fade-in zoom-in duration-300">
                             <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                <CheckCircle2 size={14} /> Resumo Financeiro Estimado
                             </h5>
                             <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-0.5">
                                   <p className="text-[8px] text-zinc-500 font-black uppercase">Total de Cobranças</p>
                                   <p className="text-white font-black text-lg">{contractSummary.totalCharges}</p>
                                </div>
                                <div className="space-y-0.5">
                                   <p className="text-[8px] text-zinc-500 font-black uppercase">Valor Total do Contrato</p>
                                   <p className="text-emerald-400 font-black text-lg">R$ {contractSummary.totalValue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-indigo-500/10 pt-2">
                                   <p className="text-[8px] text-zinc-500 font-black uppercase">Término Estimado</p>
                                   <p className="text-zinc-300 font-bold text-sm">
                                      {contractSummary.estimatedEndDate?.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                                   </p>
                                </div>
                             </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
               </div>

               <div className="pt-8 flex justify-end gap-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-3 rounded-xl text-zinc-500 hover:text-white font-bold transition-all">Cancelar</button>
                <button type="submit" className="px-10 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-xl shadow-xl shadow-indigo-600/30 active:scale-95 transition-all">Confirmar Contrato</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Contratos;