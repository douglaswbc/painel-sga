import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { toast } from 'react-toastify';
import { X, Search, Clock, CalendarClock, Loader2, Trash2, CheckCircle2, UserCheck } from 'lucide-react';

const AgendamentoModal = ({ isOpen, onClose, template, usuario }) => {
  const [locatarios, setLocatarios] = useState([]);
  const [contratosMap, setContratosMap] = useState({}); // 🔥 NOVO
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocatario, setSelectedLocatario] = useState(null);
  
  const [frequencia, setFrequencia] = useState('semanal');
  const [frequenciaDias, setFrequenciaDias] = useState('');
  const [proximoEnvio, setProximoEnvio] = useState('');
  const [horario, setHorario] = useState('09:00');
  const [selecionarTodos, setSelecionarTodos] = useState(false);
  
  const [agendamentos, setAgendamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && usuario?.id && template?.id) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setProximoEnvio(tomorrow.toISOString().split('T')[0]);
      
      fetchData();
    }
  }, [isOpen, usuario, template]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // 🔹 Locatários
      const { data: locData, error: locError } = await supabase
        .from('locatarios')
        .select('id, nome_completo, whatsapp')
        .eq('id_usuario', usuario.id)
        .eq('ativo', true)
        .order('nome_completo');

      if (locError) throw locError;
      setLocatarios(locData || []);

      // 🔥 Contratos ativos
      const { data: contratosData, error: contratosError } = await supabase
        .from('contratos')
        .select('id, id_locatario')
        .eq('id_usuario', usuario.id)
        .eq('status', 'ativo');

      if (contratosError) throw contratosError;

      // 🔥 Mapear contrato por locatário
      const map = {};
      (contratosData || []).forEach(c => {
        map[c.id_locatario] = c;
      });
      setContratosMap(map);

      // 🔹 Agendamentos existentes
      const { data: agData, error: agError } = await supabase
        .from('agendamentos_mensagens')
        .select(`
          id, frequencia, proximo_envio, ativo,
          locatarios (nome_completo, whatsapp)
        `)
        .eq('id_template', template.id)
        .order('proximo_envio');

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

    if (!selecionarTodos && !selectedLocatario) {
      return toast.error('Selecione um cliente.');
    }
    
    try {
      setSaving(true);
      
      const targets = selecionarTodos ? locatarios : [selectedLocatario];
      if (targets.length === 0) return toast.error('Nenhum locatário disponível.');
      
      const freqNum = frequencia === 'personalizado' ? parseInt(frequenciaDias, 10) : null;
      
      const payloads = targets.map(t => {
        const contrato = contratosMap[t.id];

        // 🔥 Segurança: não deixa salvar sem contrato
        if (!contrato) {
          console.warn(`Locatário ${t.nome_completo} sem contrato ativo`);
          return null;
        }

        return {
          id_usuario: usuario.id,
          id_template: template.id,
          id_locatario: t.id,
          id_contrato: contrato.id, // 🔥 ESSENCIAL
          frequencia,
          frequencia_dias: freqNum,
          proximo_envio: proximoEnvio,
          horario_envio: horario + ':00',
          ativo: true
        };
      }).filter(Boolean);

      if (payloads.length === 0) {
        return toast.error('Nenhum locatário possui contrato ativo.');
      }

      const { error } = await supabase
        .from('agendamentos_mensagens')
        .insert(payloads);

      if (error) throw error;
      
      toast.success(`${payloads.length} agendamento(s) criado(s)!`);
      setSelectedLocatario(null);
      setSelecionarTodos(false);
      setFrequenciaDias('');
      fetchData();

    } catch (error) {
      toast.error('Erro ao criar agendamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este agendamento?')) return;
    try {
      const { error } = await supabase
        .from('agendamentos_mensagens')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Removido com sucesso.');
      fetchData();
    } catch (error) {
      toast.error('Erro ao remover.');
    }
  };

  const filteredLocatarios = locatarios.filter(l =>
    l.nome_completo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md p-6 space-y-4">

        <div className="flex justify-between items-center">
          <h3 className="text-white font-bold">Novo Agendamento</h3>
          <button onClick={onClose}><X /></button>
        </div>

        <input
          type="text"
          placeholder="Buscar cliente..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full p-2 bg-zinc-800 text-white rounded"
        />

        <div className="max-h-40 overflow-y-auto space-y-2">
          {filteredLocatarios.map(loc => {
            const hasContrato = !!contratosMap[loc.id];

            return (
              <button
                key={loc.id}
                onClick={() => setSelectedLocatario(loc)}
                className={`w-full text-left p-2 rounded ${
                  selectedLocatario?.id === loc.id ? 'bg-indigo-600' : 'bg-zinc-800'
                }`}
              >
                <div className="flex justify-between">
                  <span>{loc.nome_completo}</span>
                  {!hasContrato && (
                    <span className="text-red-400 text-xs">Sem contrato</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-indigo-600 p-3 rounded text-white"
        >
          {saving ? <Loader2 className="animate-spin" /> : 'Criar Agendamento'}
        </button>

      </div>
    </div>
  );
};

export default AgendamentoModal;