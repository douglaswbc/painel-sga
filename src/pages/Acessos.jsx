import React, { useState, useEffect } from 'react';
import { 
  Plus, Edit3, Trash2, ShieldCheck, History, 
  User, Smartphone, Clock, CheckCircle2, XCircle,
  Database, RefreshCw, QrCode, ExternalLink,
  ChevronRight, ArrowUpRight, Lock
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fechadurasService } from '../services/fechaduras';
import { toast } from 'react-toastify';
import FechaduraModal from '../components/FechaduraModal';

const Acessos = () => {
  const { profile } = useAuth();
  const [locks, setLocks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLock, setEditingLock] = useState(null);
  const [activeTab, setActiveTab] = useState('portas'); // 'portas' ou 'logs'

  useEffect(() => {
    if (profile?.id) {
      fetchLocks();
      fetchLogs();
    }
  }, [profile]);

  const fetchLocks = async () => {
    try {
      setLoading(true);
      const data = await fechadurasService.list(profile.id);
      setLocks(data || []);
    } catch (err) {
      toast.error('Erro ao buscar fechaduras');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const data = await fechadurasService.listLogs(profile.id);
      setLogs(data || []);
    } catch (err) {
      console.error('Erro ao buscar logs:', err);
    }
  };

  const deleteLock = async (id) => {
    if (!window.confirm('Excluir esta fechadura? Todos os logs relacionados serão perdidos.')) return;
    try {
      await fechadurasService.remove(id);
      toast.success('Fechadura removida');
      fetchLocks();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const getEventIcon = (event) => {
    switch (event) {
      case 'solicitado': return <Smartphone className="text-zinc-500" size={16} />;
      case 'otp_validado': return <CheckCircle2 className="text-emerald-500" size={16} />;
      case 'aberto': return <ShieldCheck className="text-indigo-500" size={16} />;
      case 'negado': return <XCircle className="text-red-500" size={16} />;
      default: return <History className="text-zinc-400" size={16} />;
    }
  };

  const getEventLabel = (event) => {
    const labels = {
      'solicitado': 'Solicitação no WhatsApp',
      'otp_enviado': 'Código Enviado',
      'otp_validado': 'Código Validado',
      'aberto': 'Porta Aberta',
      'negado': 'Acesso Negado',
      'expirado': 'Token Expirado'
    };
    return labels[event] || event;
  };

  const generateWhatsAppLink = (identificador) => {
    if (!profile?.whatsapp) return '#';
    const text = encodeURIComponent(`Abrir ${identificador}`);
    return `https://wa.me/${profile.whatsapp.replace(/\D/g, '')}?text=${text}`;
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-10">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" /> Controle de Acessos
          </h2>
          <p className="text-sm text-zinc-500 font-medium">Gestão de fechaduras e registros de entrada.</p>
        </div>
        <div className="flex gap-2">
          <button 
             onClick={() => { fetchLocks(); fetchLogs(); }}
             className="p-2.5 bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-all"
             title="Atualizar"
          >
            <RefreshCw size={20} />
          </button>
          <button 
            onClick={() => { setEditingLock(null); setShowModal(true); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
          >
            <Plus size={20} /> Nova Portaria
          </button>
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-1 bg-zinc-900 p-1.5 rounded-2xl w-full sm:w-fit border border-zinc-800">
        <button 
          onClick={() => setActiveTab('portas')}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'portas' ? 'bg-indigo-600 text-white shadow-xl' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Database size={16} /> Portas
        </button>
        <button 
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'logs' ? 'bg-indigo-600 text-white shadow-xl' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <History size={16} /> Histórico
        </button>
      </div>

      {activeTab === 'portas' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full py-20 text-center"><RefreshCw className="animate-spin mx-auto text-indigo-500" size={32} /></div>
          ) : locks.length === 0 ? (
            <div className="col-span-full py-20 text-center bg-zinc-900 rounded-3xl border border-dashed border-zinc-800">
              <ShieldCheck className="mx-auto text-zinc-800 mb-4" size={48} />
              <p className="text-zinc-500 font-bold">Nenhuma fechadura cadastrada.</p>
            </div>
          ) : locks.map((lock) => (
            <div key={lock.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6 group hover:border-indigo-500/50 transition-all shadow-xl">
              <div className="flex justify-between items-start">
                <div className="p-3 bg-zinc-950 rounded-2xl border border-zinc-800">
                  <Lock className="text-indigo-500" size={24} />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => { setEditingLock(lock); setShowModal(true); }} className="p-2 text-zinc-500 hover:text-indigo-400 rounded-lg bg-zinc-950 border border-zinc-800"><Edit3 size={16} /></button>
                  <button onClick={() => deleteLock(lock.id)} className="p-2 text-zinc-500 hover:text-red-500 rounded-lg bg-zinc-950 border border-zinc-800"><Trash2 size={16} /></button>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-black text-white uppercase tracking-tight">{lock.nome}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`w-2 h-2 rounded-full ${lock.status === 'ativo' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">{lock.identificador}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800/50 flex flex-col gap-3">
                 <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 font-bold">QR Code Link</span>
                    <a 
                      href={generateWhatsAppLink(lock.identificador)} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-black"
                    >
                       TESTAR <ArrowUpRight size={14} />
                    </a>
                 </div>
                 <button 
                   onClick={() => {
                     navigator.clipboard.writeText(generateWhatsAppLink(lock.identificador));
                     toast.info('Link do QR Code copiado!');
                   }}
                   className="w-full bg-zinc-950 border border-zinc-800 hover:border-indigo-500/50 text-zinc-300 py-3 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all"
                 >
                   <QrCode size={16} className="text-indigo-500" /> Copiar Link p/ QR Code
                 </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] uppercase bg-zinc-950/50 text-zinc-500 border-b border-zinc-800 font-black tracking-[0.1em]">
                <tr>
                  <th className="px-6 py-4">Evento</th>
                  <th className="px-6 py-4">Usuário / WhatsApp</th>
                  <th className="px-6 py-4">Porta</th>
                  <th className="px-6 py-4">Data / Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {logs.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-20 text-center text-zinc-500 font-bold italic">Nenhum evento registrado ainda.</td></tr>
                ) : logs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-zinc-950 border border-zinc-800 rounded-lg">
                          {getEventIcon(log.evento)}
                        </div>
                        <span className="font-bold text-zinc-100">{getEventLabel(log.evento)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-zinc-300">{log.locatarios?.nome_completo || 'Identificando...'}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">+{log.whatsapp}</div>
                    </td>
                    <td className="px-6 py-4 font-black text-indigo-400 uppercase text-xs">
                      {log.fechaduras?.nome}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-zinc-400 text-xs font-mono">
                        <Clock size={12} /> {new Date(log.timestamp).toLocaleString('pt-BR')}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL */}
      <FechaduraModal 
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingLock(null); }}
        fechadura={editingLock}
        profile={profile}
        onSuccess={fetchLocks}
      />
    </div>
  );
};

export default Acessos;
