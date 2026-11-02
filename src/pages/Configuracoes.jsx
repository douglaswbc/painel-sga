import React, { useEffect, useState } from 'react';
import { Bell, Cloud, Key, Loader2, MessageCircle, Save, Settings, User } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { usuariosService } from '../services/usuarios';
import { supabase } from '../services/supabase';
import ZernioIntegrationCard from '../components/ZernioIntegrationCard';
import MetaIntegrationCard from '../components/MetaIntegrationCard';
import EmailNotificacoesCard from '../components/EmailNotificacoesCard';

const tabs = [
  { id: 'zernio', label: 'Zernio', icon: MessageCircle, landlordOnly: true },
  { id: 'meta', label: 'Meta Cloud API', icon: Cloud, landlordOnly: true },
  { id: 'notificacoes', label: 'Notificações', icon: Bell, landlordOnly: true },
  { id: 'conta', label: 'Conta e Pagamentos', icon: User, landlordOnly: false },
];

export default function Configuracoes() {
  const { profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState('zernio');
  const [tabTouched, setTabTouched] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secretsLoaded, setSecretsLoaded] = useState(false);
  const [formData, setFormData] = useState({
    nome_completo: '',
    whatsapp: '',
    access_token_mercado_pago: '',
    reminder_stagger_minutes: 2,
    reminder_dispatch_delay_seconds: 5,
  });

  const isLandlord = profile?.role === 'locador';

  useEffect(() => {
    if (!profile) return;
    setFormData((current) => ({
      ...current,
      nome_completo: profile.nome_completo || '',
      whatsapp: profile.whatsapp || '',
      reminder_stagger_minutes: profile.reminder_stagger_minutes ?? 2,
      reminder_dispatch_delay_seconds: profile.reminder_dispatch_delay_seconds ?? 5,
    }));
  }, [profile]);

  useEffect(() => {
    if (!profile || tabTouched) return;
    setActiveTab(profile.role === 'locador' ? 'zernio' : 'conta');
  }, [profile, tabTouched]);

  // O AuthContext resolve o perfil de forma assíncrona. A tela espera o perfil
  // para escolher a aba inicial, mas nunca fica bloqueada se ele não vier.
  useEffect(() => {
    if (profile) {
      setProfileReady(true);
      return undefined;
    }
    const timer = setTimeout(() => setProfileReady(true), 4000);
    return () => clearTimeout(timer);
  }, [profile]);

  useEffect(() => {
    if (activeTab !== 'conta' || secretsLoaded || !profile) return;
    let mounted = true;
    setLoading(true);
    supabase.functions.invoke('get-secrets').then(({ data, error }) => {
      if (!mounted) return;
      if (!error && data?.success) {
        setFormData((current) => ({ ...current, access_token_mercado_pago: data.mp_token || '' }));
      }
      setSecretsLoaded(true);
    }).catch(() => { if (mounted) setSecretsLoaded(true); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [activeTab, secretsLoaded, profile]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await usuariosService.update(user.id, {
        nome_completo: formData.nome_completo,
        whatsapp: formData.whatsapp,
        reminder_stagger_minutes: Math.max(0, Math.min(60, Number(formData.reminder_stagger_minutes) || 2)),
        reminder_dispatch_delay_seconds: Math.max(0, Math.min(30, Number(formData.reminder_dispatch_delay_seconds) || 5)),
      });
      if (formData.access_token_mercado_pago) {
        const { data, error } = await supabase.functions.invoke('save-secret', { body: { secretType: 'mp_token', value: formData.access_token_mercado_pago } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
      toast.success('Configurações salvas.');
    } catch (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!window.confirm('Enviar e-mail para redefinir sua senha?')) return;
    try {
      await usuariosService.resetPassword(user.email, `${window.location.origin}/login`);
      toast.success('E-mail de recuperação enviado.');
    } catch (error) {
      toast.error(`Não foi possível enviar: ${error.message}`);
    }
  };

  const visibleTabs = tabs.filter((tab) => !tab.landlordOnly || isLandlord);

  if (!profileReady) {
    return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-accent" size={40} /></div>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="rounded-xl bg-indigo-500/20 p-2"><Settings className="text-indigo-400" size={24} /></span>
        <div>
          <h1 className="text-2xl font-bold text-white">Configurações</h1>
          <p className="mt-1 text-sm text-zinc-500">Escolha o provedor de WhatsApp usado pelo SGA ou ajuste os dados da sua conta.</p>
        </div>
      </header>

      <nav className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-zinc-900 bg-zinc-950/50 p-1">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTabTouched(true); setActiveTab(id); }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${activeTab === id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </nav>

      {activeTab === 'zernio' && isLandlord && <ZernioIntegrationCard />}
      {activeTab === 'meta' && isLandlord && <MetaIntegrationCard />}
      {activeTab === 'notificacoes' && isLandlord && <EmailNotificacoesCard />}

      {activeTab === 'conta' && (
        <form onSubmit={save} className="space-y-6 rounded-xl border border-slate-700 bg-card p-6 shadow-lg">
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400"><User size={16} /> Perfil e pagamentos</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-slate-500">Nome completo<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" value={formData.nome_completo} onChange={(event) => setFormData({ ...formData, nome_completo: event.target.value })} /></label>
              <label className="text-xs text-slate-500">WhatsApp de contato<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" value={formData.whatsapp} onChange={(event) => setFormData({ ...formData, whatsapp: event.target.value })} /></label>
            </div>
            <label className="mt-4 block text-xs text-slate-500">
              Token de acesso do Mercado Pago
              <input
                type="password"
                autoComplete="new-password"
                disabled={loading}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 font-mono text-sm text-white outline-none focus:border-accent disabled:opacity-60"
                value={formData.access_token_mercado_pago}
                onChange={(event) => setFormData({ ...formData, access_token_mercado_pago: event.target.value })}
              />
            </label>
            {loading && <p className="mt-2 text-[11px] text-slate-600">Carregando o token salvo…</p>}
            <p className="mt-2 text-[11px] text-slate-600">A chave do Zernio ou o token da Meta são configurados nas abas anteriores e nunca são exibidos depois de salvos.</p>
            {isLandlord && (
              <div className="mt-6 border-t border-slate-700/60 pt-6">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                  Cadência e Intervalo de Envios (WhatsApp)
                </h3>
                <p className="mb-4 text-xs text-slate-500">
                  Evita o disparo simultâneo quando você possui múltiplos contratos com cobrança no mesmo horário.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">
                    Intervalo entre contratos (minutos)
                    <input
                      type="number"
                      min="0"
                      max="60"
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
                      value={formData.reminder_stagger_minutes}
                      onChange={(e) => setFormData({ ...formData, reminder_stagger_minutes: e.target.value })}
                    />
                    <span className="mt-1 block text-[10px] text-slate-500">Ex.: Com 2 min, o 1º contrato sai às 20:00, o 2º às 20:02, o 3º às 20:04...</span>
                  </label>
                  <label className="text-xs text-slate-500">
                    Pausa de segurança entre disparos (segundos)
                    <input
                      type="number"
                      min="0"
                      max="30"
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
                      value={formData.reminder_dispatch_delay_seconds}
                      onChange={(e) => setFormData({ ...formData, reminder_dispatch_delay_seconds: e.target.value })}
                    />
                    <span className="mt-1 block text-[10px] text-slate-500">Pausa técnica no servidor entre mensagens na mesma rodada (padrão: 5s).</span>
                  </label>
                </div>
              </div>
            )}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <button type="button" onClick={resetPassword} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"><Key size={16} /> Alterar minha senha</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-accent px-6 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar alterações</button>
          </div>
        </form>
      )}
    </main>
  );
}
