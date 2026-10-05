import React, { useEffect, useState } from 'react';
import { Key, Loader2, Save, Settings, User } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { usuariosService } from '../services/usuarios';
import { supabase } from '../services/supabase';
import ZernioIntegrationCard from '../components/ZernioIntegrationCard';

export default function Configuracoes() {
  const { profile, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({ nome_completo: '', whatsapp: '', access_token_mercado_pago: '' });

  useEffect(() => {
    if (!profile) return;
    setFormData({ nome_completo: profile.nome_completo || '', whatsapp: profile.whatsapp || '', access_token_mercado_pago: '' });
    let mounted = true;
    supabase.functions.invoke('get-secrets').then(({ data, error }) => {
      if (!mounted || error || !data?.success) return;
      setFormData((current) => ({ ...current, access_token_mercado_pago: data.mp_token || '' }));
    }).catch(() => {}).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [profile]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await usuariosService.update(user.id, { nome_completo: formData.nome_completo, whatsapp: formData.whatsapp });
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

  if (loading) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-accent" size={40} /></div>;

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Settings className="text-accent" /> Configurações</h1>
      {profile?.role === 'locador' && <ZernioIntegrationCard />}
      <form onSubmit={save} className="space-y-6 rounded-xl border border-slate-700 bg-card p-6 shadow-lg">
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-400"><User size={16} /> Perfil e pagamentos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-slate-500">Nome completo<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" value={formData.nome_completo} onChange={(event) => setFormData({ ...formData, nome_completo: event.target.value })} /></label>
            <label className="text-xs text-slate-500">WhatsApp de contato<input className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 text-sm text-white outline-none focus:border-accent" value={formData.whatsapp} onChange={(event) => setFormData({ ...formData, whatsapp: event.target.value })} /></label>
          </div>
          <label className="mt-4 block text-xs text-slate-500">Token de acesso do Mercado Pago<input type="password" autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-600 bg-input px-4 py-2 font-mono text-sm text-white outline-none focus:border-accent" value={formData.access_token_mercado_pago} onChange={(event) => setFormData({ ...formData, access_token_mercado_pago: event.target.value })} /></label>
          <p className="mt-2 text-[11px] text-slate-600">A chave da Zernio é configurada separadamente acima e nunca é exibida depois de salva.</p>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <button type="button" onClick={resetPassword} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"><Key size={16} /> Alterar minha senha</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-accent px-6 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar alterações</button>
        </div>
      </form>
    </main>
  );
}
