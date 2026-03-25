import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { 
  Save, Loader2, MessageSquareQuote, Info, 
  Plus, Trash2, LayoutGrid, Megaphone, 
  ChevronUp, ChevronDown, AlertCircle
} from 'lucide-react';
import { toast } from 'react-toastify';

const Mensagens = () => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [activeTab, setActiveTab] = useState('cobranca'); // 'cobranca' ou 'avulso'

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mensagens_template')
        .select('*')
        .eq('id_usuario', profile.id)
        .order('ordem', { ascending: true });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      toast.error("Erro ao carregar modelos de mensagem");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.id) fetchTemplates();
  }, [profile]);

  // Filtra templates pelo tipo da aba ativa
  const filteredTemplates = templates.filter(t => (t.tipo || 'cobranca') === activeTab);

  const handleAddMessage = () => {
    const nextOrdem = activeTab === 'cobranca' 
      ? Math.max(0, ...templates.filter(t => t.tipo === 'cobranca').map(t => t.ordem)) + 1
      : templates.length + 1;

    const newMessage = {
      id_usuario: profile.id,
      tipo: activeTab,
      ordem: nextOrdem,
      titulo: activeTab === 'cobranca' ? `${nextOrdem}º Lembrete` : 'Novo Modelo Avulso',
      conteudo: '',
      isNew: true // Marcador local para sabermos que ainda não está no banco
    };

    setTemplates([...templates, newMessage]);
  };

  const handleDeleteMessage = async (templateToDelete) => {
    if (!templateToDelete.id && templateToDelete.isNew) {
      // Remove do estado local se for novo
      setTemplates(templates.filter(t => t !== templateToDelete));
      return;
    }

    if (!window.confirm("Tem certeza que deseja excluir este modelo?")) return;

    try {
      setSaving(true);
      // Delete do banco
      const { error } = await supabase
        .from('mensagens_template')
        .delete()
        .eq('id', templateToDelete.id);

      if (error) throw error;

      // Reordenar as mensagens subsequentes se for do tipo cobranca
      if (activeTab === 'cobranca') {
        const remaining = templates
          .filter(t => t.tipo === 'cobranca' && t.id !== templateToDelete.id)
          .sort((a, b) => a.ordem - b.ordem);

        const reordered = remaining.map((t, idx) => ({
          ...t,
          ordem: idx + 1,
          titulo: `${idx + 1}º Lembrete`
        }));

        // Atualiza o banco com as novas ordens
        if (reordered.length > 0) {
          const { error: updateError } = await supabase
            .from('mensagens_template')
            .upsert(reordered.map(t => {
              const clean = { 
                id_usuario: profile.id, 
                ordem: t.ordem, 
                titulo: t.titulo, 
                tipo: 'cobranca', 
                conteudo: t.conteudo 
              };
              if (t.id) clean.id = t.id;
              return clean;
            }));
          
          if (updateError) throw updateError;
        }
      }

      toast.success("Modelo removido e régua reordenada!");
      fetchTemplates();
    } catch (error) {
      toast.error("Erro ao excluir: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const templatesToSave = templates.map(t => {
        const clean = {
          id_usuario: profile.id,
          ordem: t.ordem || 0,
          titulo: t.titulo || '',
          conteudo: t.conteudo || '',
          tipo: t.tipo || 'cobranca'
        };
        
        // Se já tem ID, usa o existente. Se não tem, gera um novo UUID no frontend
        // Isso resolve o problema de arrays heterogêneos no upsert do PostgREST
        if (t.id && typeof t.id === 'string' && t.id.length > 0) {
          clean.id = t.id;
        } else {
          clean.id = crypto.randomUUID();
        }
        
        return clean;
      });

      const { error } = await supabase
        .from('mensagens_template')
        .upsert(templatesToSave);

      if (error) throw error;
      toast.success("Alterações salvas com sucesso!");
      fetchTemplates();
    } catch (error) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 rounded-xl">
              <MessageSquareQuote className="text-indigo-500" size={24} />
            </div>
            Modelos de Mensagem
          </h1>
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-1">
            Gestão inteligente de notificações WhatsApp
          </p>
        </div>
        <div className="flex items-center gap-3">
            <button
              onClick={handleAddMessage}
              className="bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-2.5 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center gap-2 transition-all border border-zinc-800 shadow-xl"
            >
              <Plus size={16} className="text-indigo-500" />
              Adicionar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar
            </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-zinc-950/50 border border-zinc-900 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('cobranca')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'cobranca' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <LayoutGrid size={14} />
          Régua de Cobrança
        </button>
        <button
          onClick={() => setActiveTab('avulso')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'avulso' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Megaphone size={14} />
          Mensagens Avulsas
        </button>
      </div>

      {/* Info Alert */}
      {activeTab === 'cobranca' && (
        <div className="bg-indigo-500/5 border border-indigo-500/10 p-4 rounded-2xl flex items-start gap-4">
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <Info className="text-indigo-500 shrink-0" size={18} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-indigo-200/80 leading-relaxed uppercase tracking-tight">
               Sistema de Régua Dinâmica
            </p>
            <p className="text-[10px] text-indigo-300/60 mt-0.5 leading-relaxed">
               As mensagens acima serão enviadas automaticamente seguindo a ordem (1º, 2º...). 
               O intervalo entre elas é calculado dividindo a validade do PIX pelo total de mensagens cadastradas aqui.
            </p>
          </div>
        </div>
      )}

      {/* Listagem */}
      <div className="grid gap-6">
        {filteredTemplates.length === 0 ? (
          <div className="bg-zinc-950/50 border-2 border-dashed border-zinc-900 rounded-3xl p-12 text-center">
             <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-zinc-700" size={32} />
             </div>
             <p className="text-zinc-500 font-black text-xs uppercase tracking-widest">Nenhuma mensagem cadastrada</p>
             <button onClick={handleAddMessage} className="mt-4 text-indigo-500 text-[10px] font-black uppercase tracking-tighter hover:underline">
               Clique para criar a primeira
             </button>
          </div>
        ) : (
          filteredTemplates.map((template, index) => (
            <div key={template.id || index} className="group bg-zinc-900/40 border border-zinc-800/50 hover:border-indigo-500/30 rounded-3xl p-6 transition-all hover:bg-zinc-900/60 shadow-xl overflow-hidden relative">
              
              {/* Ordem Badge p/ Cobrança */}
              {activeTab === 'cobranca' && (
                <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none">
                  <div className="absolute top-[-30px] right-[-30px] w-20 h-20 bg-indigo-500/10 rotate-45" />
                  <span className="absolute top-2 right-4 text-[24px] font-black text-white/5">{template.ordem}</span>
                </div>
              )}

              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <input 
                      className="w-full bg-transparent border-none outline-none text-white font-black text-sm uppercase tracking-tight placeholder:text-zinc-700"
                      value={template.titulo}
                      placeholder="Título da Mensagem..."
                      onChange={(e) => {
                        const updated = [...templates];
                        const idx = templates.findIndex(t => t === template);
                        updated[idx].titulo = e.target.value;
                        setTemplates(updated);
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleDeleteMessage(template)}
                      className="p-2 hover:bg-red-500/10 text-zinc-600 hover:text-red-500 rounded-xl transition-all"
                      title="Excluir Modelo"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-2xl p-5 text-zinc-300 text-xs font-medium focus:border-indigo-500/50 outline-none min-h-[140px] transition-all scrollbar-hide"
                    placeholder="Sua mensagem começa aqui..."
                    value={template.conteudo}
                    onChange={(e) => {
                      const updated = [...templates];
                      const idx = templates.findIndex(t => t === template);
                      updated[idx].conteudo = e.target.value;
                      setTemplates(updated);
                    }}
                  />
                  
                  {/* Dica de Variáveis */}
                  <div className="mt-3 flex items-center gap-3">
                     <span className="text-[9px] font-black text-zinc-600 uppercase">Tags úteis:</span>
                     <div className="flex gap-2">
                        {['{valor}', '{vencimento}', '{nome}'].map(tag => (
                          <span key={tag} className="px-2 py-0.5 bg-zinc-950 border border-zinc-800 rounded-md text-[9px] font-mono text-indigo-400/70">{tag}</span>
                        ))}
                     </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Floating Save Button Mobile? */}
      {templates.some(t => t.isNew) && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4">
           <button
             onClick={handleSave}
             className="bg-indigo-600 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest shadow-2xl flex items-center gap-3 hover:scale-105 active:scale-95 transition-all"
           >
             <Save size={18} />
             Salvar Alterações Pendentes
           </button>
        </div>
      )}
    </div>
  );
};

export default Mensagens;