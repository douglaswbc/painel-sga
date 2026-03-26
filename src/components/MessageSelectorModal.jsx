import React, { useState, useEffect } from 'react';
import { 
  X, Search, MessageSquare, Send, Loader2, 
  CheckCircle2, AlertCircle, Info,
  Image, Video, FileText, Paperclip
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { toast } from 'react-toastify';

const MessageSelectorModal = ({ isOpen, onClose, locatario, usuario }) => {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  useEffect(() => {
    if (isOpen && usuario?.id) {
      fetchTemplates();
    }
  }, [isOpen, usuario]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('mensagens_template')
        .select('*')
        .eq('id_usuario', usuario.id)
        .eq('tipo', 'avulso')
        .order('titulo');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      toast.error("Erro ao carregar modelos");
    } finally {
      setLoading(false);
    }
  };

  const getPreviewMessage = (content) => {
    if (!content) return '';
    const primeiroNome = locatario?.nome_completo?.split(' ')[0] || 'Cliente';
    return content.replace(/{nome}/g, primeiroNome);
  };

  const handleSendMessage = async () => {
    if (!selectedTemplate || !locatario?.whatsapp) return;

    try {
      setSending(true);
      const finalMessage = getPreviewMessage(selectedTemplate.conteudo);
      const isMedia = !!selectedTemplate.media_url;
      const endpoint = isMedia ? 'sendMedia' : 'sendText';
      
      const payload = isMedia ? {
        number: locatario.whatsapp.replace(/\D/g, ''),
        mediatype: selectedTemplate.media_type,
        mimetype: selectedTemplate.media_mimetype,
        caption: finalMessage,
        media: selectedTemplate.media_url,
        fileName: selectedTemplate.media_filename,
        delay: 1200
      } : {
        number: locatario.whatsapp.replace(/\D/g, ''),
        text: finalMessage,
        delay: 1200
      };

      const response = await fetch(`${usuario.evolution_url}/message/${endpoint}/${usuario.evolution_instance}`, {
        method: 'POST',
        headers: {
          'apikey': usuario.evolution_apikey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error("Erro no servidor de mensagens");

      toast.success("Mensagem enviada com sucesso!");
      onClose();
    } catch (error) {
      toast.error("Falha ao enviar: " + error.message);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const filteredTemplates = templates.filter(t => 
    t.titulo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-500">
              <MessageSquare size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Enviar Mensagem</h3>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-none">Para: {locatario?.nome_completo}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-all">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
            <input 
              type="text"
              placeholder="Buscar modelo avulso..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-xs text-white outline-none focus:border-indigo-500 transition-all font-medium"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {/* List */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] px-1">Selecione um Modelo</h4>
            
            {loading ? (
              <div className="flex flex-col items-center py-12 gap-3">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
                <span className="text-xs font-black text-zinc-700 uppercase">Carregando seus modelos...</span>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-8 bg-zinc-950/50 rounded-2xl border border-dashed border-zinc-800">
                <p className="text-zinc-600 text-[10px] font-bold uppercase">Nenhum modelo avulso encontrado</p>
                <p className="text-zinc-700 text-[9px] mt-1 italic">Cadastre modelos na aba 'Avulso' do menu Mensagens.</p>
              </div>
            ) : (
              <div className="grid gap-2">
                {filteredTemplates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplate(template)}
                    className={`w-full text-left p-4 rounded-2xl transition-all border ${
                      selectedTemplate?.id === template.id 
                        ? 'bg-indigo-600 border-indigo-500 shadow-lg shadow-indigo-600/20' 
                        : 'bg-zinc-950/50 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border ${selectedTemplate?.id === template.id ? 'bg-white/10 border-white/20' : 'bg-zinc-900 border-zinc-800'}`}>
                        {template.media_url ? (
                          template.media_type === 'image' ? (
                            <img src={template.media_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="text-indigo-400">
                              {template.media_type === 'video' && <Video size={16} />}
                              {template.media_type === 'document' && <FileText size={16} />}
                            </div>
                          )
                        ) : (
                          <MessageSquare size={16} className="text-zinc-700" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-black uppercase tracking-tight truncate ${selectedTemplate?.id === template.id ? 'text-white' : 'text-zinc-300'}`}>
                            {template.titulo}
                          </span>
                          {selectedTemplate?.id === template.id && <CheckCircle2 size={16} className="text-white" />}
                        </div>
                        {template.media_url && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Paperclip size={10} className="text-indigo-500/70" />
                            <span className={`text-[8px] font-bold uppercase truncate ${selectedTemplate?.id === template.id ? 'text-indigo-200/60' : 'text-zinc-600'}`}>
                              {template.media_filename}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedTemplate?.id === template.id && (
                       <div className="mt-3 p-3 bg-black/20 rounded-xl border border-white/5 animate-in fade-in slide-in-from-top-1 duration-200">
                         <p className="text-[10px] text-zinc-100 leading-relaxed italic line-clamp-3">
                           "{getPreviewMessage(template.conteudo)}"
                         </p>
                       </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex gap-4">
             <button 
                onClick={onClose}
                className="flex-1 py-3.5 text-[11px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-all"
             >
               Cancelar
             </button>
             <button
                disabled={!selectedTemplate || sending}
                onClick={handleSendMessage}
                className="flex-[2] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3"
             >
               {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
               Disparar WhatsApp
             </button>
          </div>
          
          {selectedTemplate && (
            <div className="mt-4 flex items-center gap-2 px-2">
              <Info size={12} className="text-zinc-600" />
              <p className="text-[9px] text-zinc-600 font-bold uppercase">A mensagem será enviada instantaneamente pelo canal oficial.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageSelectorModal;
