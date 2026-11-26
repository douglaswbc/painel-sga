import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2,
  MessageSquare, Search, Send, Users, X
} from 'lucide-react';
import { toast } from 'react-toastify';
import { api } from '../services/api';
import { locatariosService } from '../services/locatarios';

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

export default function MessageSelectorModal({ isOpen, onClose, locatario, locatarios: passedLocatarios }) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [channel, setChannel] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [params, setParams] = useState([]);

  // Gestão de Destinatários em Lote
  const [allLocatarios, setAllLocatarios] = useState([]);
  const [selectedTenantIds, setSelectedTenantIds] = useState([]);
  const [showRecipientList, setShowRecipientList] = useState(false);
  const [tenantSearch, setTenantSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);

    const loadData = async () => {
      try {
        const tmplData = await api.get('/whatsapp/templates');
        if (!active) return;
        setTemplates(tmplData?.templates || []);
        setChannel(tmplData?.channel || null);

        // Carrega lista de locatários ativos com WhatsApp
        if (passedLocatarios && passedLocatarios.length > 0) {
          const valid = passedLocatarios.filter((l) => Boolean(l.whatsapp && l.ativo !== false));
          setAllLocatarios(valid);
          if (locatario?.id) {
            setSelectedTenantIds([locatario.id]);
          } else {
            setSelectedTenantIds(valid.map((l) => l.id));
          }
        } else {
          const locData = await locatariosService.listSimpleWithWhatsApp();
          if (active && locData) {
            const valid = locData.filter((l) => Boolean(l.whatsapp));
            setAllLocatarios(valid);
            if (locatario?.id) {
              setSelectedTenantIds([locatario.id]);
            } else {
              setSelectedTenantIds(valid.map((l) => l.id));
            }
          }
        }
      } catch (error) {
        if (active) toast.error(`Não foi possível carregar os dados: ${error.message}`);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadData();
    return () => { active = false; };
  }, [isOpen, locatario, passedLocatarios]);

  // Permite tanto templates gerais quanto templates aprovados marcados como "avulso"
  const usableTemplates = useMemo(() => {
    return templates.filter((template) => {
      const isApproved = template.status === 'APPROVED';
      const isGeneral = template.purpose === 'general';
      const isAvulso = (template.usages || []).some((u) => u.purpose === 'avulso' && u.is_default);
      const isNotMedia = !(template.components || []).some((component) =>
        String(component.type).toUpperCase() === 'HEADER' && String(component.format).toUpperCase() !== 'TEXT'
      );
      return isApproved && (isGeneral || isAvulso) && isNotMedia;
    });
  }, [templates]);

  const selectedParams = useMemo(() => getParams(selectedTemplate), [selectedTemplate]);

  const filteredTemplates = useMemo(() => {
    return usableTemplates
      .filter((template) => `${template.name} ${template.language}`.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  }, [usableTemplates, searchTerm]);

  // Se múltiplos locatários forem selecionados, preenche {{1}} com a variável de nome se estiver vazia
  useEffect(() => {
    if (selectedParams.length > 0) {
      setParams(selectedParams.map((_, idx) => (idx === 0 && selectedTenantIds.length > 1 ? '{{nome}}' : '')));
    } else {
      setParams([]);
    }
  }, [selectedTemplate?.id, selectedTenantIds.length, selectedParams]);

  const toggleTenant = (id) => {
    setSelectedTenantIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllTenants = () => {
    setSelectedTenantIds(allLocatarios.map((l) => l.id));
  };

  const deselectAllTenants = () => {
    setSelectedTenantIds([]);
  };

  const filteredRecipients = useMemo(() => {
    return allLocatarios.filter((l) =>
      l.nome_completo.toLowerCase().includes(tenantSearch.toLowerCase()) ||
      l.whatsapp.includes(tenantSearch)
    );
  }, [allLocatarios, tenantSearch]);

  const handleSend = async () => {
    if (!selectedTemplate) {
      return toast.error('Selecione um template para envio.');
    }
    if (selectedTenantIds.length === 0) {
      return toast.error('Selecione ao menos um locatário para receber a mensagem.');
    }
    if (selectedParams.some((_, index) => !params[index]?.trim())) {
      return toast.error('Preencha todas as variáveis do template.');
    }

    setSending(true);
    try {
      const data = await api.post('/whatsapp/send-template', {
        templateId: selectedTemplate.id,
        tenantIds: selectedTenantIds,
        templateParams: params,
      });

      const count = data?.sentCount ?? selectedTenantIds.length;
      toast.success(
        count === 1
          ? `Mensagem enviada com sucesso pelo canal ${channel?.providerLabel || 'ativo'}!`
          : `${count} mensagens enviadas em lote pelo canal ${channel?.providerLabel || 'ativo'}!`
      );
      onClose();
    } catch (error) {
      toast.error(`Falha ao enviar template: ${error.message}`);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const isBatch = selectedTenantIds.length > 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <section className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800 p-6">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400">
              <MessageSquare size={22} />
            </span>
            <div>
              <h2 className="text-lg font-black text-white">
                {isBatch ? 'Disparo em Lote (Meta WhatsApp)' : 'Enviar Template Meta'}
              </h2>
              <p className="text-xs text-zinc-400">
                {selectedTenantIds.length === 1 && locatario
                  ? `Para: ${locatario.nome_completo}`
                  : `Destinatários: ${selectedTenantIds.length} selecionado(s)`}
              </p>
              {channel && (
                <p className="mt-0.5 text-[10px] uppercase tracking-widest text-indigo-300">
                  Canal: {channel.providerLabel}
                  {channel.label ? ` · ${channel.label}` : ''}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white"
            aria-label="Fechar"
          >
            <X size={22} />
          </button>
        </header>

        {/* Content Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Seletor de Destinatários em Lote */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-indigo-400" />
                <span className="text-xs font-black uppercase tracking-wider text-zinc-200">
                  Destinatários ({selectedTenantIds.length} de {allLocatarios.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowRecipientList(!showRecipientList)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-400 hover:text-indigo-300"
              >
                {showRecipientList ? 'Ocultar Lista' : 'Alterar / Selecionar em Lote'}
                {showRecipientList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {showRecipientList && (
              <div className="mt-4 space-y-3 pt-3 border-t border-zinc-800/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={13} />
                    <input
                      type="text"
                      placeholder="Filtrar locatário..."
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 pl-8 pr-3 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={selectAllTenants}
                    className="rounded-lg bg-indigo-500/10 px-2.5 py-1.5 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/20"
                  >
                    Marcar Todos
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllTenants}
                    className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[10px] font-bold text-zinc-400 hover:bg-zinc-700"
                  >
                    Limpar
                  </button>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {filteredRecipients.length === 0 ? (
                    <p className="text-center py-2 text-xs text-zinc-600">Nenhum locatário encontrado.</p>
                  ) : (
                    filteredRecipients.map((item) => {
                      const isChecked = selectedTenantIds.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className={`flex items-center justify-between p-2 rounded-xl border cursor-pointer transition ${
                            isChecked
                              ? 'bg-indigo-500/10 border-indigo-500/40 text-white'
                              : 'bg-zinc-900 border-zinc-800/80 text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleTenant(item.id)}
                              className="rounded border-zinc-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-zinc-800"
                            />
                            <span className="text-xs font-bold truncate">{item.nome_completo}</span>
                          </div>
                          <span className="text-[10px] font-mono text-zinc-500 shrink-0 ml-2">
                            {item.whatsapp}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Busca de Template */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
            <input
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-indigo-500"
              placeholder="Buscar template Meta (geral ou avulso)..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          {/* Lista de Templates */}
          <div className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="animate-spin text-indigo-400" />
              </div>
            ) : !filteredTemplates.length ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center">
                <AlertCircle className="mx-auto mb-2 text-zinc-600" size={22} />
                <p className="text-xs text-zinc-400">Nenhum template aprovado disponível.</p>
                <p className="mt-1 text-[10px] text-zinc-600 leading-relaxed">
                  Crie e aprove um template na aba <strong>Templates Meta</strong> em <strong>/mensagens</strong>. Templates categorizados como <em>Avulso</em> ou <em>Geral</em> aparecem aqui.
                </p>
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {filteredTemplates.map((template) => {
                  const isSelected = selectedTemplate?.id === template.id;
                  const isAvulso = (template.usages || []).some((u) => u.purpose === 'avulso' && u.is_default);
                  const bodyText = (template.components || []).find(
                    (component) => String(component.type).toUpperCase() === 'BODY'
                  )?.text;

                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedTemplate(template)}
                      className={`w-full rounded-xl border p-4 text-left transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-bold text-white">
                          {template.name}
                          <span className="text-[10px] uppercase text-zinc-500">{template.language}</span>
                          {isAvulso && (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-bold uppercase text-emerald-300">
                              Avulso
                            </span>
                          )}
                        </span>
                        {isSelected && <CheckCircle2 size={16} className="text-indigo-400" />}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                        {bodyText || 'Template aprovado pela Meta'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Variáveis do Template */}
          {selectedTemplate && selectedParams.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-300">
                  Variáveis do template
                </h3>
                <p className="mt-1 text-[10px] text-zinc-500">
                  {isBatch
                    ? 'Use {{nome}} na primeira variável para preencher automaticamente com o primeiro nome de cada locatário.'
                    : 'Informe os valores que serão enviados nesta mensagem.'}
                </p>
              </div>
              {selectedParams.map((item, index) => (
                <label key={`${item.label}-${index}`} className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  {item.label}
                  <input
                    className="mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm normal-case tracking-normal text-white outline-none focus:border-indigo-500"
                    maxLength={1024}
                    value={params[index] || ''}
                    placeholder={index === 0 && isBatch ? '{{nome}}' : 'Valor da variável'}
                    onChange={(event) =>
                      setParams((current) =>
                        current.map((value, currentIndex) =>
                          currentIndex === index ? event.target.value : value
                        )
                      )
                    }
                  />
                  <span className="mt-1 block text-right font-normal normal-case tracking-normal text-zinc-600">
                    {(params[index] || '').length} / 1024
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex gap-3 border-t border-zinc-800 bg-zinc-900/70 p-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 text-xs font-black uppercase tracking-widest text-zinc-500 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selectedTemplate || selectedTenantIds.length === 0 || sending || loading}
            onClick={handleSend}
            className="flex-[2] rounded-2xl bg-indigo-600 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="mx-auto animate-spin" size={17} />
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Send size={15} />
                {isBatch
                  ? `Enviar para ${selectedTenantIds.length} locatários`
                  : `Enviar pelo ${channel?.providerLabel || 'canal ativo'}`}
                <CheckCircle2 size={15} />
              </span>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}
