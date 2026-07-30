import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { mensagensService } from '../services/mensagens';
import { locatariosService } from '../services/locatarios';
import { 
  Save, Loader2, MessageSquareQuote, Info, 
  Plus, Trash2, LayoutGrid, Megaphone, 
  AlertCircle, Paperclip, X, FileUp, Image, FileText, Video, CalendarClock, ChevronRight, ArrowLeft, Search
} from 'lucide-react';
import { toast } from 'react-toastify';
import AgendamentoModal from '../components/AgendamentoModal';

const Mensagens = () => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [activeTab, setActiveTab] = useState('cobranca'); // 'cobranca', 'avulso' ou 'agendamentos'
  const [locatarios, setLocatarios] = useState([]);
  const [locatarioSearch, setLocatarioSearch] = useState('');
  
  // Controle de Master-Detail
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [selectedLocatario, setSelectedLocatario] = useState(null);
  const [isMobileListOpen, setIsMobileListOpen] = useState(true);
  
  const [isAgendamentoModalOpen, setIsAgendamentoModalOpen] = useState(false);
  const [agendamentoMode, setAgendamentoMode] = useState('template');

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await mensagensService.listTemplates(profile.id);
      setTemplates(data || []);
      
      const activeData = (data || []).filter(t => (t.tipo || 'cobranca') === activeTab);
      if (activeData.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(activeData[0].id);
      }
    } catch (error) {
      toast.error("Erro ao carregar modelos de mensagem");
    } finally {
      setLoading(false);
    }
  };

  const fetchLocatarios = async () => {
    try {
      setLoading(true);
      const data = await locatariosService.listWithAgendamentos(profile.id);
      setLocatarios(data || []);
    } catch (error) {
      toast.error("Erro ao carregar locatários");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.id) {
      fetchTemplates();
      fetchLocatarios();
    }
  }, [profile]);

  const filteredTemplates = templates.filter(t => (t.tipo || 'cobranca') === activeTab);
  
  useEffect(() => {
    if (activeTab === 'agendamentos') return;
    if (filteredTemplates.length > 0) {
      const exists = filteredTemplates.find(t => t.id === selectedTemplateId);
      if (!exists) {
        setSelectedTemplateId(filteredTemplates[0].id);
      }
    } else {
      setSelectedTemplateId(null);
    }
  }, [activeTab, templates.length]);

  const selectedTemplate = filteredTemplates.find(t => t.id === selectedTemplateId) || null;

  const handleOpenAgendamento = (mode, target) => {
    setAgendamentoMode(mode);
    if (mode === 'template') {
      setSelectedTemplateId(target.id);
    } else {
      setSelectedLocatario(target);
    }
    setIsAgendamentoModalOpen(true);
  };

  const handleAddMessage = () => {
  const templatesDoTipo = templates.filter(t => (t.tipo || 'cobranca') === activeTab);

  const nextOrdem = Math.max(
    0,
    ...templatesDoTipo.map(t => t.ordem || 0)
  ) + 1;

  const newId = crypto.randomUUID();

  const newMessage = {
    id: newId,
    id_usuario: profile.id,
    tipo: activeTab,
    ordem: nextOrdem,
    titulo:
      activeTab === 'cobranca'
        ? `${nextOrdem}º Lembrete`
        : `Modelo ${nextOrdem}`,
    conteudo: '',
    isNew: true
  };

  setTemplates([...templates, newMessage]);
  setSelectedTemplateId(newId);
  setIsMobileListOpen(false);
  };

  const handleDeleteMessage = async (templateToDelete) => {
    if (!templateToDelete) return;
    
    if (templateToDelete.isNew) {
      setTemplates(templates.filter(t => t.id !== templateToDelete.id));
      return;
    }

    if (!window.confirm("Tem certeza que deseja excluir este modelo?")) return;

    try {
      setSaving(true);
      await mensagensService.removeTemplate(templateToDelete.id);

      if (activeTab === 'cobranca') {
        const remaining = templates
          .filter(t => t.tipo === 'cobranca' && t.id !== templateToDelete.id)
          .sort((a, b) => a.ordem - b.ordem);

        const reordered = remaining.map((t, idx) => ({
          ...t,
          ordem: idx + 1,
          titulo: `${idx + 1}º Lembrete`
        }));

        for (const item of reordered) {
          if (!item.id) continue;
          await mensagensService.updateTemplate(item.id, { ordem: item.ordem, titulo: item.titulo });
        }
      }
      toast.success("Modelo removido com sucesso!");
      setIsMobileListOpen(true);
      fetchTemplates();
    } catch (error) {
      toast.error("Erro ao excluir: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadMedia = async (template, file) => {
    if (!file) return;

    try {
      setSaving(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile.id}/${crypto.randomUUID()}.${fileExt}`;

      await mensagensService.uploadMedia(fileName, file);

      if (template.media_url) {
        const oldPath = template.media_url.split('/mensagens-midia/').pop();
        if (oldPath) {
          try { await mensagensService.removeMedia(oldPath); } catch {}
        }
      }

      const publicUrl = mensagensService.getMediaPublicUrl(fileName);

      let mediatype = 'document';
      if (file.type.startsWith('image/')) mediatype = 'image';
      else if (file.type.startsWith('video/')) mediatype = 'video';

      const updated = [...templates];
      const idx = updated.findIndex(t => t.id === template.id);
      if (idx === -1) throw new Error("Template não encontrado");

      const mediaData = {
        media_url: publicUrl,
        media_type: mediatype,
        media_mimetype: file.type,
        media_filename: file.name
      };

      updated[idx] = { ...updated[idx], ...mediaData };
      setTemplates(updated);

      await mensagensService.upsertTemplate({
        id: template.id,
        id_usuario: profile.id,
        ordem: template.ordem || 1,
        titulo: template.titulo || '',
        conteudo: template.conteudo || '',
        tipo: template.tipo || activeTab,
        ...mediaData
      });

      toast.success("Mídia anexada com sucesso!");
    } catch (error) {
      toast.error("Erro no upload: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMedia = async (template) => {
    const updated = [...templates];
    const idx = templates.findIndex(t => t.id === template.id);
    updated[idx] = {
      ...updated[idx],
      media_url: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null
    };

    if (template.media_url) {
      const path = template.media_url.split('/mensagens-midia/').pop();
      if (path) {
        mensagensService.removeMedia(path).catch(() => {});
      }
    }

    setTemplates(updated);

    try {
      await mensagensService.upsertTemplate({
        id: template.id,
        id_usuario: profile.id,
        ordem: template.ordem || 1,
        titulo: template.titulo || '',
        conteudo: template.conteudo || '',
        tipo: template.tipo || activeTab,
        media_url: null,
        media_type: null,
        media_mimetype: null,
        media_filename: null
      });
    } catch (e) {
      toast.error("Erro ao remover mídia do banco");
    }
  };

  const updateTemplateContent = (id, field, value) => {
    const updated = [...templates];
    const idx = templates.findIndex(t => t.id === id);
    if (idx !== -1) {
      updated[idx][field] = value;
      setTemplates(updated);
    }
  };

const handleSave = async () => {
  setSaving(true);

  try {
    // 🔥 AGRUPAR POR TIPO
    const tipos = ['cobranca', 'avulso'];

    let finalTemplates = [];

    tipos.forEach(tipo => {
      const grupo = templates
        .filter(t => (t.tipo || 'cobranca') === tipo)
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

      // 🔥 REORDENAR GARANTINDO ORDEM ÚNICA
      const normalizados = grupo.map((t, index) => ({
        ...t,
        ordem: index + 1
      }));

      finalTemplates = [...finalTemplates, ...normalizados];
    });

    // 🔥 MONTAR PAYLOAD LIMPO
    const templatesToSave = finalTemplates.map(t => {
      const clean = {
        id_usuario: profile.id,
        ordem: t.ordem,
        titulo: t.titulo || '',
        conteudo: t.conteudo || '',
        tipo: t.tipo || 'cobranca',
        media_url: t.media_url || null,
        media_type: t.media_type || null,
        media_mimetype: t.media_mimetype || null,
        media_filename: t.media_filename || null
      };

      if (t.id && !t.isNew) {
        clean.id = t.id;
      } else {
        clean.id = t.id;
      }

      return clean;
    });

    await mensagensService.upsertTemplates(templatesToSave);

    toast.success("Alterações salvas com sucesso!");
    fetchTemplates();

  } catch (error) {
    toast.error("Erro ao salvar: " + error.message);
  } finally {
    setSaving(false);
  }
};

  if (loading && templates.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 flex flex-col h-[calc(100vh-80px)]">
      {/* Header Fixo no Topo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
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
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar Banco Central
            </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-zinc-950/50 border border-zinc-900 rounded-2xl w-fit shrink-0">
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
        <button
          onClick={() => setActiveTab('agendamentos')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'agendamentos' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <CalendarClock size={14} />
          Agendamentos Ativos
        </button>
      </div>

      {/* Main Área Dividida (Master/Detail) */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-[500px]">
        
        {activeTab === 'agendamentos' ? (
          <div className="w-full bg-zinc-900/40 border border-zinc-800/50 rounded-3xl p-6 shadow-xl flex flex-col gap-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="max-w-sm w-full relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input 
                  type="text" 
                  placeholder="Buscar locatário..." 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-sm text-white outline-none focus:border-indigo-500 transition-all"
                  value={locatarioSearch}
                  onChange={e => setLocatarioSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest bg-zinc-950/50 px-4 py-2 rounded-xl border border-zinc-800">
                <Info size={14} className="text-indigo-500" />
                Gerencie as mensagens agendadas para seus locatários
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-2 scrollbar-thin">
              {locatarios
                .filter(l => l.nome_completo.toLowerCase().includes(locatarioSearch.toLowerCase()))
                .filter(l => (l.agendamentos_mensagens?.length || 0) > 0)
                .map(loc => {
                  const activeCount = loc.agendamentos_mensagens?.filter(a => a.ativo).length || 0;
                  return (
                    <div key={loc.id} className="bg-zinc-950 border border-zinc-800 p-5 rounded-3xl flex flex-col justify-between gap-4 group hover:border-indigo-500/30 transition-all">
                      <div>
                        <h4 className="text-sm font-black text-white uppercase truncate">{loc.nome_completo}</h4>
                        <p className="text-[10px] text-zinc-500 font-mono mt-1">{loc.whatsapp}</p>
                        
                        <div className="mt-4 flex items-center gap-2">
                           <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${activeCount > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-900 text-zinc-600'}`}>
                             {activeCount} {activeCount === 1 ? 'Mensagem' : 'Mensagens'}
                           </div>
                        </div>
                      </div>

                      <button 
                        onClick={() => handleOpenAgendamento('locatario', loc)}
                        className="w-full bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border border-indigo-500/20"
                      >
                        Gerenciar Agendamentos
                      </button>
                    </div>
                  );
                })}
              {locatarios.filter(l => (l.agendamentos_mensagens?.length || 0) > 0).length === 0 && (
                <div className="col-span-full py-20 text-center">
                   <AlertCircle size={48} className="text-zinc-800 mx-auto mb-4" />
                   <p className="text-zinc-600 font-black text-xs uppercase tracking-widest">Nenhum agendamento ativo encontrado</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Esquerda: Navegação (Master) */}
            <div className={`w-full lg:w-[320px] shrink-0 bg-zinc-900/40 border border-zinc-800/50 rounded-3xl p-4 flex-col gap-4 shadow-xl ${isMobileListOpen ? 'flex' : 'hidden lg:flex'}`}>
              <button
                onClick={handleAddMessage}
                className="w-full bg-zinc-950 hover:bg-zinc-900 text-white border border-zinc-800 hover:border-indigo-500/50 px-5 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shrink-0"
              >
                <Plus size={16} className="text-indigo-500" />
                Novo Template
              </button>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                {filteredTemplates.length === 0 ? (
                  <div className="text-center p-6 mt-10">
                    <AlertCircle size={32} className="text-zinc-700 mx-auto mb-3" />
                    <p className="text-zinc-600 text-[10px] uppercase font-bold tracking-widest">Nada para listar</p>
                  </div>
                ) : (
                  filteredTemplates.map(t => {
                    const isActive = selectedTemplateId === t.id;
                    const recvCount = t.agendamentos_mensagens?.filter(a => a.ativo).length || 0;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setSelectedTemplateId(t.id); setIsMobileListOpen(false); }}
                        className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between group ${
                          isActive 
                            ? 'bg-indigo-600/10 border-indigo-500/30' 
                            : 'bg-zinc-950 border-zinc-900 hover:border-zinc-700'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                            <p className={`text-xs font-black truncate uppercase tracking-tight ${isActive ? 'text-indigo-400' : 'text-zinc-300 group-hover:text-white'}`}>
                              {activeTab === 'cobranca' ? <span className="mr-1 text-[10px] opacity-50">#{t.ordem}</span> : null}
                              {t.titulo || 'Sem Título'}
                            </p>
                            
                            <div className="flex items-center gap-2 mt-1.5">
                              {t.isNew && <span className="text-[8px] bg-emerald-500/20 text-emerald-500 px-1.5 py-0.5 rounded uppercase font-black tracking-widest">Novo</span>}
                              {t.media_url && <Paperclip size={10} className="text-zinc-500" />}
                              {recvCount > 0 && <span className="text-[9px] text-emerald-500 font-bold flex items-center gap-1"><CalendarClock size={10}/> {recvCount}</span>}
                            </div>
                        </div>
                        <ChevronRight size={16} className={`${isActive ? 'text-indigo-500' : 'text-zinc-700 opacity-0 group-hover:opacity-100'} shrink-0 transition-opacity`} />
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Direita: Editor (Detail) */}
            <div className={`flex-1 bg-zinc-900/40 border border-zinc-800/50 rounded-3xl p-6 md:p-8 flex-col shadow-xl min-h-0 overflow-y-auto ${!isMobileListOpen ? 'flex' : 'hidden lg:flex'}`}>
              {!selectedTemplate ? (
                <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                  <MessageSquareQuote size={48} className="text-zinc-700 mb-4" />
                  <p className="text-zinc-500 font-black text-xs uppercase tracking-widest text-center">Selecione ou crie um modelo<br/>no menu lateral</p>
                </div>
              ) : (
                <div className="flex flex-col gap-6 h-full">
                  
                  {/* Mobile Back Button */}
                  <button 
                    onClick={() => setIsMobileListOpen(true)}
                    className="lg:hidden w-fit flex items-center gap-2 text-zinc-500 hover:text-white mb-2 -mt-2 font-black text-[10px] uppercase tracking-widest transition-colors"
                  >
                    <ArrowLeft size={14} /> Voltar para a lista
                  </button>

                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 shrink-0">
                    <div className="flex-1">
                      <input 
                        className="w-full bg-transparent border-none outline-none text-white font-black text-xl lg:text-3xl uppercase tracking-tight placeholder:text-zinc-700"
                        value={selectedTemplate.titulo}
                        placeholder="Título da Mensagem..."
                        onChange={(e) => updateTemplateContent(selectedTemplate.id, 'titulo', e.target.value)}
                      />
                      <div className="text-[10px] uppercase font-black tracking-widest text-zinc-500 mt-2">
                        Editando Formato de {activeTab === 'cobranca' ? 'Régua Automática' : 'Mensagem Avulsa'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button 
                          onClick={() => handleDeleteMessage(selectedTemplate)}
                          className="p-2 sm:p-3 bg-red-500/5 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 text-zinc-500 hover:text-red-500 rounded-xl transition-all"
                          title="Excluir Modelo Inteiro"
                        >
                          <Trash2 size={16} />
                        </button>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col min-h-[250px]">
                    <div className="bg-zinc-950 border border-zinc-800 rounded-t-2xl p-3 flex items-center justify-between shrink-0">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-2">Corpo da Mensagem no WhatsApp</span>
                    </div>
                    <textarea
                      className="w-full flex-1 bg-zinc-950/50 border-x border-b border-zinc-800 rounded-b-2xl p-5 text-zinc-300 text-sm md:text-base leading-relaxed font-medium focus:border-indigo-500/50 outline-none transition-all scrollbar-thin resize-none"
                      placeholder="Olá {nome}. Sua mensagem começa aqui..."
                      value={selectedTemplate.conteudo}
                      onChange={(e) => updateTemplateContent(selectedTemplate.id, 'conteudo', e.target.value)}
                    />
                    <div className="px-2 py-2 text-[10px] text-zinc-500 uppercase font-black tracking-widest mt-1 shrink-0">
                        Dica: use {'{nome}'} ou {'{pix}'} para incluir dados do locatário.
                    </div>
                  </div>

                  <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-500 shrink-0">
                          <Paperclip size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-white uppercase tracking-tight">Anexo de Mídia</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">Imagem, PDF ou Vídeo</p>
                      </div>
                    </div>

                    {!selectedTemplate.media_url ? (
                      <label className="flex items-center justify-center gap-2 px-4 py-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl cursor-pointer transition-all border border-indigo-500/20 w-full sm:w-auto">
                        <FileUp size={14} />
                        <span className="text-[10px] font-black uppercase tracking-tight">Selecionar Arquivo</span>
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*,video/*,.pdf,.doc,.docx"
                          onChange={(e) => handleUploadMedia(selectedTemplate, e.target.files[0])}
                        />
                      </label>
                    ) : (
                      <div className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-2 pr-4 w-full sm:w-auto overflow-hidden">
                          <div className="w-12 h-12 bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 flex items-center justify-center shrink-0">
                            {selectedTemplate.media_type === 'image' ? (
                              <img src={selectedTemplate.media_url} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                              <>
                                {selectedTemplate.media_type === 'video' && <Video size={18} className="text-zinc-500" />}
                                {selectedTemplate.media_type === 'document' && <FileText size={18} className="text-zinc-500" />}
                              </>
                            )}
                          </div>
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="text-[10px] font-black text-zinc-200 uppercase truncate w-full sm:max-w-[120px]">{selectedTemplate.media_filename}</span>
                            <span className="text-[9px] text-emerald-500 font-bold uppercase mt-0.5 whitespace-nowrap">Anexado com Sucesso</span>
                          </div>
                          
                          <div className="flex items-center gap-1 border-l border-zinc-800 pl-3 shrink-0">
                            <a 
                              href={selectedTemplate.media_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="p-2 hover:bg-zinc-800 text-indigo-400 rounded-lg transition-all"
                              title="Visualizar Anexo"
                            >
                              <FileUp size={16} />
                            </a>
                            <button 
                              onClick={() => handleRemoveMedia(selectedTemplate)}
                              className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-all"
                              title="Remover"
                            >
                              <X size={16} />
                            </button>
                          </div>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          </>
        )}
      </div>

      {isAgendamentoModalOpen && (
        <AgendamentoModal 
           isOpen={isAgendamentoModalOpen} 
           onClose={() => { setIsAgendamentoModalOpen(false); fetchTemplates(); fetchLocatarios(); }} 
           template={agendamentoMode === 'template' ? selectedTemplate : null} 
           locatario={agendamentoMode === 'locatario' ? selectedLocatario : null}
           usuario={profile} 
           mode={agendamentoMode}
        />
      )}
    </div>
  );
};

export default Mensagens;
