import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Loader2, Pause, Play, Plus, RefreshCw, Search, Trash2, UserRound, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { agendamentosService } from '../services/agendamentos';
import { locatariosService } from '../services/locatarios';

const inputClass = 'w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500';
const labelClass = 'mb-1.5 block text-[10px] font-black uppercase tracking-widest text-zinc-500';
const frequencies = [
  ['diario', 'Diário'], ['semanal', 'Semanal'], ['quinzenal', 'A cada 15 dias'],
  ['mensal', 'Mensal'], ['personalizado', 'Intervalo personalizado'],
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
      getVariables(component.text).forEach((variable) => labels.push(`${componentType(component) === 'HEADER' ? 'Cabeçalho' : 'Corpo'} · {{${variable}}}`));
    } else if (componentType(component) === 'BUTTONS') {
      (component.buttons || []).forEach((button, index) => {
        if (String(button.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(button.url || ''))) {
          labels.push(`Botão de site ${index + 1} · variável`);
        }
      });
    }
  });
  return labels;
}

function defaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function MetaScheduleModal({ templates, tenants, onClose, onCreated }) {
  const approvedTemplates = templates.filter((template) => template.status === 'APPROVED' &&
    !(template.components || []).some((component) => componentType(component) === 'HEADER' && String(component.format).toUpperCase() === 'LOCATION'));
  const [templateId, setTemplateId] = useState(approvedTemplates[0]?.id || '');
  const [tenantId, setTenantId] = useState('');
  const [frequency, setFrequency] = useState('semanal');
  const [frequencyDays, setFrequencyDays] = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaultDate);
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [params, setParams] = useState([]);
  const [saving, setSaving] = useState(false);
  const selectedTemplate = approvedTemplates.find((item) => item.id === templateId);
  const labels = useMemo(() => parameterLabels(selectedTemplate), [selectedTemplate]);

  useEffect(() => setParams((current) => labels.map((_, index) => current[index] || '')), [labels.length, templateId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!templateId || !tenantId || !scheduledDate || !scheduledTime || (frequency === 'personalizado' && !frequencyDays)) {
      toast.error('Preencha o template, locatário e os dados do agendamento.');
      return;
    }
    if (labels.some((_, index) => !params[index]?.trim())) {
      toast.error('Preencha todos os exemplos das variáveis do template.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/whatsapp/schedules', {
        templateId,
        tenantId,
        frequency,
        frequencyDays: frequency === 'personalizado' ? Number(frequencyDays) : null,
        scheduledDate,
        scheduledTime,
        templateParams: params,
      });
      toast.success('Agendamento Meta criado.');
      await onCreated();
      onClose();
    } catch (error) {
      toast.error(error.message || 'Erro ao criar o agendamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="my-auto w-full max-w-2xl space-y-5 rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-black text-white">Novo agendamento Meta</h2><p className="mt-1 text-sm text-zinc-500">Envie periodicamente um template aprovado para um locatário.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white" aria-label="Fechar"><X size={18} /></button>
        </div>
        {!approvedTemplates.length ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">Não há templates aprovados disponíveis. Templates com cabeçalho de localização também precisam de tratamento específico e não podem ser agendados aqui.</div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className={labelClass}>Template aprovado</label><select className={inputClass} value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{approvedTemplates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</select></div>
              <div className="sm:col-span-2"><label className={labelClass}>Locatário</label><select className={inputClass} value={tenantId} onChange={(event) => setTenantId(event.target.value)} required><option value="">Selecione um locatário</option>{tenants.filter((tenant) => tenant.whatsapp).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.nome_completo} · {tenant.whatsapp}</option>)}</select></div>
              <div><label className={labelClass}>Frequência</label><select className={inputClass} value={frequency} onChange={(event) => setFrequency(event.target.value)}>{frequencies.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              {frequency === 'personalizado' && <div><label className={labelClass}>Intervalo em dias</label><input className={inputClass} type="number" min="1" max="365" value={frequencyDays} onChange={(event) => setFrequencyDays(event.target.value)} required /></div>}
              <div><label className={labelClass}>Primeiro envio</label><input className={inputClass} type="date" min={defaultDate()} value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} required /></div>
              <div><label className={labelClass}>Horário (Brasília)</label><input className={inputClass} type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} required /></div>
            </div>
            {labels.length > 0 && <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4"><div><h3 className="text-xs font-black uppercase tracking-widest text-zinc-300">Valores das variáveis</h3><p className="mt-1 text-xs text-zinc-500">Os valores abaixo serão reutilizados em cada envio deste agendamento.</p></div>{labels.map((label, index) => <div key={`${label}-${index}`}><label className={labelClass}>{label}</label><input className={inputClass} value={params[index] || ''} maxLength={1024} onChange={(event) => setParams((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} required /><p className="mt-1 text-right text-[10px] text-zinc-600">{(params[index] || '').length} / 1024</p></div>)}</section>}
            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-zinc-900">Cancelar</button><button type="submit" disabled={saving || !approvedTemplates.length} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-500 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Criar agendamento</button></div>
          </>
        )}
      </form>
    </div>
  );
}

export default function ZernioSchedulesCard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [channel, setChannel] = useState(null);
  const [templateWarning, setTemplateWarning] = useState('');
  const [tenants, setTenants] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const templatesById = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [templateResult, tenantResult, scheduleResult] = await Promise.allSettled([
        api.get('/whatsapp/templates'),
        locatariosService.listSimpleWithWhatsApp(profile.id),
        agendamentosService.list(),
      ]);

      if (scheduleResult.status === 'rejected') throw scheduleResult.reason;
      const tmplOk = templateResult.status === 'fulfilled';
      setTemplateWarning(tmplOk ? '' : 'Conecte e valide o canal de WhatsApp em Configurações para criar agendamentos de templates.');
      setChannel(tmplOk ? (templateResult.value?.channel || null) : null);
      setTemplates(tmplOk ? (templateResult.value?.templates || []) : []);
      setTenants(tenantResult.status === 'fulfilled' ? (tenantResult.value || []) : []);
      setSchedules(scheduleResult.value || []);
    } catch (error) {
      toast.error(`Erro ao carregar agendamentos: ${error.message || 'tente novamente.'}`);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const executeUpdate = async (schedule, change) => {
    setBusyId(schedule.id);
    try {
      if (change.__delete) {
        await agendamentosService.remove(schedule.id);
      } else {
        await agendamentosService.update(schedule.id, change);
      }
      toast.success(change.__delete ? 'Agendamento removido.' : change.ativo ? 'Agendamento reativado.' : 'Agendamento pausado.');
      await load();
    } catch (error) {
      toast.error(`Não foi possível atualizar: ${error.message || 'tente novamente.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeSchedule = (schedule) => {
    if (window.confirm('Excluir este agendamento?')) executeUpdate(schedule, { __delete: true });
  };

  const filteredSchedules = schedules.filter((schedule) => {
    const name = schedule.locatarios?.nome_completo || '';
    const template = templatesById.get(schedule.zernio_template_id);
    const title = template?.name || schedule.mensagens_template?.titulo || 'Template removido';
    return `${name} ${title}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));
  });

  return (
    <section className="space-y-5 rounded-3xl border border-zinc-800/70 bg-zinc-900/40 p-4 shadow-xl sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-lg font-black text-white">Agendamentos de mensagens</h2><p className="mt-1 text-sm text-zinc-500">Crie recorrências com templates Meta aprovados e acompanhe as mensagens legadas existentes.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={load} disabled={loading} className="flex items-center gap-2 rounded-xl border border-zinc-800 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar</button><button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-500"><Plus size={14} /> Novo agendamento</button></div>
      </div>

      <div className="relative max-w-md"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input className={`${inputClass} pl-9`} placeholder="Buscar locatário ou template" value={search} onChange={(event) => setSearch(event.target.value)} /></div>

      {channel && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
          <span className="font-bold uppercase tracking-wide text-zinc-200">{channel.providerLabel}</span>
          <span>{channel.label}</span>
          {channel.phoneNumber && <span className="font-mono text-zinc-600">{channel.phoneNumber}</span>}
        </p>
      )}
      {templateWarning && <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">{templateWarning}</p>}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-indigo-400" /></div> : !filteredSchedules.length ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 py-14 text-center"><CalendarClock className="mx-auto mb-3 text-zinc-700" size={32} /><p className="text-sm font-bold text-zinc-400">Nenhum agendamento encontrado</p><p className="mt-1 text-xs text-zinc-600">Agende um template aprovado para começar.</p></div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredSchedules.map((schedule) => {
            const isMeta = Boolean(schedule.zernio_template_id);
            const template = templatesById.get(schedule.zernio_template_id);
            const title = isMeta ? (template?.name || 'Template Meta') : (schedule.mensagens_template?.titulo || 'Mensagem legada');
            const busy = busyId === schedule.id;
            return (
              <article key={schedule.id} className={`rounded-2xl border bg-zinc-950/80 p-4 ${schedule.ativo ? 'border-zinc-800' : 'border-zinc-900 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${isMeta ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>{isMeta ? 'Meta · Zernio' : 'Legado'}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${schedule.ativo ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-900 text-zinc-500'}`}>{schedule.ativo ? 'Ativo' : 'Pausado'}</span></div><h3 className="truncate text-sm font-black text-white">{title}</h3><p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500"><UserRound size={12} />{schedule.locatarios?.nome_completo || 'Locatário indisponível'}{schedule.locatarios?.whatsapp ? ` · ${schedule.locatarios.whatsapp}` : ''}</p></div>
                  <div className="flex shrink-0 gap-1"><button type="button" disabled={busy} onClick={() => executeUpdate(schedule, { ativo: !schedule.ativo, ultimo_erro: null })} title={schedule.ativo ? 'Pausar' : 'Reativar'} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : schedule.ativo ? <Pause size={15} /> : <Play size={15} />}</button><button type="button" disabled={busy} onClick={() => removeSchedule(schedule)} title="Excluir" className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"><Trash2 size={15} /></button></div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-zinc-900/70 p-3"><p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Frequência</p><p className="mt-1 text-zinc-300">{frequencies.find(([key]) => key === schedule.frequencia)?.[1] || schedule.frequencia}{schedule.frequencia === 'personalizado' ? ` · ${schedule.frequencia_dias} dias` : ''}</p></div><div className="rounded-xl bg-zinc-900/70 p-3"><p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Próximo envio</p><p className="mt-1 flex items-center gap-1.5 text-zinc-300"><Clock3 size={12} />{formatDate(schedule.proximo_envio)} às {String(schedule.horario_envio || '').slice(0, 5)}</p></div></div>
                {schedule.ultimo_erro && <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">Último erro: {schedule.ultimo_erro}</p>}
                {isMeta && schedule.template_params?.length > 0 && <p className="mt-3 text-[10px] text-zinc-600">{schedule.template_params.length} variável(is) configurada(s) · {template?.language || 'idioma Meta'}</p>}
                {!isMeta && <p className="mt-3 text-[10px] text-amber-500/80">Agendamento antigo. Novas recorrências devem usar templates Meta.</p>}
              </article>
            );
          })}
        </div>
      )}
      {showModal && <MetaScheduleModal templates={templates} tenants={tenants} onClose={() => setShowModal(false)} onCreated={load} />}
    </section>
  );
}
