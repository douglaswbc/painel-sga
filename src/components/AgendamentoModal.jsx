import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { toast } from 'react-toastify';
import { X, Search, Clock, CalendarClock, Loader2, Trash2, CheckCircle2, UserCheck } from 'lucide-react';

const AgendamentoModal = ({ isOpen, onClose, template, locatario: initialLocatario, usuario, mode = 'template' }) => {
  const [locatarios, setLocatarios] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocatario, setSelectedLocatario] = useState(initialLocatario || null);
  const [selectedTemplates, setSelectedTemplates] = useState([]);
  const [contratosMap, setContratosMap] = useState({});
  
  const [frequencia, setFrequencia] = useState('semanal');
  const [frequenciaDias, setFrequenciaDias] = useState('');
  const [proximoEnvio, setProximoEnvio] = useState('');
  const [horario, setHorario] = useState('09:00');
  const [selecionarTodos, setSelecionarTodos] = useState(false);
  
  const [agendamentos, setAgendamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && usuario?.id) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setProximoEnvio(tomorrow.toISOString().split('T')[0]);
      
      fetchData();
    }
  }, [isOpen, usuario, template, initialLocatario]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Carregar Locatários
      const { data: locData, error: locError } = await supabase
        .from('locatarios')
        .select('id, nome_completo, whatsapp')
        .eq('id_usuario', usuario.id)
        .eq('ativo', true)
        .order('nome_completo');
      if (locError) throw locError;
      setLocatarios(locData || []);

      // Carregar Templates (se for modo locatário)
      if (mode === 'locatario') {
        const { data: tmplData, error: tmplError } = await supabase
          .from('mensagens_template')
          .select('*')
          .eq('id_usuario', usuario.id)
          .eq('tipo', 'avulso')
          .order('titulo');
        if (tmplError) throw tmplError;
        setTemplates(tmplData || []);
      }

      // 🔥 Buscar contratos ativos
      const { data: contratosData, error: contratosError } = await supabase
        .from('contratos')
        .select('id, id_locatario')
        .eq('id_usuario', usuario.id)
        .eq('status', 'ativo');

      if (contratosError) throw contratosError;

      // 🔥 Mapear por locatário
      const map = {};
      (contratosData || []).forEach(c => {
        map[c.id_locatario] = c;
      });
      setContratosMap(map);

      // Carregar Agendamentos Atuais
      let query = supabase
        .from('agendamentos_mensagens')
        .select(`
          id, frequencia, proximo_envio, ativo, horario_envio,
          locatarios (nome_completo, whatsapp),
          mensagens_template (titulo)
        `)
        .order('proximo_envio');
      
      if (mode === 'template' && template?.id) {
        query = query.eq('id_template', template.id);
      } else if (mode === 'locatario' && selectedLocatario?.id) {
        query = query.eq('id_locatario', selectedLocatario.id);
      } else {
        // Se não tem contexto, não carrega agendamentos
        setAgendamentos([]);
        setLoading(false);
        return;
      }

      const { data: agData, error: agError } = await query;
      if (agError) throw agError;
      setAgendamentos(agData || []);
    } catch (err) {
      toast.error('Erro ao carregar dados do agendamento.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!proximoEnvio || !frequencia || (frequencia === 'personalizado' && !frequenciaDias)) {
      return toast.error('Preencha os campos obrigatórios.');
    }

    if (mode === 'template') {
      if (!selecionarTodos && !selectedLocatario) {
        return toast.error('Selecione um cliente.');
      }
    } else {
      if (selectedTemplates.length === 0) {
        return toast.error('Selecione ao menos um modelo.');
      }
      if (!selectedLocatario) {
        return toast.error('Erro: Locatário não identificado.');
      }
    }
    
    try {
      setSaving(true);
      
      const freqNum = frequencia === 'personalizado' ? parseInt(frequenciaDias, 10) : null;
      let payloads = [];

      if (mode === 'template') {
        const targets = selecionarTodos ? locatarios : [selectedLocatario];
        payloads = targets.map(t => {
          const contrato = contratosMap[t.id];
          if (!contrato) return null;
          return {
            id_usuario: usuario.id,
            id_template: template.id,
            id_locatario: t.id,
            id_contrato: contrato.id,
            frequencia,
            frequencia_dias: freqNum,
            proximo_envio: proximoEnvio,
            horario_envio: horario + ':00',
            ativo: true
          };
        }).filter(Boolean);
      } else {
        const contrato = contratosMap[selectedLocatario.id];
        if (!contrato) throw new Error("Este locatário não possui contrato ativo.");
        
        payloads = selectedTemplates.map(tmpl => ({
          id_usuario: usuario.id,
          id_template: tmpl.id,
          id_locatario: selectedLocatario.id,
          id_contrato: contrato.id,
          frequencia,
          frequencia_dias: freqNum,
          proximo_envio: proximoEnvio,
          horario_envio: horario + ':00',
          ativo: true
        }));
      }
      
      if (payloads.length === 0) return toast.error('Nenhum agendamento pôde ser criado (verifique contratos).');

      const { error } = await supabase.from('agendamentos_mensagens').insert(payloads);
      if (error) throw error;
      
      toast.success(`${payloads.length} agendamento(s) criado(s)!`);
      if (mode === 'template') {
        setSelectedLocatario(null);
        setSelecionarTodos(false);
      } else {
        setSelectedTemplates([]);
      }
      setFrequenciaDias('');
      fetchData();
    } catch (error) {
      toast.error('Erro ao criar agendamento: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleTemplateSelection = (tmpl) => {
    setSelectedTemplates(prev => 
      prev.find(t => t.id === tmpl.id) 
        ? prev.filter(t => t.id !== tmpl.id) 
        : [...prev, tmpl]
    );
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este agendamento?')) return;
    try {
      const { error } = await supabase.from('agendamentos_mensagens').delete().eq('id', id);
      if (error) throw error;
      toast.success('Removido com sucesso.');
      fetchData();
    } catch (error) {
      toast.error('Erro ao remover.');
    }
  };

  const filteredItems = mode === 'template' 
    ? locatarios.filter(l => l.nome_completo.toLowerCase().includes(searchTerm.toLowerCase()))
    : templates.filter(t => t.titulo.toLowerCase().includes(searchTerm.toLowerCase()));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col md:flex-row md:items-center justify-start md:justify-center p-4 py-8 md:p-8 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300 gap-6 overflow-y-auto">
      
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl flex flex-col shrink-0 h-[650px] md:h-[85vh] mx-auto">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-xl"><CalendarClock size={20} className="text-indigo-500" /></div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-tight">
                {mode === 'template' ? 'Novo Agendamento' : 'Configurar Cliente'}
              </h3>
              <p className="text-[10px] text-zinc-500 uppercase">
                {mode === 'template' ? `Template: ${template?.titulo}` : `Cliente: ${selectedLocatario?.nome_completo}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 md:hidden hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-5">
           <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Frequência</label>
                <div className="flex gap-2">
                  <select className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500" value={frequencia} onChange={e => setFrequencia(e.target.value)}>
                     <option value="diario">Diária</option>
                     <option value="semanal">Semanal</option>
                     <option value="quinzenal">Quinzenal</option>
                     <option value="mensal">Mensal</option>
                     <option value="personalizado">Personalizado</option>
                  </select>
                  {frequencia === 'personalizado' && (
                    <input type="number" placeholder="Dias" className="w-16 bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-center text-xs text-white outline-none focus:border-indigo-500" value={frequenciaDias} onChange={e => setFrequenciaDias(e.target.value)} />
                  )}
                </div>
             </div>
             <div className="space-y-2">
                <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Primeiro Envio</label>
                <div className="flex gap-2">
                  <input type="date" className="flex-[2] bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500" value={proximoEnvio} onChange={e => setProximoEnvio(e.target.value)} />
                  <input type="time" className="flex-[1] bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-center text-xs text-white outline-none focus:border-indigo-500" value={horario} onChange={e => setHorario(e.target.value)} />
                </div>
             </div>
           </div>

           <div className="space-y-3">
             <div className="flex items-center justify-between">
               <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">
                 {mode === 'template' ? 'Selecionar Cliente' : 'Selecionar Modelos'}
               </label>
               {mode === 'template' && (
                 <label className="flex items-center gap-2 cursor-pointer">
                   <input type="checkbox" checked={selecionarTodos} onChange={e => setSelecionarTodos(e.target.checked)} className="accent-indigo-500" />
                   <span className="text-[10px] font-bold text-zinc-400">Todos ({locatarios.length})</span>
                 </label>
               )}
             </div>
             
             {!(mode === 'template' && selecionarTodos) ? (
               <>
                 <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                    <input type="text" placeholder="Buscar..." className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-indigo-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                 </div>
                 
                 <div className="flex-1 min-h-[150px] overflow-y-auto space-y-2 pr-1">
                    {filteredItems.map(item => {
                      const isSelected = mode === 'template' 
                        ? selectedLocatario?.id === item.id 
                        : selectedTemplates.find(t => t.id === item.id);
                        
                      return (
                        <button 
                          key={item.id} 
                          onClick={() => mode === 'template' ? setSelectedLocatario(item) : toggleTemplateSelection(item)} 
                          className={`w-full text-left p-3 rounded-xl transition-all border ${isSelected ? 'bg-indigo-600/10 border-indigo-500/50' : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'}`}
                        >
                          <div className="flex justify-between items-center">
                             <div className="min-w-0 flex-1">
                               <p className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-400' : 'text-zinc-300'}`}>
                                 {mode === 'template' ? item.nome_completo : item.titulo}
                               </p>
                               <p className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                                 {mode === 'template' ? item.whatsapp : (item.conteudo?.substring(0, 40) + '...')}
                               </p>
                             </div>
                             {isSelected && <CheckCircle2 size={16} className="text-indigo-500 shrink-0 ml-2" />}
                          </div>
                        </button>
                      );
                    })}
                 </div>
               </>
             ) : (
               <div className="flex-1 min-h-[150px] bg-indigo-500/5 border border-indigo-500/20 rounded-2xl flex flex-col items-center justify-center p-4 md:p-6 text-center animate-in fade-in zoom-in-95 duration-300">
                 <UserCheck className="text-indigo-500 mb-3" size={32} />
                 <h4 className="text-sm font-black text-white">Todos Selecionados</h4>
                 <p className="text-[10px] text-zinc-400 mt-2 leading-relaxed">
                   Serão gerados {locatarios.length} agendamentos individuais.<br/>Um para cada locatário ativo.
                 </p>
               </div>
             )}
           </div>
        </div>

        <div className="p-5 border-t border-zinc-800">
           <button 
             disabled={saving || (mode === 'template' && !selecionarTodos && !selectedLocatario) || (mode === 'locatario' && selectedTemplates.length === 0)} 
             onClick={handleSave} 
             className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
           >
             {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} 
             {mode === 'template' ? 'Criar Recorrência' : `Vincular ${selectedTemplates.length} Modelo(s)`}
           </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl flex flex-col shrink-0 h-[500px] md:h-[85vh] mx-auto">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
           <div className="flex items-center gap-2">
             <Clock size={18} className="text-emerald-500" />
             <h3 className="text-sm font-black text-white uppercase tracking-tight">
               {mode === 'template' ? 'Ativos neste Template' : 'Ativos para este Cliente'}
             </h3>
           </div>
           <button onClick={onClose} className="text-zinc-500 hidden md:block hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="p-5 flex-1 overflow-y-auto">
           {loading ? (
             <div className="flex flex-col items-center justify-center h-full"><Loader2 className="animate-spin text-zinc-500" size={32} /></div>
           ) : agendamentos.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest">Nenhuma recorrência ativa</p>
             </div>
           ) : (
             <div className="space-y-3">
               {agendamentos.map(ag => (
                 <div key={ag.id} className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center justify-between group hover:border-zinc-700 transition-all">
                    <div className="min-w-0 flex-1 mr-2">
                      <p className="text-xs font-bold text-zinc-200 uppercase truncate">
                        {mode === 'template' ? ag.locatarios.nome_completo : ag.mensagens_template?.titulo}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-full font-black uppercase tracking-widest">{ag.frequencia}</span>
                        <span className="text-[9px] bg-zinc-800 text-zinc-400 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest">
                          Prox: {ag.proximo_envio.split('-').reverse().join('/')} {ag.horario_envio ? `às ${ag.horario_envio.substring(0, 5)}` : ''}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(ag.id)} className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-all shrink-0"><Trash2 size={16}/></button>
                 </div>
               ))}
             </div>
           )}
        </div>
      </div>

    </div>
  );
};
export default AgendamentoModal;
