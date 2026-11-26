import React, { useEffect, useState } from 'react';
import { Bell, Cloud, Key, Loader2, MessageCircle, Save, Settings, User, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { getSegmentPresetList } from '../utils/segmentConfig';
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
  const { profile, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('zernio');
  const [tabTouched, setTabTouched] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secretsLoaded, setSecretsLoaded] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [formData, setFormData] = useState({
    nome_completo: '',
    whatsapp: '',
    empresa_nome: '',
    segmento: 'geral',
    segmento_config: {
      customerSingular: '',
      customerPlural: '',
      itemSingular: '',
      itemPlural: '',
      itemCodeLabel: '',
      itemNameLabel: '',
      usesItems: true,
    },
    access_token_mercado_pago: '',
    reminder_stagger_minutes: 2,
    reminder_dispatch_delay_seconds: 5,
  });

  const isLandlord = profile?.role === 'locador';

  useEffect(() => {
    if (!profile) return;
    const custom = profile.segmento_config || {};
    setFormData((current) => ({
      ...current,
      nome_completo: profile.nome_completo || '',
      whatsapp: profile.whatsapp || '',
      empresa_nome: profile.empresa_nome || '',
      segmento: profile.segmento || 'geral',
      segmento_config: {
        customerSingular: custom.customerSingular || '',
        customerPlural: custom.customerPlural || '',
        itemSingular: custom.itemSingular || '',
        itemPlural: custom.itemPlural || '',
        itemCodeLabel: custom.itemCodeLabel || '',
        itemNameLabel: custom.itemNameLabel || '',
        usesItems: typeof custom.usesItems === 'boolean' ? custom.usesItems : true,
      },
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
    api
      .get('/account/secrets')
      .then((data) => {
        if (!mounted) return;
        if (data?.success) {
          setFormData((current) => ({ ...current, access_token_mercado_pago: data.mp_token || '' }));
        }
        setSecretsLoaded(true);
      })
      .catch(() => {
        if (mounted) setSecretsLoaded(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeTab, secretsLoaded, profile]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put('/account/profile', {
        nome_completo: formData.nome_completo,
        whatsapp: formData.whatsapp,
        empresa_nome: formData.empresa_nome,
        ...(isLandlord
          ? {
            segmento: formData.segmento,
            segmento_config:
              formData.segmento === 'personalizado' ? formData.segmento_config : null,
          }
          : {}),
        reminder_stagger_minutes: Math.max(0, Math.min(60, Number(formData.reminder_stagger_minutes) || 0)),
        reminder_dispatch_delay_seconds: Math.max(0, Math.min(30, Number(formData.reminder_dispatch_delay_seconds) || 0)),
      });
      if (secretsLoaded || formData.access_token_mercado_pago) {
        await api.post('/account/secrets', {
          secretType: 'mp_token',
          value: formData.access_token_mercado_pago || '',
        });
      }
      if (refreshProfile) await refreshProfile();
      toast.success('Configurações salvas.');
    } catch (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    if (passwordForm.new_password.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('A confirmação da nova senha não confere.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.put('/account/profile', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      toast.success('Senha alterada com sucesso.');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setShowPasswordForm(false);
    } catch (error) {
      toast.error(`Não foi possível alterar a senha: ${error.message}`);
    } finally {
      setSavingPassword(false);
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

      {profile?.role === 'admin' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          As integrações de WhatsApp (Zernio e Meta Cloud API) e notificações por e-mail (Resend) são configuradas individualmente por cada conta de <strong>Locador</strong>. Crie ou acesse uma conta de Locador pelo <strong>Painel Admin</strong> para visualizá-las.
        </div>
      )}

      {activeTab === 'conta' && (
        <div className="space-y-6">
          <form onSubmit={save} className="space-y-6 rounded-xl border border-slate-700 bg-card p-6 shadow-lg">
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400"><User size={16} /> Perfil e pagamentos</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-slate-500">Nome completo<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" value={formData.nome_completo} onChange={(event) => setFormData({ ...formData, nome_completo: event.target.value })} /></label>
                <label className="text-xs text-slate-500">WhatsApp de contato<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" value={formData.whatsapp} onChange={(event) => setFormData({ ...formData, whatsapp: event.target.value })} /></label>
                <label className="text-xs text-slate-500 sm:col-span-2">Nome da empresa / negócio<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" placeholder="Ex: Locadora Prime, Espaço Central, Studio XP" value={formData.empresa_nome} onChange={(event) => setFormData({ ...formData, empresa_nome: event.target.value })} /></label>
              </div>
              {isLandlord && (
                <div className="mt-6 border-t border-slate-700/60 pt-6 space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                      Segmento de Atuação
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Adapta automaticamente menus, termos do painel e formulário de triagem ao seu modelo de negócio.
                    </p>
                  </div>
                  <label className="block text-xs text-slate-500">
                    Perfil do negócio
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
                      value={formData.segmento}
                      onChange={(e) => setFormData({ ...formData, segmento: e.target.value })}
                    >
                      {getSegmentPresetList().map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name} — {preset.description}
                        </option>
                      ))}
                    </select>
                  </label>
                  {formData.segmento === 'personalizado' && (
                    <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4 sm:grid-cols-2">
                      <label className="text-xs text-slate-400">
                        Cliente (singular)
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
                          placeholder="Ex: Aluno, Hóspede, Inquilino"
                          value={formData.segmento_config.customerSingular}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, customerSingular: e.target.value } })}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Clientes (plural)
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
                          placeholder="Ex: Alunos, Hóspedes, Inquilinos"
                          value={formData.segmento_config.customerPlural}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, customerPlural: e.target.value } })}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Item / Ativo (singular)
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
                          placeholder="Ex: Sala, Equipamento, Quarto"
                          value={formData.segmento_config.itemSingular}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, itemSingular: e.target.value } })}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Itens / Ativos (plural)
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
                          placeholder="Ex: Salas, Equipamentos, Quartos"
                          value={formData.segmento_config.itemPlural}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, itemPlural: e.target.value } })}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Rótulo do código / identificador
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
                          placeholder="Ex: Nº Série, Unidade, Código"
                          value={formData.segmento_config.itemCodeLabel}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, itemCodeLabel: e.target.value } })}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Rótulo do nome principal
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-3 py-2 text-sm text-white outline-none focus:border-accent"
                          placeholder="Ex: Título, Modelo, Descrição"
                          value={formData.segmento_config.itemNameLabel}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, itemNameLabel: e.target.value } })}
                        />
                      </label>
                      <label className="sm:col-span-2 flex items-center gap-2 text-xs text-slate-300 pt-1">
                        <input
                          type="checkbox"
                          checked={formData.segmento_config.usesItems !== false}
                          onChange={(e) => setFormData({ ...formData, segmento_config: { ...formData.segmento_config, usesItems: e.target.checked } })}
                        />
                        Exibir módulo de cadastro de itens / ativos no menu e dashboard
                      </label>
                    </div>
                  )}
                </div>
              )}
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
              <button
                type="button"
                onClick={() => setShowPasswordForm((open) => !open)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"
              >
                <Key size={16} /> Alterar minha senha
              </button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-accent px-6 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar alterações</button>
            </div>
          </form>

          {showPasswordForm && (
            <form onSubmit={handlePasswordChange} className="space-y-4 rounded-xl border border-slate-700 bg-card p-6 shadow-lg">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400">
                  <Key size={16} /> Alterar minha senha
                </h2>
                <button
                  type="button"
                  onClick={() => setShowPasswordForm(false)}
                  aria-label="Fechar alteração de senha"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-xs text-slate-500">
                  Senha atual
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={passwordForm.current_password}
                    onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Nova senha
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={passwordForm.new_password}
                    onChange={(event) => setPasswordForm({ ...passwordForm, new_password: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Confirmar nova senha
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={passwordForm.confirm_password}
                    onChange={(event) => setPasswordForm({ ...passwordForm, confirm_password: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordForm(false)}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingPassword ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Atualizar senha
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
