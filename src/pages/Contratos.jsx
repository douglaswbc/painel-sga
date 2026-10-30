import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, User, Car, DollarSign, Calendar } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useContracts } from '../hooks/useContracts';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { Input, Select } from '../components/ui/Input';
import { Table, Thead, Tbody, Th, Td, LoadingRow } from '../components/ui/Table';
import { StatusBadge } from '../components/ui/StatusBadge';
import { SectionHeader } from '../components/ui/SectionHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { getRecurrenceLabel, RecurrenceConfig, ContractSummary, contractSummary } from '../components/RecurrenceConfig';
import { toast } from 'react-toastify';

const formatDate = (date) => {
  if (!date) return '-';
  const d = date + (date.includes('T') ? '' : 'T00:00:00');
  return new Date(d).toLocaleDateString('pt-BR');
};

const defaultForm = {
  recorrencia: 'weekly@mon@20:00',
  status: 'ativo',
  valor: '',
  data_inicio: '',
  id_locatario: '',
  id_veiculo: '',
  horario_geracao: '19:50',
  horario_cobranca: '20:00',
  intervalo_lembrete_minutos: 30,
  expiracao_horas: 4,
  recorrencia_config: { frequencia: 'weekly', intervalo: 1, dias: ['mon'], termina: { tipo: 'nunca', valor: null } },
};

const Contratos = () => {
  const { profile } = useAuth();
  const { contracts, locatarios, veiculos, loading, save: saveContract, toggleStatus, remove } = useContracts(profile?.id);
  const [showModal, setShowModal] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [formData, setFormData] = useState(defaultForm);
  const [showCustomRecurrence, setShowCustomRecurrence] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('recentes');

  const availableVehicles = useMemo(() => {
    const occupiedIds = contracts
      .filter(c => c.status === 'ativo' && (!editingContract || c.id !== editingContract.id))
      .map(c => c.id_veiculo);
    return veiculos
      .filter(v => !occupiedIds.includes(v.id))
      .sort((a, b) => (a.placa || '').localeCompare(b.placa || '', 'pt-BR'));
  }, [veiculos, contracts, editingContract]);

  const sortedLocatarios = useMemo(() => {
    return [...locatarios].sort((a, b) => (a.nome_completo || '').localeCompare(b.nome_completo || '', 'pt-BR'));
  }, [locatarios]);

  const summary = useMemo(() => contractSummary(formData), [formData]);

  const openNew = () => {
    setEditingContract(null);
    setFormData({ ...defaultForm, recorrencia_config: { ...defaultForm.recorrencia_config } });
    setShowCustomRecurrence(false);
    setShowModal(true);
  };

  const openEdit = (item) => {
    const scheduledTime = item.proxima_cobranca
      ? new Date(item.proxima_cobranca).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
      : '19:50';
    let dataToSet = {
      ...item,
      horario_geracao: scheduledTime,
      horario_cobranca: scheduledTime,
      intervalo_lembrete_minutos: 30,
      expiracao_horas: 4,
      recorrencia_config: { frequencia: 'weekly', intervalo: 1, dias: ['mon'], termina: { tipo: 'nunca', valor: null } },
    };
    let isCustom = false;
    if (item.recorrencia?.startsWith('{')) {
      try {
        const config = JSON.parse(item.recorrencia);
        dataToSet.recorrencia_config = config;
        const legacyTime = config.horario || '20:00';
        dataToSet.horario_geracao = config.horario_geracao || legacyTime;
        dataToSet.horario_cobranca = config.horario_cobranca || legacyTime;
        dataToSet.intervalo_lembrete_minutos = config.intervalo_lembrete_minutos || 30;
        dataToSet.expiracao_horas = config.expiracao || 4;
        isCustom = true;
      } catch {}
    } else if (typeof item.recorrencia === 'string') {
      const legacyMatch = item.recorrencia.match(/@([a-z]{3})@([0-2]\d:[0-5]\d)$/i);
      if (legacyMatch) {
        dataToSet.horario_geracao = legacyMatch[2];
        dataToSet.horario_cobranca = legacyMatch[2];
      }
    }
    setEditingContract(item);
    setFormData(dataToSet);
    setShowCustomRecurrence(isCustom);
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      let proximaCobrancaISO;
      if (editingContract && formData.proxima_cobranca) {
        const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(formData.proxima_cobranca));
        proximaCobrancaISO = new Date(`${localDate}T${formData.horario_geracao || '19:50'}:00-03:00`).toISOString();
      } else {
        const horario = formData.horario_geracao || '19:50';
        let dataCalculada = new Date(`${formData.data_inicio}T${horario}:00`);
        if (showCustomRecurrence && formData.recorrencia_config.frequencia === 'weekly') {
          const dayMapIndex = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
          const selectedDayIndices = formData.recorrencia_config.dias.map(d => dayMapIndex[d.toLowerCase()]);
          for (let i = 0; i < 7; i++) {
            if (selectedDayIndices.includes(dataCalculada.getDay())) break;
            dataCalculada.setDate(dataCalculada.getDate() + 1);
          }
        }
        proximaCobrancaISO = dataCalculada.toISOString();
      }

      const legacyRecurrence = String(formData.recorrencia || 'semanal').toLowerCase();
      const legacyDayCode = legacyRecurrence.match(/@([a-z]{3})@/)?.[1] || 'mon';
      const legacyDay = ({ sun: 'dom', mon: 'seg', tue: 'ter', wed: 'qua', thu: 'qui', fri: 'sex', sat: 'sab' })[legacyDayCode] || legacyDayCode;
      const legacyConfig = {
        frequencia: legacyRecurrence.includes('diari') || legacyRecurrence.includes('daily') ? 'daily'
          : legacyRecurrence.includes('anual') || legacyRecurrence.includes('yearly') ? 'yearly'
            : legacyRecurrence.includes('mensal') || legacyRecurrence.includes('monthly') ? 'monthly' : 'weekly',
        intervalo: legacyRecurrence.includes('quinzenal') || legacyRecurrence.includes('biweekly') ? 2 : 1,
        dias: [legacyDay], termina: { tipo: 'nunca', valor: null },
      };
      const recurrenceBase = showCustomRecurrence ? formData.recorrencia_config : legacyConfig;
      const recorrenciaFinal = JSON.stringify({
        ...recurrenceBase,
        horario_geracao: formData.horario_geracao || '19:50',
        horario_cobranca: formData.horario_cobranca || '20:00',
        intervalo_lembrete_minutos: Math.min(240, Math.max(5, Number(formData.intervalo_lembrete_minutos) || 30)),
        expiracao: Math.min(24, Math.max(1, Number(formData.expiracao_horas) || 4)),
      });

      const payload = {
        recorrencia: recorrenciaFinal,
        status: formData.status || 'ativo',
        valor: formData.valor,
        data_inicio: formData.data_inicio,
        id_locatario: formData.id_locatario,
        id_veiculo: formData.id_veiculo,
        id_usuario: profile.id,
        proxima_cobranca: proximaCobrancaISO,
      };

      await saveContract(payload, editingContract?.id);
      setShowModal(false);
    } catch (err) {
      toast.error(err.code === '23505' ? 'Este veículo já possui um contrato ativo!' : err.message);
    }
  };

  const handleDelete = (id) => {
    if (!confirm('Deseja excluir este contrato? As cobranças vinculadas podem ser afetadas.')) return;
    remove(id);
  };

  const filtered = useMemo(() => {
    const list = contracts.filter(c =>
      (c.locatarios?.nome_completo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.veiculos?.placa || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return list.sort((a, b) => {
      if (sortOrder === 'locatario_asc') {
        return (a.locatarios?.nome_completo || '').localeCompare(b.locatarios?.nome_completo || '', 'pt-BR');
      }
      if (sortOrder === 'locatario_desc') {
        return (b.locatarios?.nome_completo || '').localeCompare(a.locatarios?.nome_completo || '', 'pt-BR');
      }
      if (sortOrder === 'veiculo_asc') {
        return (a.veiculos?.placa || '').localeCompare(b.veiculos?.placa || '', 'pt-BR');
      }
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [contracts, searchTerm, sortOrder]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Gestão de Contratos"
        description="Controle de frotas e recorrências."
        actions={
          <Button icon={Plus} onClick={openNew}>Novo Contrato</Button>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Buscar por locatário ou placa..."
          className="max-w-sm"
        />

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs sm:text-sm text-[#1d1d1f] outline-none cursor-pointer focus:border-[#0066cc]"
          aria-label="Ordenar contratos"
        >
          <option value="recentes">Mais recentes</option>
          <option value="locatario_asc">Locatário (A-Z)</option>
          <option value="locatario_desc">Locatário (Z-A)</option>
          <option value="veiculo_asc">Veículo / Placa (A-Z)</option>
        </select>
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Locatário / Veículo</Th>
            <Th>Valor</Th>
            <Th>Próximo Envio</Th>
            <Th>Recorrência</Th>
            <Th className="text-center">Status</Th>
            <Th className="text-right">Ações</Th>
          </tr>
        </Thead>
        <Tbody>
          {loading ? <LoadingRow colSpan={6} /> : filtered.map(item => (
            <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors">
              <Td>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-zinc-100 font-bold">
                    <User size={14} className="text-indigo-400" /> {item.locatarios?.nome_completo}
                  </div>
                  <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium">
                    <Car size={14} className="text-zinc-600" />
                    {item.veiculos?.modelo} • <span className="text-indigo-500 font-mono font-bold">{item.veiculos?.placa}</span>
                  </div>
                </div>
              </Td>
              <Td>
                <span className="text-emerald-400 font-black">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</span>
              </Td>
              <Td>
                <span className="text-indigo-400 font-black text-xs font-mono">{formatDate(item.proxima_cobranca)}</span>
              </Td>
              <Td>
                <span className="text-zinc-300 text-xs capitalize font-semibold">{getRecurrenceLabel(item.recorrencia)}</span>
              </Td>
              <Td className="text-center">
                <button onClick={() => toggleStatus(item)}>
                  <StatusBadge status={item.status}>{item.status}</StatusBadge>
                </button>
              </Td>
              <Td className="text-right space-x-1">
                <button onClick={() => openEdit(item)} className="p-2.5 text-zinc-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all">
                  <Pencil size={18} />
                </button>
                <button onClick={() => handleDelete(item.id)} className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all">
                  <Trash2 size={18} />
                </button>
              </Td>
            </tr>
          ))}
        </Tbody>
      </Table>

      <div className="md:hidden space-y-4">
        {loading ? (
          <div className="p-10 text-center"><div className="animate-spin mx-auto text-indigo-500 w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" /></div>
        ) : filtered.map(item => (
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
              <button onClick={() => toggleStatus(item)}>
                <StatusBadge status={item.status}>{item.status}</StatusBadge>
              </button>
            </div>
            <div className="flex items-end justify-between border-y border-zinc-800/50 py-3">
              <div className="space-y-0.5">
                <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">Valor</p>
                <p className="text-emerald-400 font-black text-xl">R$ {Number(item.valor).toFixed(2).replace('.', ',')}</p>
              </div>
              <div className="text-right space-y-0.5">
                <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">Próximo Envio</p>
                <p className="text-indigo-400 font-black text-sm font-mono">{formatDate(item.proxima_cobranca)}</p>
              </div>
            </div>
            <div className="flex items-end justify-between py-1">
              <div></div>
              <div className="text-right space-y-0.5">
                <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">Recorrência</p>
                <p className="text-zinc-300 font-bold text-[10px]">{getRecurrenceLabel(item.recorrencia)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" icon={Pencil} size="md" onClick={() => openEdit(item)} className="flex-1">Editar</Button>
              <Button variant="danger" icon={Trash2} size="md" onClick={() => handleDelete(item.id)} />
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingContract ? 'Editar Contrato' : 'Assinar Novo Contrato'}
        badge={editingContract && (
          <span className="px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-lg text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">Editando</span>
        )}
      >
        <form onSubmit={handleSave}>
          <ModalBody>
            <div>
              <SectionHeader className="mb-4">Partes do Contrato</SectionHeader>
              <div className="space-y-4">
                <Select icon={User} label="Locatário (Cliente)" value={formData.id_locatario || ''}
                  onChange={e => setFormData({...formData, id_locatario: e.target.value})}>
                  <option value="">Selecione um locatário...</option>
                  {sortedLocatarios.map(l => <option key={l.id} value={l.id}>{l.nome_completo}</option>)}
                </Select>
                <Select icon={Car} label="Veículo" value={formData.id_veiculo || ''}
                  onChange={e => setFormData({...formData, id_veiculo: e.target.value})}
                  disabled={availableVehicles.length === 0 && !editingContract}>
                  <option value="">
                    {availableVehicles.length === 0 && !editingContract ? "Nenhum veículo livre no momento" : "Selecione um veículo..."}
                  </option>
                  {availableVehicles.map(v => <option key={v.id} value={v.id}>{v.placa} - {v.modelo}</option>)}
                </Select>
              </div>
            </div>

            <div>
              <SectionHeader className="mb-4">Valor e Vigência</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Input icon={DollarSign} label="Valor do Contrato" type="number" step="0.01" required
                  value={formData.valor || ''} onChange={e => setFormData({...formData, valor: Number(e.target.value)})} />
                {editingContract ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-1">
                      <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Data de Início</label>
                      <p className="text-sm font-bold text-zinc-300">{formData.data_inicio ? new Date(formData.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</p>
                    </div>
                    <Input icon={Calendar} label="Próxima Cobrança" type="date"
                      value={formData.proxima_cobranca ? new Date(formData.proxima_cobranca + (formData.proxima_cobranca.includes('T') ? '' : 'T00:00:00')).toISOString().split('T')[0] : ''}
                      onChange={e => {
                        const newDate = e.target.value;
                        const horario = formData.horario_geracao || '19:50';
                        setFormData({...formData, proxima_cobranca: new Date(`${newDate}T${horario}:00`).toISOString()});
                      }}
                    />
                  </div>
                ) : (
                  <Input icon={Calendar} label="Início" type="date" required
                    value={formData.data_inicio || ''} onChange={e => setFormData({...formData, data_inicio: e.target.value})} />
                )}
              </div>
            </div>

            <div>
              <SectionHeader className="mb-4">Configuração de Cobrança</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Input label="Horário de Geração" type="time"
                  value={formData.horario_geracao} onChange={e => setFormData({...formData, horario_geracao: e.target.value})} />
                <Input label="Horário de Cobrança" type="time"
                  value={formData.horario_cobranca} onChange={e => setFormData({...formData, horario_cobranca: e.target.value})} />
                <Input label="Intervalo entre Lembretes (minutos)" type="number" min="5" max="240" step="5"
                  value={formData.intervalo_lembrete_minutos} onChange={e => setFormData({...formData, intervalo_lembrete_minutos: Number(e.target.value)})} />
                <Input label="Expiração do PIX (Horas)" type="number" min="1" max="24"
                  value={formData.expiracao_horas} onChange={e => setFormData({...formData, expiracao_horas: Number(e.target.value)})} />
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <label className="text-xs font-black text-zinc-500 uppercase tracking-widest block">Recorrência do Contrato</label>
              {!showCustomRecurrence ? (
                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl group hover:border-indigo-500/50 transition-all">
                  <div className="text-sm font-bold text-zinc-300">
                    {typeof formData.recorrencia === 'string' && !formData.recorrencia.startsWith('{')
                      ? <span className="capitalize">{formData.recorrencia.replace('@', ' às ').replace('@', ' ')}</span>
                      : <span className="text-indigo-400">Recorrência personalizada configurada</span>}
                  </div>
                  <Button type="button" onClick={() => setShowCustomRecurrence(true)}>Alterar</Button>
                </div>
              ) : (
                <RecurrenceConfig
                  config={formData.recorrencia_config}
                  onChange={(config) => setFormData(prev => ({...prev, recorrencia_config: config}))}
                  onClose={() => setShowCustomRecurrence(false)}
                />
              )}
            </div>

            <ContractSummary summary={summary} />
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>Cancelar</Button>
            <Button type="submit">{editingContract ? 'Salvar Alterações' : 'Criar Contrato'}</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
};

export default Contratos;
