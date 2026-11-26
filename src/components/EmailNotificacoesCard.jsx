import React, { useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Info,
  Loader2,
  Mail,
  Save,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { api } from '../services/api';

const PREFERENCE_FIELDS = [
  {
    key: 'notificar_pagamento',
    label: 'Pagamento da Meta pendente',
    hint: 'Recusa de envio por problema no método de pagamento. Pausa os lembretes automáticos.',
    blocking: true,
  },
  {
    key: 'notificar_conta_bloqueada',
    label: 'Conta WhatsApp Business bloqueada',
    hint: 'Conta restringida ou bloqueada pela Meta. Pausa os lembretes automáticos.',
    blocking: true,
  },
  {
    key: 'notificar_token_invalido',
    label: 'Token da Meta inválido ou expirado',
    hint: 'A Meta deixou de aceitar o token de acesso. Pausa os lembretes automáticos.',
    blocking: true,
  },
  {
    key: 'notificar_permissao',
    label: 'Permissão da Meta recusada',
    hint: 'O token não tem as permissões necessárias para enviar ou gerenciar templates.',
  },
  {
    key: 'notificar_template',
    label: 'Template do WhatsApp com problema',
    hint: 'Template recusado, pausado ou desatualizado.',
  },
  {
    key: 'notificar_limite_envio',
    label: 'Limite de envio atingido',
    hint: 'Limites costumam ser temporários. Desativado por padrão para evitar ruído.',
  },
  {
    key: 'notificar_integracao',
    label: 'Número precisa de configuração',
    hint: 'Número ou conta com ajuste pendente na Meta.',
  },
];

const EMPTY_FORM = {
  enabled: true,
  fromEmail: '',
  fromName: '',
  apiKey: '',
  preferences: {
    ...Object.fromEntries(PREFERENCE_FIELDS.map((field) => [field.key, field.key !== 'notificar_limite_envio'])),
    notificar_resumo_diario: true,
  },
};

function formatDateTime(value) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

const EmailNotificacoesCard = () => {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingSummary, setSendingSummary] = useState(false);

  const invoke = async (action, payload = {}) => {
    return api.post('/integrations/email', { action, ...payload });
  };

  const applyConfig = (next) => {
    setConfig(next);
    setForm({
      enabled: next?.enabled !== false,
      fromEmail: next?.fromEmail || '',
      fromName: next?.fromName || '',
      apiKey: '',
      preferences: { ...EMPTY_FORM.preferences, ...(next?.preferences || {}) },
    });
  };

  useEffect(() => {
    let active = true;
    invoke('status')
      .then((data) => { if (active && data?.config) applyConfig(data.config); })
      .catch((error) => { if (active) toast.error(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const updatePreference = (key, value) => {
    setForm((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await invoke('save', {
        enabled: form.enabled,
        fromEmail: form.fromEmail,
        fromName: form.fromName,
        apiKey: form.apiKey,
        preferences: form.preferences,
      });
      applyConfig(data.config);
      toast.success('Configuração de e-mail salva.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const data = await invoke('test');
      applyConfig(data.config);
      toast.success('E-mail de teste enviado para o endereço da sua conta.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setTesting(false);
    }
  };

  const sendDailySummary = async () => {
    setSendingSummary(true);
    try {
      const data = await invoke('send_daily_summary');
      applyConfig(data.config);
      const refLabel = data?.summary?.referenceDateLabel ? ` (${data.summary.referenceDateLabel})` : '';
      toast.success(`Resumo diário${refLabel} enviado para ${config?.recipientEmail || 'seu e-mail'}.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSendingSummary(false);
    }
  };

  const disable = async () => {
    if (!window.confirm('Desativar as notificações por e-mail? Os alertas continuam aparecendo no painel.')) return;
    setSaving(true);
    try {
      const data = await invoke('disable');
      applyConfig(data.config);
      toast.success('Notificações por e-mail desativadas.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center rounded-xl border border-slate-700 bg-card p-10">
        <Loader2 className="animate-spin text-accent" size={26} />
      </div>
    );
  }

  const recipient = config?.recipientEmail || '';
  const hasKey = Boolean(config?.hasKey);
  const keyStatus = config?.keyStatus;
  const enabled = form.enabled;

  return (
    <form onSubmit={save} className="space-y-5 rounded-xl border border-slate-700 bg-card p-6 shadow-lg">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400">
            <Bell size={16} /> Notificações por e-mail
          </h2>
          <p className="mt-2 max-w-2xl text-xs text-slate-500">
            Quando a Meta recusar um envio por um motivo acionável, o SGA envia um aviso para o e-mail da sua conta
            usando a sua própria conta do Resend. É enviado no máximo um e-mail por alerta a cada 24 horas.
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${
            enabled && hasKey && form.fromEmail
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-slate-700 bg-slate-900/50 text-slate-500'
          }`}
        >
          {enabled && hasKey && form.fromEmail ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {enabled && hasKey && form.fromEmail ? 'Ativo' : 'Não configurado'}
        </span>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/30 p-4">
        <Mail className="mt-0.5 shrink-0 text-slate-400" size={18} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-200">Destinatário</p>
          <p className="mt-1 break-all text-sm text-white">{recipient || 'E-mail da conta não encontrado'}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Por segurança, os avisos são sempre enviados para o e-mail cadastrado na sua conta do SGA.
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Credencial do Resend</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-slate-500">
            E-mail remetente
            <input
              type="email"
              required={enabled}
              value={form.fromEmail}
              onChange={(event) => setForm({ ...form, fromEmail: event.target.value })}
              placeholder="avisos@seudominio.com"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10px] text-slate-500">O domínio precisa estar verificado na sua conta Resend.</span>
          </label>
          <label className="text-xs text-slate-500">
            Nome do remetente
            <input
              type="text"
              maxLength={80}
              value={form.fromName}
              onChange={(event) => setForm({ ...form, fromName: event.target.value })}
              placeholder="Painel SGA"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="block text-xs text-slate-500">
          API Key do Resend
          <input
            type="password"
            autoComplete="new-password"
            spellCheck="false"
            value={form.apiKey}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            placeholder={hasKey ? `Chave salva •••• ${config?.keyLast4 || ''}` : 're_…'}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 font-mono text-sm text-white outline-none focus:border-accent"
          />
          <span className="mt-1 block text-[10px] text-slate-500">
            {hasKey
              ? 'A chave é gravada cifrada e nunca volta para o navegador. Preencha apenas para substituí-la.'
              : 'Crie uma API Key em resend.com/api-keys com permissão de envio.'}
          </span>
        </label>

        {(keyStatus || config?.lastError || config?.lastSentAt) && (
          <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-[11px] text-slate-500">
            {keyStatus === 'invalid' && (
              <p className="flex items-center gap-1.5 text-red-300"><XCircle size={12} /> A última validação da chave falhou.</p>
            )}
            {config?.lastSentAt && <p>Último e-mail enviado em {formatDateTime(config.lastSentAt)}.</p>}
            {config?.lastError && <p className="break-words text-red-300">Último erro: {config.lastError}</p>}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-slate-700/60 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <CalendarClock size={14} /> Resumo diário de cobranças e custos
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              Enviado todos os dias às 08h00 (horário de Brasília) com as cobranças vencidas no dia anterior (pagas e
              pendentes) e o custo estimado das mensagens template enviadas no WhatsApp.
            </p>
          </div>
          {hasKey && form.fromEmail && (
            <button
              type="button"
              onClick={sendDailySummary}
              disabled={sendingSummary || testing || saving}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              {sendingSummary ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              Enviar resumo de ontem
            </button>
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/30 p-3">
          <input
            type="checkbox"
            checked={form.preferences.notificar_resumo_diario !== false}
            onChange={(event) => updatePreference('notificar_resumo_diario', event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#0066cc]"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
              Receber resumo diário automático às 08h00
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
              Inclui total pago e pendente dos vencimentos do dia anterior, lista de locatários e estimativa de custo
              por categoria de template WhatsApp (Meta).
            </span>
            {config?.lastDailySummarySentAt && (
              <span className="mt-1 block text-[10px] text-slate-400">
                Último resumo enviado em {formatDateTime(config.lastDailySummarySentAt)}.
              </span>
            )}
          </span>
        </label>
      </section>

      <section className="space-y-3 border-t border-slate-700/60 pt-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Quais avisos receber</h3>
        <p className="text-[11px] text-slate-500">
          Os alertas sempre aparecem no painel. Estas opções controlam apenas o envio de e-mail.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PREFERENCE_FIELDS.map((field) => (
            <label
              key={field.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/30 p-3"
            >
              <input
                type="checkbox"
                checked={form.preferences[field.key] !== false}
                onChange={(event) => updatePreference(field.key, event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#0066cc]"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                  {field.label}
                  {field.blocking && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                      Pausa envios
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{field.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            className="h-4 w-4 accent-[#0066cc]"
          />
          Enviar notificações por e-mail
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {hasKey && form.fromEmail && (
            <button
              type="button"
              onClick={sendTest}
              disabled={testing || saving}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {testing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              Enviar teste
            </button>
          )}
          {config?.enabled !== false && (
            <button
              type="button"
              onClick={disable}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              Desativar
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            Salvar
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 text-[11px] text-slate-500">
        <ShieldCheck className="mt-0.5 shrink-0" size={13} />
        O SGA usa a sua chave apenas para enviar avisos a você mesmo. Nenhum dado de locatários é enviado ao Resend.
      </p>
      <p className="flex items-start gap-2 text-[11px] text-slate-500">
        <Info className="mt-0.5 shrink-0" size={13} />
        Sem a credencial configurada, os alertas continuam visíveis no painel e os lembretes seguem pausados quando
        a Meta estiver bloqueando os envios.
      </p>
    </form>
  );
};

export default EmailNotificacoesCard;
