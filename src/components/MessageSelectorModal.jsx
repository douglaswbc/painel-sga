import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, Search, Send, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { supabase } from '../services/supabase';

const variablesIn = (value) => [...new Set([...String(value || '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const getParams = (template) => {
  const components = template?.components || [];
  const params = [];
  for (const component of components) {
    const type = String(component.type || '').toUpperCase();
    if (type === 'HEADER' || type === 'BODY') {
      variablesIn(component.text).forEach((variable) => params.push({ label: `${type === 'HEADER' ? 'Cabeçalho' : 'Corpo'} · {{${variable}}}` }));
    } else if (type === 'BUTTONS') {
      (component.buttons || []).forEach((button, index) => {
        if (String(button.type).toUpperCase() === 'URL' && /\{\{\d+\}\}/.test(String(button.url || ''))) params.push({ label: `Botão de site ${index + 1}` });
      });
    }
  }
  return params;
};

export default function MessageSelectorModal({ isOpen, onClose, locatario }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [channel, setChannel] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [params, setParams] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    supabase.functions.invoke('zernio-whatsapp', { body: { action: 'list' } }).then(({ data, error }) => {
      if (error) throw new Error(data?.error || error.message);
      if (data?.error) throw new Error(data.error);
      if (!active) return;
      setTemplates(data?.templates || []);
      setChannel(data?.channel || null);
    }).catch((error) => {
      if (active) toast.error(`Não foi possível carregar os templates: ${error.message}`);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOpen]);

  const usableTemplates = useMemo(() => templates.filter((template) => template.status === 'APPROVED' && template.purpose === 'general' &&
    !(template.components || []).some((component) => String(component.type).toUpperCase() === 'HEADER' && String(component.format).toUpperCase() !== 'TEXT')), [templates]);
  const selectedParams = useMemo(() => getParams(selectedTemplate), [selectedTemplate]);
  const filteredTemplates = useMemo(() => {
    return usableTemplates
      .filter((template) => `${template.name} ${template.language}`.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  }, [usableTemplates, searchTerm]);

  useEffect(() => setParams(selectedParams.map(() => '')), [selectedTemplate?.id]);

  const handleSend = async () => {
    if (!selectedTemplate || !locatario?.whatsapp) return;
    if (selectedParams.some((_, index) => !params[index]?.trim())) return toast.error('Preencha todas as variáveis do template.');
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('zernio-whatsapp', {
        body: { action: 'send_template', templateId: selectedTemplate.id, tenantId: locatario.id, templateParams: params },
      });
      if (error) throw new Error(data?.error || error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Template enviado pelo canal ${channel?.providerLabel || 'ativo'}.`);
      onClose();
    } catch (error) {
      toast.error(`Falha ao enviar template: ${error.message}`);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <section className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 p-6">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-indigo-500/10 p-2 text-indigo-400"><MessageSquare size={20} /></span><div><h2 className="text-lg font-black text-white">Enviar template Meta</h2><p className="text-xs text-zinc-500">Para: {locatario?.nome_completo}</p>{channel && <p className="mt-0.5 text-[10px] uppercase tracking-widest text-indigo-300">Canal: {channel.providerLabel}{channel.label ? ` · ${channel.label}` : ''}</p>}</div></div>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Fechar"><X size={22} /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} /><input className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-indigo-500" placeholder="Buscar template" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div>
          <div className="space-y-2">
            {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-indigo-400" /></div> : !filteredTemplates.length ? <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center"><AlertCircle className="mx-auto mb-2 text-zinc-600" size={22} /><p className="text-xs text-zinc-400">Nenhum template geral aprovado disponível.</p><p className="mt-1 text-[10px] text-zinc-600">Crie e aprove um template na aba Templates Meta. Templates de cobrança são enviados pelo fluxo de cobranças.</p></div> : filteredTemplates.map((template) => <button key={template.id} type="button" onClick={() => setSelectedTemplate(template)} className={`w-full rounded-xl border p-4 text-left ${selectedTemplate?.id === template.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}><span className="flex items-center justify-between text-sm font-bold text-white">{template.name}<span className="text-[10px] uppercase text-zinc-500">{template.language}</span></span><p className="mt-1 line-clamp-2 text-xs text-zinc-500">{(template.components || []).find((component) => String(component.type).toUpperCase() === 'BODY')?.text || 'Template aprovado pela Meta'}</p></button>)}
          </div>
          {selectedTemplate && selectedParams.length > 0 && <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"><div><h3 className="text-xs font-black uppercase tracking-widest text-zinc-300">Variáveis do template</h3><p className="mt-1 text-[10px] text-zinc-600">Informe os valores que serão enviados nesta mensagem.</p></div>{selectedParams.map((item, index) => <label key={`${item.label}-${index}`} className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">{item.label}<input className="mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm normal-case tracking-normal text-white outline-none focus:border-indigo-500" maxLength={1024} value={params[index] || ''} onChange={(event) => setParams((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} /><span className="mt-1 block text-right font-normal normal-case tracking-normal">{(params[index] || '').length} / 1024</span></label>)}</div>}
        </div>
        <footer className="flex gap-3 border-t border-zinc-800 bg-zinc-900/70 p-6"><button type="button" onClick={onClose} className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-zinc-500 hover:text-white">Cancelar</button><button type="button" disabled={!selectedTemplate || sending || loading} onClick={handleSend} className="flex-[2] rounded-2xl bg-indigo-600 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-500 disabled:opacity-50">{sending ? <Loader2 className="mx-auto animate-spin" size={17} /> : <span className="flex items-center justify-center gap-2"><Send size={15} /> Enviar pelo {channel?.providerLabel || 'canal ativo'} <CheckCircle2 size={15} /></span>}</button></footer>
      </section>
    </div>
  );
}
