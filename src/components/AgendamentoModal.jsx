import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { agendamentosService } from '../services/agendamentos';
import { locatariosService } from '../services/locatarios';
import { toast } from 'react-toastify';
import {
  X, Search, Clock, CalendarClock, Loader2, Trash2, CheckCircle2,
  Pause, Play, AlertCircle, ExternalLink, MessageSquare, Users
} from 'lucide-react';

const frequencies = [
  ['diario', 'Diário'],
  ['semanal', 'Semanal'],
  ['quinzenal', 'Quinzenal'],
  ['mensal', 'Mensal'],
  ['personalizado', 'Personalizado'],
];

const getVariables = (text) => [...new Set([...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const componentType = (component) => String(component?.type || '').toUpperCase();

function parameterLabels(template) {
  const components = template?.components || [];
  const ordered = [
    ...components.filter((component) => componentType(component) === 'HEADER'),
    ...components.filter((component) => componentType(component) === 'BODY'),
    ...components.filter((component) => componentType(component) === 'BUTTONS'),
  ];
  const labels = [];
  ordered.forEach((component) => {
    if (['HEADER', 'BODY'].includes(componentType(component))) {
      getVariables(component.text).forEach((variable) => labels.push({
        position: labels.length + 1,
        variable,
        label: `${componentType(component) === 'HEADER' ? 'Cabeçalho' : 'Corpo'} · variável {{${variable}}}`,
      }));
    } else if (componentType(component) === 'BUTTONS') {
      (component.buttons || []).forEach((button, index) => {
        if (String(button.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(button.url || ''))) {
          labels.push({
            position: labels.length + 1,
            variable: 'url',
            label: `Botão de site ${index + 1} · link`,
          });
        }
      });
    }
  });
  return labels;
}

function getDefaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

const AgendamentoModal = ({ isOpen, onClose, template, locatario: initialLocatario, usuario, mode = 'locatario' }) => {
  const [locatarios, setLocatarios] = useState([]);
  const [allTemplates, setAllTemplates] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocatario, setSelectedLocatario] = useState(initialLocatario || null);
  const [selectedTemplate, setSelectedTemplate] = useState(template || null);
  const [templateParams, setTemplateParams] = useState([]);

  // Suporte a Agendamento em Lote
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedTenantIds, setSelectedTenantIds] = useState(initialLocatario?.id ? [initialLocatario.id] : []);
  const [tenantSearch, setTenantSearch] = useState('');

  const [frequencia, setFrequencia] = useState('semanal');
  const [frequenciaDias, setFrequenciaDias] = useState('');
  const [proximoEnvio, setProximoEnvio] = useState(getDefaultDate);
  const [horario, setHorario] = useState('09:00');

  const [agendamentos, setAgendamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyScheduleId, setBusyScheduleId] = useState(null);

  const templatesById = useMemo(() => new Map(allTemplates.map(t => [t.id, t])), [allTemplates]);

  // Filtra apenas templates Meta aprovados categorizados como "avulso"
  const avulsoTemplates = useMemo(() => {
    return allTemplates.filter((t) => {
      const isApproved = String(t.status || '').toUpperCase() === 'APPROVED';
      const isAvulso = (t.usages || []).some((u) => u.purpose === 'avulso' && u.is_default);
      return isApproved && isAvulso;
    });
  }, [allTemplates]);

  const slots = useMemo(() => parameterLabels(selectedTemplate), [selectedTemplate]);

  // Atualiza parâmetros padrão ao trocar de template ou locatário
  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateParams([]);
      return;
    }
    const avulsoUsage = (selectedTemplate.usages || []).find((u) => u.purpose === 'avulso' && u.is_default);
    const variableMapping = avulsoUsage?.variable_mapping || [];
    const tenantFirstName = selectedLocatario?.nome_completo ? selectedLocatario.nome_completo.trim().split(' ')[0] : '';
    const tenantFullName = selectedLocatario?.nome_completo || '';

    const newParams = slots.map((slot) => {
      if (isBatchMode && slot.position === 1) return '{{nome}}';
      const mapped = variableMapping.find((m) => Number(m.position) === slot.position)?.field;
      if (mapped === 'tenant_first_name' && tenantFirstName) return tenantFirstName;
      if (mapped === 'tenant_name' && tenantFullName) return tenantFullName;
      if (slot.position === 1 && tenantFirstName) return tenantFirstName;
      return '';
    });
    setTemplateParams(newParams);
  }, [selectedTemplate, selectedLocatario, slots, isBatchMode]);

  const fetchData = useCallback(async () => {
    if (!usuario?.id) return;
    try {
      setLoading(true);

      // 1. Carregar lista de locatários
      const locData = await locatariosService.listSimpleWithWhatsApp(usuario.id);
      const valid = (locData || []).filter(l => Boolean(l.whatsapp));
      setLocatarios(valid);

      // 2. Carregar templates Meta através do backend
      try {
        const tmplResult = await api.get('/whatsapp/templates');
        if (tmplResult?.templates) {
          setAllTemplates(tmplResult.templates);
        }
      } catch (err) {
        console.error('Erro ao consultar templates Meta:', err);
      }

      // 3. Carregar agendamentos atuais
      const filters = {};
      if (mode === 'template' && template?.id) {
        filters.template_id = template.id;
      } else if (isBatchMode && selectedTenantIds.length > 0) {
        filters.tenant_ids = selectedTenantIds;
      } else if (selectedLocatario?.id || initialLocatario?.id) {
        filters.id_locatario = selectedLocatario?.id || initialLocatario?.id;
      } else {
        filters.limit = 20;
      }

      const agData = await agendamentosService.list(filters);
      setAgendamentos(agData || []);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar dados do agendamento.');
    } finally {
      setLoading(false);
    }
  }, [usuario?.id, mode, template?.id, selectedLocatario?.id, initialLocatario?.id, isBatchMode, selectedTenantIds]);

  useEffect(() => {
    if (isOpen && usuario?.id) {
      setProximoEnvio(getDefaultDate());
      if (initialLocatario?.id) {
        setSelectedLocatario(initialLocatario);
        setSelectedTenantIds([initialLocatario.id]);
      }
      fetchData();
    }
  }, [isOpen, usuario?.id, initialLocatario, fetchData]);

  const toggleTenant = (id) => {
    setSelectedTenantIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllTenants = () => {
    setSelectedTenantIds(locatarios.map((l) => l.id));
  };

  const deselectAllTenants = () => {
    setSelectedTenantIds([]);
  };

  const filteredLocatarios = useMemo(() => {
    return locatarios.filter((l) =>
      l.nome_completo.toLowerCase().includes(tenantSearch.toLowerCase()) ||
      l.whatsapp.includes(tenantSearch)
    );
  }, [locatarios, tenantSearch]);

  const handleSave = async () => {
    if (!proximoEnvio || !frequencia || (frequencia === 'personalizado' && !frequenciaDias)) {
      return toast.error('Preencha a frequência e o primeiro envio.');
    }

    const targetTenantIds = isBatchMode ? selectedTenantIds : (selectedLocatario?.id ? [selectedLocatario.id] : []);
    if (targetTenantIds.length === 0) {
      return toast.error('Selecione ao menos um locatário com WhatsApp para o agendamento.');
    }

    if (!selectedTemplate) {
      return toast.error('Selecione um template avulso para agendar.');
    }

    if (slots.length > 0 && templateParams.some((val) => !String(val || '').trim())) {
      return toast.error(`Preencha todos os ${slots.length} valores de variáveis do template.`);
    }

    try {
      setSaving(true);
      const freqNum = frequencia === 'personalizado' ? parseInt(frequenciaDias, 10) : null;

      const data = await api.post('/whatsapp/schedules', {
        templateId: selectedTemplate.id,
        tenantIds: targetTenantIds,
        frequency: frequencia,
        frequencyDays: freqNum,
        scheduledDate: proximoEnvio,
        scheduledTime: horario,
        templateParams: templateParams,
      });

      const count = data?.count || targetTenantIds.length;
      toast.success(
        count === 1
          ? 'Agendamento configurado com sucesso!'
          : `${count} agendamentos em lote configurados com sucesso!`
      );
      setSelectedTemplate(null);
      setTemplateParams([]);
      fetchData();
    } catch (error) {
      toast.error('Erro ao criar agendamento: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleScheduleActive = async (schedule) => {
    setBusyScheduleId(schedule.id);
    try {
      const nextAtivo = !schedule.ativo;
      await agendamentosService.update(schedule.id, { ativo: nextAtivo });
      toast.success(nextAtivo ? 'Agendamento reativado.' : 'Agendamento pausado.');
      fetchData();
    } catch (error) {
      toast.error('Erro ao atualizar agendamento: ' + error.message);
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este agendamento?')) return;
    setBusyScheduleId(id);
    try {
      await agendamentosService.remove(id);
      toast.success('Agendamento removido.');
      fetchData();
    } catch (error) {
      toast.error('Erro ao remover: ' + error.message);
    } finally {
      setBusyScheduleId(null);
    }
  };

  const filteredTemplates = useMemo(() => {
    return avulsoTemplates.filter((t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [avulsoTemplates, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col md:flex-row md:items-center justify-start md:justify-center p-4 py-8 md:p-8 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300 gap-6 overflow-y-auto">
      {/* Coluna 1: Configuração do Agendamento */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl flex flex-col shrink-0 h-[680px] md:h-[88vh] mx-auto">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-xl">
              <CalendarClock size={20} className="text-indigo-500" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-tight">
                {isBatchMode ? 'Agendamento em Lote' : 'Configurar Agendamento'}
              </h3>
              <p className="text-[10px] text-zinc-500 uppercase">
                {isBatchMode
                  ? `${selectedTenantIds.length} locatário(s) selecionado(s)`
                  : `Cliente: ${selectedLocatario?.nome_completo || 'Não selecionado'}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 md:hidden hover:text-white" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          {/* Alternador de Modo: Individual vs Em Lote */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-black tracking-widest text-zinc-400 flex items-center gap-1.5">
                <Users size={14} className="text-indigo-400" /> Destinatários
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextBatch = !isBatchMode;
                  setIsBatchMode(nextBatch);
                  if (nextBatch && selectedTenantIds.length === 0 && selectedLocatario?.id) {
                    setSelectedTenantIds([selectedLocatario.id]);
                  }
                }}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg transition ${
                  isBatchMode
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {isBatchMode ? '✓ Modo em Lote' : 'Ativar Modo em Lote'}
              </button>
            </div>

            {isBatchMode ? (
              <div className="space-y-2 pt-1 border-t border-zinc-800/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" size={12} />
                    <input
                      type="text"
                      placeholder="Filtrar locatário..."
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 pl-7 pr-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={selectAllTenants}
                    className="rounded-lg bg-indigo-500/10 px-2 py-1 text-[9px] font-bold text-indigo-300 hover:bg-indigo-500/20"
                  >
                    Todos ({locatarios.length})
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllTenants}
                    className="rounded-lg bg-zinc-800 px-2 py-1 text-[9px] font-bold text-zinc-400 hover:bg-zinc-700"
                  >
                    Limpar
                  </button>
                </div>

                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                  {filteredLocatarios.map((item) => {
                    const isChecked = selectedTenantIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`flex items-center justify-between p-1.5 rounded-lg border text-xs cursor-pointer transition ${
                          isChecked
                            ? 'bg-indigo-500/10 border-indigo-500/40 text-white'
                            : 'bg-zinc-900 border-zinc-800/80 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleTenant(item.id)}
                            className="rounded border-zinc-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-zinc-800"
                          />
                          <span className="truncate">{item.nome_completo}</span>
                        </div>
                        <span className="text-[9px] font-mono text-zinc-500 shrink-0 ml-1">
                          {item.whatsapp}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  value={selectedLocatario?.id || ''}
                  onChange={(e) => {
                    const found = locatarios.find((l) => l.id === e.target.value);
                    setSelectedLocatario(found || null);
                    if (found) setSelectedTenantIds([found.id]);
                  }}
                >
                  <option value="">Selecione um locatário...</option>
                  {locatarios.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome_completo} ({l.whatsapp})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Frequência e Primeiro Envio */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Frequência</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  value={frequencia}
                  onChange={(e) => setFrequencia(e.target.value)}
                >
                  {frequencies.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                {frequencia === 'personalizado' && (
                  <input
                    type="number"
                    min="1"
                    max="365"
                    placeholder="Dias"
                    className="w-16 bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-center text-xs text-white outline-none focus:border-indigo-500"
                    value={frequenciaDias}
                    onChange={(e) => setFrequenciaDias(e.target.value)}
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">Primeiro Envio</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  min={getDefaultDate()}
                  className="flex-[2] bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  value={proximoEnvio}
                  onChange={(e) => setProximoEnvio(e.target.value)}
                />
                <input
                  type="time"
                  className="flex-[1] bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-center text-xs text-white outline-none focus:border-indigo-500"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Selecionar Template Avulso */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-black tracking-widest text-zinc-500">
                Templates do Tipo Mensagem Avulsa
              </label>
              <span className="text-[10px] font-bold text-emerald-400">
                {avulsoTemplates.length} disponível(is)
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
              <input
                type="text"
                placeholder="Filtrar template avulso..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {avulsoTemplates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 p-4 text-center">
                <AlertCircle size={24} className="mx-auto mb-2 text-amber-400" />
                <p className="text-xs font-bold text-zinc-300">Nenhum template avulso cadastrado</p>
                <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">
                  Para agendar uma mensagem, acesse a aba <strong>/mensagens</strong> e clique em <em>“Usar como avulso”</em> em um template aprovado da Meta.
                </p>
                <Link
                  to="/mensagens"
                  onClick={onClose}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 px-3 py-1.5 text-xs font-bold transition"
                >
                  <ExternalLink size={13} /> Gerenciar Templates
                </Link>
              </div>
            ) : (
              <div className="max-h-[170px] overflow-y-auto space-y-2 pr-1">
                {filteredTemplates.map((item) => {
                  const isSelected = selectedTemplate?.id === item.id;
                  const bodyComponent = (item.components || []).find((c) => componentType(c) === 'BODY');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedTemplate(item)}
                      className={`w-full text-left p-3 rounded-xl transition-all border ${
                        isSelected
                          ? 'bg-emerald-600/15 border-emerald-500/60'
                          : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-bold truncate ${isSelected ? 'text-emerald-300' : 'text-zinc-200'}`}>
                              {item.name}
                            </p>
                            <span className="text-[9px] font-mono text-zinc-500">{item.language}</span>
                            <span className="text-[9px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.2 rounded font-bold uppercase">
                              Avulso
                            </span>
                          </div>
                          {bodyComponent?.text && (
                            <p className="text-[10px] text-zinc-500 mt-1 line-clamp-2">
                              {bodyComponent.text}
                            </p>
                          )}
                        </div>
                        {isSelected && <CheckCircle2 size={16} className="text-emerald-400 shrink-0 ml-2" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Variáveis do Template Selecionado */}
          {selectedTemplate && slots.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-300">Variáveis do Template</h4>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {isBatchMode
                    ? 'Use {{nome}} na primeira variável para preencher o primeiro nome de cada locatário automaticamente.'
                    : 'Preencha os valores que serão enviados em cada mensagem agendada.'}
                </p>
              </div>
              <div className="space-y-2">
                {slots.map((slot, index) => (
                  <div key={`${slot.position}-${slot.label}`}>
                    <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                      {slot.label}
                    </label>
                    <input
                      type="text"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                      value={templateParams[index] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTemplateParams((curr) => curr.map((v, i) => (i === index ? val : v)));
                      }}
                      placeholder={index === 0 && isBatchMode ? '{{nome}}' : 'Valor da variável...'}
                      required
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-zinc-800">
          <button
            disabled={
              saving ||
              !selectedTemplate ||
              (isBatchMode ? selectedTenantIds.length === 0 : !selectedLocatario) ||
              (slots.length > 0 && templateParams.some((val) => !String(val || '').trim()))
            }
            onClick={handleSave}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {saving
              ? 'Criando Agendamento...'
              : isBatchMode
              ? `Agendar para ${selectedTenantIds.length} Locatário(s)`
              : 'Criar Agendamento'}
          </button>
        </div>
      </div>

      {/* Coluna 2: Agendamentos Ativos */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl flex flex-col shrink-0 h-[500px] md:h-[88vh] mx-auto">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-emerald-500" />
            <h3 className="text-sm font-black text-white uppercase tracking-tight">
              {isBatchMode ? 'Agendamentos dos Selecionados' : 'Agendamentos Deste Cliente'}
            </h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hidden md:block hover:text-white" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Loader2 className="animate-spin text-zinc-500" size={32} />
            </div>
          ) : agendamentos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <CalendarClock className="text-zinc-700 mb-2" size={32} />
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider">
                Nenhum agendamento ativo
              </p>
              <p className="text-zinc-600 text-[10px] mt-1">
                Selecione um template avulso ao lado para programar um envio periódico.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {agendamentos.map((ag) => {
                const metaTemplate = ag.zernio_template_id ? templatesById.get(ag.zernio_template_id) : null;
                const templateTitle = metaTemplate?.name || ag.mensagens_template?.titulo || 'Template Meta';
                const isMeta = Boolean(ag.zernio_template_id);
                const isBusy = busyScheduleId === ag.id;
                const tenantName = ag.locatarios?.nome_completo || '';

                return (
                  <div
                    key={ag.id}
                    className={`p-4 bg-zinc-950 border rounded-2xl flex items-center justify-between group transition-all ${
                      ag.ativo ? 'border-zinc-800 hover:border-zinc-700' : 'border-zinc-800/40 opacity-60'
                    }`}
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="flex items-center gap-1.5">
                        <MessageSquare size={13} className="text-emerald-400 shrink-0" />
                        <p className="text-xs font-bold text-zinc-200 uppercase truncate">
                          {templateTitle}
                        </p>
                        {isMeta && (
                          <span className="text-[8px] bg-indigo-500/15 text-indigo-300 px-1.5 py-0.2 rounded font-mono">
                            Meta
                          </span>
                        )}
                      </div>
                      {tenantName && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 truncate">
                          Destinatário: <span className="font-semibold text-zinc-200">{tenantName}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">
                          {ag.frequencia}
                        </span>
                        <span className="text-[9px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                          Próx: {ag.proximo_envio ? ag.proximo_envio.split('-').reverse().join('/') : '—'}{' '}
                          {ag.horario_envio ? `às ${ag.horario_envio.substring(0, 5)}` : ''}
                        </span>
                      </div>
                      {ag.ultimo_erro && (
                        <p className="text-[10px] text-red-400 mt-1 line-clamp-1">
                          {ag.ultimo_erro}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => toggleScheduleActive(ag)}
                        className={`p-2 rounded-xl transition ${
                          ag.ativo
                            ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                        title={ag.ativo ? 'Pausar agendamento' : 'Reativar agendamento'}
                      >
                        {isBusy ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : ag.ativo ? (
                          <Pause size={15} />
                        ) : (
                          <Play size={15} />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDelete(ag.id)}
                        className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition"
                        title="Excluir agendamento"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgendamentoModal;
