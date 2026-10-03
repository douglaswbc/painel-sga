import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usuariosService } from '../services/usuarios';
import { supabase } from '../services/supabase';
import ZernioIntegrationCard from '../components/ZernioIntegrationCard';
import { toast } from 'react-toastify';
import { 
  Settings, User, Key, Link, 
  QrCode, LogOut, RefreshCw, Loader2,
  ShieldCheck, Copy, Check, Plus, Zap
} from 'lucide-react';

const Configuracoes = () => {
  const { profile, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connLoading, setConnLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [connectionState, setConnectionState] = useState('desconhecido');
  const [qrCode, setQrCode] = useState({ image: '', code: '', visible: false });
  const [displayStatus, setDisplayStatus] = useState('');
  const [newInstanceName, setNewInstanceName] = useState('');
  const [copiedField, setCopiedField] = useState(null);
  const warmUpSentRef = useRef(false);

  const [formData, setFormData] = useState({
    nome_completo: '',
    whatsapp: '',
    access_token_mercado_pago: '',
    ryze_instance: ''
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        nome_completo: profile.nome_completo || '',
        whatsapp: profile.whatsapp || '',
        access_token_mercado_pago: profile.access_token_mercado_pago || '',
        ryze_instance: profile.ryze_instance || ''
      });
      loadSecrets();
      setLoading(false);
    }
  }, [profile]);

  const loadSecrets = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-secrets');
      if (!error && data?.success) {
        setFormData(prev => ({
          ...prev,
          access_token_mercado_pago: data.mp_token || prev.access_token_mercado_pago
        }));
      }
    } catch {}
  };

  const checkConnection = useCallback(async (showToast = false) => {
    if (!formData.ryze_instance) return;

    try {
      const { data, error } = await supabase.functions.invoke('instance-status', {
        body: { instanceName: formData.ryze_instance }
      });

      if (error) throw error;

      const prevState = connectionState;
      const state = data?.state || 'disconnected';
      setConnectionState(state);
      setDisplayStatus(data?.displayStatus || '');

      if (state === 'connected') {
        setQrCode(prev => ({ ...prev, visible: false }));
        if (showToast) toast.success("WhatsApp conectado!");

        if (prevState !== 'connected' && !warmUpSentRef.current && data?.numberJid) {
          warmUpSentRef.current = true;
          const ownNumber = data.numberJid.split('@')[0];
          supabase.functions.invoke('ryze-proxy', {
            body: {
              action: 'sendText',
              instanceName: formData.ryze_instance,
              payload: { number: ownNumber, message: '\uD83D\uDD12 *Sessão ativada com sucesso!*', delay: 1200 }
            }
          }).catch(() => {});
        }
      }
      return state;
    } catch (error) {
      setConnectionState('erro');
      console.error("Erro na Evolution API:", error);
    }
  }, [formData, connectionState]);

  useEffect(() => {
    let interval;
    if (qrCode.visible && connectionState !== 'connected') {
      interval = setInterval(() => checkConnection(), 5000);
    }
    return () => clearInterval(interval);
  }, [qrCode.visible, connectionState, checkConnection]);

  useEffect(() => {
    if (formData.ryze_instance) {
      checkConnection();
    }
  }, [formData.ryze_instance]);

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await usuariosService.update(user.id, {
        nome_completo: formData.nome_completo,
        whatsapp: formData.whatsapp
      });

      if (formData.access_token_mercado_pago) {
        await supabase.functions.invoke('save-secret', {
          body: { secretType: 'mp_token', value: formData.access_token_mercado_pago }
        });
      }

      toast.success("Configurações salvas!");
    } catch (error) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) {
      toast.error("Informe um nome para a instância.");
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-instance', {
        body: { 
          instanceName: newInstanceName.trim().toLowerCase().replace(/\s+/g, '_'),
          userId: user.id
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setFormData(prev => ({
        ...prev,
        ryze_instance: data.instance
      }));

      toast.success("Instância criada com sucesso!");
      setNewInstanceName('');
    } catch (error) {
      toast.error("Erro ao criar instância: " + error.message);
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Erro ao copiar");
    }
  };

  const handleGenerateQR = async () => {
    setConnLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ryze-proxy', {
        body: { action: 'connect', instanceName: formData.ryze_instance }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.data?.message || "Erro ao gerar QR Code");

      const result = data.data;
      if (result.base64) {
        const imageSrc = result.base64.startsWith('data:image') 
          ? result.base64 
          : `data:image/png;base64,${result.base64}`;
        setQrCode({ image: imageSrc, code: result.code || '', visible: true });
        toast.info("QR Code gerado. Escaneie no seu WhatsApp.");
      } else if (result.qrcode) {
        const imageSrc = result.qrcode.startsWith('data:image')
          ? result.qrcode
          : `data:image/png;base64,${result.qrcode}`;
        setQrCode({ image: imageSrc, code: result.pairingCode || '', visible: true });
        toast.info("QR Code gerado. Escaneie no seu WhatsApp.");
      } else if (result.qrCodeBase64) {
        const imageSrc = result.qrCodeBase64.startsWith('data:image') 
          ? result.qrCodeBase64 
          : `data:image/png;base64,${result.qrCodeBase64}`;
        setQrCode({ image: imageSrc, code: result.qrCode || '', visible: true });
        toast.info("QR Code gerado. Escaneie no seu WhatsApp.");
      } else {
        toast.error("Formato de QR Code não reconhecido.");
      }
    } catch (error) {
      toast.error("Erro ao gerar QR Code: " + error.message);
    } finally {
      setConnLoading(false);
    }
  };

  const handleReconnect = async () => {
    setConnLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ryze-proxy', {
        body: { action: 'reconnect', instanceName: formData.ryze_instance }
      });

      if (error) throw error;
      if (data?.success) {
        toast.info("Reconexão iniciada.");
      } else {
        toast.error("Erro ao reconectar instância");
      }
    } catch (error) {
      toast.error("Erro ao reconectar: " + error.message);
    } finally {
      setConnLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Deseja desconectar o WhatsApp?")) return;
    setConnLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ryze-proxy', {
        body: { action: 'logout', instanceName: formData.ryze_instance }
      });

      if (error) throw error;
      if (data?.success) {
        setConnectionState('disconnected');
        setQrCode({ image: '', code: '', visible: false });
        toast.warning("Instância desconectada.");
      } else {
        toast.error("Erro ao desconectar");
      }
    } catch (error) {
      toast.error("Erro ao desconectar: " + error.message);
    } finally {
      setConnLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!window.confirm("Enviar e-mail de recuperação de senha?")) return;
    try {
      await usuariosService.resetPassword(user.email, `${window.location.origin}/login`);
      toast.success("E-mail enviado!");
    } catch (error) {
      toast.error("Erro: " + error.message);
    }
  };

  const getConnectionLabel = () => {
    if (connectionState === 'connected') return `Conectado${displayStatus ? ` - ${displayStatus}` : ''}`;
    if (connectionState === 'desconhecido') return 'Verificando...';
    if (connectionState === 'erro') return 'Erro de Conexão';
    return 'Desconectado';
  };

  const getConnectionColor = () => {
    if (connectionState === 'connected') return 'text-emerald-400';
    if (connectionState === 'desconhecido') return 'text-slate-400';
    return 'text-red-400';
  };

  if (loading) return <div className="flex p-20 justify-center"><Loader2 className="animate-spin text-accent" size={40} /></div>;

  const hasInstance = !!formData.ryze_instance;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Settings className="text-accent" /> Configurações do Sistema
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-2 space-y-6">
          {profile?.role === 'locador' && <ZernioIntegrationCard />}
          <form onSubmit={handleSaveConfig} className="bg-card border border-slate-700 rounded-xl p-6 shadow-lg space-y-6">
            <section>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <User size={16} /> Perfil e Pagamentos
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Nome Completo</label>
                  <input 
                    className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none focus:border-accent"
                    value={formData.nome_completo}
                    onChange={e => setFormData({...formData, nome_completo: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">WhatsApp de Contato</label>
                  <input 
                    className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none focus:border-accent"
                    value={formData.whatsapp}
                    onChange={e => setFormData({...formData, whatsapp: e.target.value})}
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-xs text-slate-500 mb-1">Mercado Pago Access Token</label>
                <input 
                  type="password"
                  className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none focus:border-accent font-mono text-sm"
                  value={formData.access_token_mercado_pago}
                  onChange={e => setFormData({...formData, access_token_mercado_pago: e.target.value})}
                />
              </div>
            </section>

            <section className="pt-6 border-t border-slate-800">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Link size={16} /> Evolution API (WhatsApp)
              </h3>

              {!hasInstance ? (
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Zap className="text-indigo-400" size={20} />
                    <span className="text-indigo-300 font-bold text-sm">Criar Nova Instância</span>
                  </div>
                  <p className="text-slate-400 text-xs">Crie sua instância WhatsApp para começar a enviar e receber mensagens automaticamente.</p>
                  <div className="flex items-center gap-3">
                    <input
                      placeholder="Nome da instância (ex: matriz)"
                      className="flex-1 bg-input border border-slate-600 rounded-lg px-4 py-2.5 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                      value={newInstanceName}
                      onChange={e => setNewInstanceName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateInstance()}
                    />
                    <button
                      type="button"
                      disabled={creating || !newInstanceName.trim()}
                      onClick={handleCreateInstance}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all whitespace-nowrap"
                    >
                      {creating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                      Criar Instância
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Nome da Instância</label>
                    <div className="flex items-center gap-2">
                      <input 
                        className="flex-1 bg-input border border-slate-600 rounded-lg px-4 py-2 text-emerald-300 outline-none focus:border-accent font-mono text-sm"
                        value={formData.ryze_instance}
                        readOnly
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(formData.ryze_instance, 'instance')}
                        className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-all"
                        title="Copiar nome da instância"
                      >
                        {copiedField === 'instance' ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <div className="flex justify-between items-center pt-4">
              <button 
                type="button" 
                onClick={handleResetPassword}
                className="text-slate-400 hover:text-white text-sm flex items-center gap-2 transition-colors"
              >
                <Key size={16} /> Alterar Minha Senha
              </button>
              <button 
                type="submit" 
                disabled={saving}
                className="bg-accent hover:bg-indigo-700 text-white px-8 py-2 rounded-lg font-bold flex items-center gap-2 transition-all"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          {hasInstance ? (
            <>
              <div className="bg-card border border-slate-700 rounded-xl p-6 shadow-lg">
                <h3 className="text-sm font-bold text-slate-400 uppercase mb-4">Conexão WhatsApp</h3>
                
                <div className="flex items-center justify-between mb-6 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Status Atual</span>
                    <span className={`text-lg font-black uppercase ${getConnectionColor()}`}>
                      {getConnectionLabel()}
                    </span>
                  </div>
                  <button 
                    onClick={() => checkConnection(true)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-all"
                    title="Atualizar Status"
                  >
                    <RefreshCw size={20} />
                  </button>
                </div>

                {connectionState !== 'connected' ? (
                  <div className="space-y-3">
                    <button 
                      onClick={handleGenerateQR}
                      disabled={connLoading}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/10"
                    >
                      {connLoading ? <Loader2 className="animate-spin" size={20} /> : <QrCode size={20} />}
                      Gerar QR Code
                    </button>
                    <button 
                      onClick={handleReconnect}
                      disabled={connLoading}
                      className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      {connLoading ? <Loader2 className="animate-spin" size={20} /> : <RefreshCw size={20} />}
                      Reconectar Instância
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleDisconnect}
                    disabled={connLoading}
                    className="w-full bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all border border-red-500/20"
                  >
                    {connLoading ? <Loader2 className="animate-spin" size={20} /> : <LogOut size={20} />}
                    Desconectar Instância
                  </button>
                )}

                {qrCode.visible && (
                  <div className="mt-8 p-6 bg-white rounded-2xl flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300">
                    <p className="text-zinc-900 font-bold text-sm">Escaneie com o WhatsApp</p>
                    <img src={qrCode.image} alt="QR Code WhatsApp" className="w-48 h-48 rounded-lg shadow-inner" />
                    {qrCode.code && (
                      <div className="w-full bg-zinc-100 p-3 rounded-lg border border-zinc-200">
                        <p className="text-[10px] text-zinc-500 font-bold uppercase text-center mb-1 tracking-tighter">Código de Emparelhamento</p>
                        <code className="block text-center text-zinc-800 font-black text-xl tracking-widest">{qrCode.code}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-card border border-slate-700 rounded-xl p-6 shadow-lg flex flex-col items-center justify-center text-center space-y-4 min-h-[200px]">
              <div className="p-4 bg-slate-800/50 rounded-full">
                <Zap className="text-slate-500" size={32} />
              </div>
              <div>
                <p className="text-slate-400 font-bold text-sm">Nenhuma instância configurada</p>
                <p className="text-slate-600 text-xs mt-1">Crie uma instância WhatsApp para gerenciar sua conexão.</p>
              </div>
            </div>
          )}

          <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex items-start gap-3">
            <ShieldCheck className="text-emerald-500 shrink-0" size={20} />
            <p className="text-[11px] text-emerald-200/70 leading-relaxed">
              As suas credenciais de API são criptografadas e utilizadas apenas para automatizar as suas cobranças. 
              Mantenha o seu token do Mercado Pago atualizado para evitar falhas no checkout.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Configuracoes;
