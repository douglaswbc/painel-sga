import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Circle, FileText, Loader2, Plus, RefreshCw,
  Send, Smartphone, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';

const statusStyles = {
  APPROVED: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  PENDING: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  REJECTED: 'text-red-300 bg-red-500/10 border-red-500/20',
  PAUSED: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  DISABLED: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  IN_APPEAL: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  PENDING_DELETION: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

const languages = [
  ['pt_BR', 'Português (Brasil)'], ['pt_PT', 'Português (Portugal)'], ['en_US', 'Inglês (EUA)'],
  ['en', 'Inglês'], ['en_GB', 'Inglês (Reino Unido)'], ['es', 'Espanhol'],
  ['es_MX', 'Espanhol (México)'], ['fr', 'Francês'], ['fr_CA', 'Francês (Canadá)'],
  ['de', 'Alemão'], ['it', 'Italiano'], ['nl', 'Holandês'], ['ru', 'Russo'],
  ['ar', 'Árabe'], ['hi', 'Hindi'], ['id', 'Indonésio'], ['ja', 'Japonês'],
  ['ko', 'Coreano'], ['zh_CN', 'Chinês (China)'], ['zh_HK', 'Chinês (Hong Kong)'],
  ['tr', 'Turco'], ['pl', 'Polonês'], ['uk', 'Ucraniano'], ['sv', 'Sueco'],
  ['da', 'Dinamarquês'], ['fi', 'Finlandês'], ['no', 'Norueguês'], ['he', 'Hebraico'],
  ['th', 'Tailandês'], ['vi', 'Vietnamita'], ['ms', 'Malaio'], ['fil', 'Filipino'],
  ['sw', 'Suaíli'], ['el', 'Grego'], ['ro', 'Romeno'], ['hu', 'Húngaro'],
  ['cs', 'Tcheco'], ['sk', 'Eslovaco'], ['hr', 'Croata'], ['bg', 'Búlgaro'],
  ['sr', 'Sérvio'], ['ca', 'Catalão'], ['af', 'Africâner'], ['bn', 'Bengali'],
  ['fa', 'Persa'], ['ur', 'Urdu'], ['ta', 'Tâmil'], ['te', 'Telugu'],
  ['mr', 'Marata'], ['gu', 'Guzerate'], ['pa', 'Punjabi'], ['am', 'Amárico'],
  ['az', 'Azerbaijano'], ['lo', 'Laosiano'], ['ne', 'Nepalês'], ['uz', 'Uzbeque'],
].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
// Keep Brazilian Portuguese as the initial option even though the list is alphabetized.
const orderedLanguages = [languages.find(([code]) => code === 'pt_BR'), ...languages.filter(([code]) => code !== 'pt_BR')];

const initialDraft = () => ({
  name: '', category: 'UTILITY', language: 'pt_BR',
  headerType: 'none', headerText: '', headerFormat: 'IMAGE', headerHandle: '',
  body: '', examples: {}, footer: '', buttonMode: 'none',
  quickReplies: [''], ctaTypes: [], phoneLabel: '', countryCode: '+55', phoneNumber: '',
  websiteLabel: '', websiteMode: 'static', websiteUrl: '', websiteExample: '',
  useForCharges: false,
});

const getVariables = (text) => [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const hasUnsupportedVariableSyntax = (text) => {
  const textWithoutVariables = text.replace(/\{\{\d+\}\}/g, '');
  return textWithoutVariables.includes('{{') || textWithoutVariables.includes('}}');
};
const isSequential = (variables) => variables.every((value, index) => value === index + 1);

const hasSavedDraft = (storageKey) => {
  if (!storageKey) return false;
  try { return Boolean(sessionStorage.getItem(storageKey)); } catch { return false; }
};

const readSavedDraft = (storageKey) => {
  if (!storageKey) return initialDraft();
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    return saved ? { ...initialDraft(), ...saved, examples: saved.examples || {} } : initialDraft();
  } catch { return initialDraft(); }
};

function Counter({ value, limit }) {
  const overLimit = value.length > limit;
  return <span className={`text-[10px] tabular-nums ${overLimit ? 'text-red-400' : 'text-slate-500'}`}>{value.length} / {limit}</span>;
}

function FieldLabel({ children, htmlFor, right }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-slate-300">
      <span>{children}</span>{right}
    </label>
  );
}

function TemplateForm({ busy, storageKey, onCancel, onSubmit }) {
  const [draft, setDraft] = useState(() => readSavedDraft(storageKey));
  const [attempted, setAttempted] = useState(false);
  const variables = useMemo(() => getVariables(draft.body), [draft.body]);

  useEffect(() => {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch {}
  }, [draft, storageKey]);

  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const setQuickReply = (index, value) => setDraft((current) => ({
    ...current,
    quickReplies: current.quickReplies.map((reply, replyIndex) => replyIndex === index ? value : reply),
  }));
  const toggleCtaType = (type) => setDraft((current) => ({
    ...current,
    ctaTypes: current.ctaTypes.includes(type)
      ? current.ctaTypes.filter((item) => item !== type)
      : [...current.ctaTypes, type],
  }));

  const errors = useMemo(() => {
    const result = {};
    if (!/^[a-z][a-z0-9_]{0,511}$/.test(draft.name)) result.name = 'Use letras minúsculas, números e _, começando por uma letra.';
    if (!draft.category) result.category = 'Selecione uma categoria.';
    if (!draft.language) result.language = 'Selecione um idioma.';
    if (!draft.body.trim()) result.body = 'O corpo da mensagem é obrigatório.';
    else if (draft.body.length > 1024) result.body = 'O corpo ultrapassou 1.024 caracteres.';
    else if (!isSequential(variables)) result.body = 'Use variáveis sequenciais: {{1}}, {{2}}, {{3}}... sem pular números.';
    else if (hasUnsupportedVariableSyntax(draft.body)) result.body = 'Variável inválida. Use o formato {{1}}, {{2}}, {{3}}...';
    if (variables.some((variable) => !(draft.examples[variable] || '').trim())) result.examples = 'Preencha um exemplo para cada variável do corpo.';
    if (variables.some((variable) => (draft.examples[variable] || '').length > 60)) result.examples = 'Cada exemplo pode ter no máximo 60 caracteres.';
    if (draft.headerType === 'text') {
      if (!draft.headerText.trim()) result.headerText = 'O texto do cabeçalho é obrigatório.';
      else if (draft.headerText.length > 60) result.headerText = 'O cabeçalho pode ter no máximo 60 caracteres.';
      else if (draft.headerText.includes('{{') || draft.headerText.includes('}}')) result.headerText = 'O cabeçalho de texto não aceita variáveis.';
    }
    if (draft.headerType === 'media' && draft.headerFormat !== 'LOCATION' && !draft.headerHandle.trim()) {
      result.headerHandle = 'Informe uma URL pública HTTPS para a mídia de exemplo.';
    } else if (draft.headerType === 'media' && draft.headerFormat !== 'LOCATION') {
      try {
        if (new URL(draft.headerHandle).protocol !== 'https:') result.headerHandle = 'Use uma URL HTTPS pública.';
      } catch { result.headerHandle = 'Informe uma URL HTTPS pública válida.'; }
    }
    if (draft.footer.length > 60) result.footer = 'O rodapé pode ter no máximo 60 caracteres.';
    if (draft.footer.includes('{{') || draft.footer.includes('}}')) result.footer = 'Variáveis devem ser colocadas no corpo da mensagem.';
    if (draft.buttonMode === 'quick') {
      if (!draft.quickReplies.length || draft.quickReplies.some((label) => !label.trim())) result.quickReplies = 'Preencha o texto de cada resposta rápida.';
      else if (draft.quickReplies.some((label) => label.length > 25)) result.quickReplies = 'Cada botão pode ter no máximo 25 caracteres.';
      else if (draft.quickReplies.length > 3) result.quickReplies = 'São permitidos até 3 botões.';
    }
    if (draft.buttonMode === 'cta') {
      if (draft.ctaTypes.length === 2 && new Set(draft.ctaTypes).size !== 2) result.cta = 'Os dois botões precisam ter tipos diferentes.';
      if (draft.ctaTypes.includes('phone')) {
        if (!draft.phoneLabel.trim() || draft.phoneLabel.length > 25) result.phoneLabel = 'Informe um texto de até 25 caracteres.';
        if (!/^\+?[1-9]\d{7,14}$/.test(`${draft.countryCode}${draft.phoneNumber}`.replace(/\s/g, '')) || !/^\+?\d{1,4}$/.test(draft.countryCode) || !/^\d{6,14}$/.test(draft.phoneNumber)) {
          result.phoneNumber = 'Informe código do país e telefone válidos.';
        }
      }
      if (draft.ctaTypes.includes('website')) {
        if (!draft.websiteLabel.trim() || draft.websiteLabel.length > 25) result.websiteLabel = 'Informe um texto de até 25 caracteres.';
        if (draft.websiteUrl.length > 2000) result.websiteUrl = 'A URL pode ter no máximo 2.000 caracteres.';
        const websiteVariables = draft.websiteUrl.match(/\{\{\d+\}\}/g) || [];
        try {
          const url = new URL(draft.websiteUrl.replace('{{1}}', 'exemplo'));
          if (url.protocol !== 'https:' || (draft.websiteMode === 'dynamic' && (websiteVariables.length !== 1 || websiteVariables[0] !== '{{1}}' || !draft.websiteUrl.endsWith('{{1}}')))
            || (draft.websiteMode === 'static' && websiteVariables.length > 0)) result.websiteUrl = 'Use uma URL HTTPS estática ou, na opção dinâmica, termine com {{1}}.';
        } catch { result.websiteUrl = 'Informe uma URL HTTPS válida.'; }
        if (draft.websiteMode === 'dynamic') {
          if (!draft.websiteExample.trim()) result.websiteExample = 'Informe um exemplo para o trecho variável da URL.';
        }
        if (draft.ctaTypes.length === 0) result.cta = 'Selecione ao menos um tipo de botão CTA.';
      }
    }
    if (draft.useForCharges) {
      if (draft.category !== 'UTILITY') result.charge = 'Templates de cobrança precisam usar a categoria UTILITY.';
      if (variables.length !== 4 || variables.some((value, index) => value !== index + 1)) result.charge = 'Para cobranças, o corpo precisa ter {{1}}, {{2}}, {{3}} e {{4}} nessa ordem.';
      if (draft.headerType === 'text' && /\{\{\d+\}\}/.test(draft.headerText)) result.charge = 'Templates de cobrança não podem ter variáveis no cabeçalho.';
      if (draft.buttonMode === 'cta' && draft.ctaTypes.includes('website') && draft.websiteMode === 'dynamic') result.charge = 'Para cobrança, use botão de site com URL estática.';
    }
    return result;
  }, [draft, variables]);

  const formIsValid = Object.keys(errors).length === 0;
  const previewBody = draft.body.replace(/\{\{(\d+)\}\}/g, (_match, number) => draft.examples[number] || `variável ${number}`);
  const previewPhone = `${draft.countryCode} ${draft.phoneNumber}`.trim();

  const buildComponents = () => {
    const components = [];
    if (draft.headerType === 'text') {
      components.push({ type: 'header', format: 'text', text: draft.headerText });
    } else if (draft.headerType === 'media') {
      const header = { type: 'header', format: draft.headerFormat.toLowerCase() };
      if (draft.headerFormat !== 'LOCATION') header.example = { header_handle: [draft.headerHandle.trim()] };
      components.push(header);
    }
    const body = { type: 'body', text: draft.body };
    if (variables.length) body.example = { body_text: [variables.map((variable) => draft.examples[variable].trim())] };
    components.push(body);
    if (draft.footer.trim()) components.push({ type: 'footer', text: draft.footer });
    if (draft.buttonMode === 'quick') {
      components.push({ type: 'buttons', buttons: draft.quickReplies.map((text) => ({ type: 'quick_reply', text: text.trim() })) });
    } else if (draft.buttonMode === 'cta') {
      const buttons = [];
      if (draft.ctaTypes.includes('phone')) {
        buttons.push({ type: 'phone_number', text: draft.phoneLabel.trim(), phone_number: `${draft.countryCode}${draft.phoneNumber}`.replace(/\D/g, '') });
      }
      if (draft.ctaTypes.includes('website')) {
        const button = { type: 'url', text: draft.websiteLabel.trim(), url: draft.websiteUrl.trim() };
        if (draft.websiteMode === 'dynamic') button.example = [draft.websiteExample.trim()];
        buttons.push(button);
      }
      if (buttons.length) components.push({ type: 'buttons', buttons });
    }
    return components;
  };

  const submit = (event) => {
    event.preventDefault();
    setAttempted(true);
    if (!formIsValid || busy) return;
    const variableMapping = draft.useForCharges
      ? [
        { position: 1, field: 'tenant_first_name' }, { position: 2, field: 'amount' },
        { position: 3, field: 'due_date' }, { position: 4, field: 'payment_link' },
      ]
      : [];
    onSubmit({
      name: draft.name.trim(), category: draft.category, language: draft.language,
      components: buildComponents(), purpose: draft.useForCharges ? 'charge' : 'general', variableMapping,
    });
  };

  const inputClass = (invalid = false) => `w-full bg-slate-950 border rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400 ${invalid && attempted ? 'border-red-500' : 'border-slate-700'}`;
  const shownError = (key) => attempted && errors[key] ? <p className="mt-1 text-[11px] text-red-400">{errors[key]}</p> : null;

  return (
    <form onSubmit={submit} onBlurCapture={() => setAttempted(true)} noValidate className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Novo template Meta</h3>
            <p className="text-xs text-slate-400 mt-1">Configure a mensagem e revise a prévia antes de enviar para análise. O rascunho fica salvo nesta aba se você navegar para outra tela.</p>
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Cancelar criação"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <FieldLabel htmlFor="template-category">Categoria *</FieldLabel>
            <select id="template-category" value={draft.category} onChange={(event) => update('category', event.target.value)} className={inputClass(Boolean(errors.category))}>
              <option value="MARKETING">MARKETING</option><option value="UTILITY">UTILITY (Utilidade)</option><option value="AUTHENTICATION">AUTHENTICATION (Autenticação)</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="template-name" right={<Counter value={draft.name} limit={512} />}>Nome do modelo *</FieldLabel>
            <input id="template-name" value={draft.name} onChange={(event) => update('name', event.target.value)} className={`${inputClass(Boolean(errors.name))} font-mono`} autoComplete="off" />
            {shownError('name')}
          </div>
          <div>
            <FieldLabel htmlFor="template-language">Idioma *</FieldLabel>
            <select id="template-language" value={draft.language} onChange={(event) => update('language', event.target.value)} className={inputClass(Boolean(errors.language))}>
              {orderedLanguages.map(([code, label]) => <option value={code} key={code}>{label} · {code}</option>)}
            </select>
          </div>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Cabeçalho (opcional)</h4>
          <div className="max-w-sm">
            <FieldLabel htmlFor="template-header-type">Tipo</FieldLabel>
            <select id="template-header-type" value={draft.headerType} onChange={(event) => update('headerType', event.target.value)} className={inputClass()}>
              <option value="none">Nenhum</option><option value="text">Texto</option><option value="media">Mídia</option>
            </select>
          </div>
          {draft.headerType === 'text' && <div>
            <FieldLabel htmlFor="template-header-text" right={<Counter value={draft.headerText} limit={60} />}>Texto do cabeçalho</FieldLabel>
            <input id="template-header-text" value={draft.headerText} onChange={(event) => update('headerText', event.target.value)} className={inputClass(Boolean(errors.headerText))} />
            <p className="mt-1 text-[11px] text-slate-500">Variáveis não são permitidas no cabeçalho de texto.</p>{shownError('headerText')}
          </div>}
          {draft.headerType === 'media' && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="template-header-format">Tipo de mídia</FieldLabel>
              <select id="template-header-format" value={draft.headerFormat} onChange={(event) => update('headerFormat', event.target.value)} className={inputClass()}>
                <option value="IMAGE">Imagem</option><option value="VIDEO">Vídeo</option><option value="DOCUMENT">Documento</option><option value="LOCATION">Localização</option>
              </select>
            </div>
            {draft.headerFormat !== 'LOCATION' && <div>
              <FieldLabel htmlFor="template-header-handle">URL pública da mídia de exemplo *</FieldLabel>
              <input id="template-header-handle" value={draft.headerHandle} onChange={(event) => update('headerHandle', event.target.value)} className={inputClass(Boolean(errors.headerHandle))} placeholder="https://exemplo.com/amostra.jpg" />
              {shownError('headerHandle')}
            </div>}
              {draft.headerFormat !== 'LOCATION' && <p className="md:col-span-2 text-[11px] text-slate-500">Use uma URL pública e acessível da mídia. A Zernio fará o upload de amostra para a Meta durante a criação do template.</p>}
          </div>}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-3">
          <FieldLabel htmlFor="template-body" right={<Counter value={draft.body} limit={1024} />}>Corpo da mensagem *</FieldLabel>
          <textarea id="template-body" value={draft.body} onChange={(event) => update('body', event.target.value)} rows={6} className={`${inputClass(Boolean(errors.body))} resize-y leading-relaxed`} placeholder="Olá {{1}}, sua mensagem..." />
          {shownError('body')}
          {variables.length > 0 && <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-3">
            <div><h5 className="text-xs font-bold text-indigo-200">Exemplos para análise da Meta</h5><p className="text-[11px] text-slate-500 mt-1">A Meta exige um exemplo real para cada variável do corpo.</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {variables.map((variable) => <div key={variable}>
                <FieldLabel htmlFor={`variable-example-${variable}`} right={<Counter value={draft.examples[variable] || ''} limit={60} />}>Exemplo da variável {`{{${variable}}}`}</FieldLabel>
                <input id={`variable-example-${variable}`} value={draft.examples[variable] || ''} onChange={(event) => setDraft((current) => ({ ...current, examples: { ...current.examples, [variable]: event.target.value } }))} className={inputClass(Boolean(errors.examples))} />
              </div>)}
            </div>
            {shownError('examples')}
          </div>}
          {draft.useForCharges && errors.charge && attempted && <p className="text-[11px] text-red-400">{errors.charge}</p>}
        </section>

        <div>
          <FieldLabel htmlFor="template-footer" right={<Counter value={draft.footer} limit={60} />}>Rodapé (opcional)</FieldLabel>
          <input id="template-footer" value={draft.footer} onChange={(event) => update('footer', event.target.value)} className={inputClass(Boolean(errors.footer))} />
          {shownError('footer')}
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Botões interativos (opcional)</h4>
          <div className="max-w-sm">
            <FieldLabel htmlFor="template-button-mode">Tipo de botão</FieldLabel>
            <select id="template-button-mode" value={draft.buttonMode} onChange={(event) => update('buttonMode', event.target.value)} className={inputClass()}>
              <option value="none">Nenhum</option><option value="cta">Chamada para ação (CTA)</option><option value="quick">Respostas rápidas</option>
            </select>
          </div>
          {draft.buttonMode === 'quick' && <div className="space-y-3">
            {draft.quickReplies.map((reply, index) => <div key={index}>
              <FieldLabel htmlFor={`quick-reply-${index}`} right={<div className="flex items-center gap-2"><Counter value={reply} limit={25} />{draft.quickReplies.length > 1 && <button type="button" onClick={() => update('quickReplies', draft.quickReplies.filter((_item, i) => i !== index))} className="text-slate-500 hover:text-red-400"><X size={14} /></button>}</div>}>Resposta rápida {index + 1}</FieldLabel>
              <input id={`quick-reply-${index}`} value={reply} onChange={(event) => setQuickReply(index, event.target.value)} className={inputClass(Boolean(errors.quickReplies))} />
            </div>)}
            {draft.quickReplies.length < 3 && <button type="button" onClick={() => update('quickReplies', [...draft.quickReplies, ''])} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">+ Adicionar botão</button>}
            {shownError('quickReplies')}
          </div>}
          {draft.buttonMode === 'cta' && <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {['phone', 'website'].map((type) => <label key={type} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">
                <input type="checkbox" checked={draft.ctaTypes.includes(type)} onChange={() => toggleCtaType(type)} />{type === 'phone' ? 'Telefone' : 'Site'}
              </label>)}
            </div>
            {draft.ctaTypes.includes('phone') && <div className="grid grid-cols-1 md:grid-cols-[1fr_130px_1fr] gap-3 rounded-lg border border-slate-800 p-3">
              <div><FieldLabel htmlFor="cta-phone-label" right={<Counter value={draft.phoneLabel} limit={25} />}>Texto do botão</FieldLabel><input id="cta-phone-label" value={draft.phoneLabel} onChange={(event) => update('phoneLabel', event.target.value)} className={inputClass(Boolean(errors.phoneLabel))} />{shownError('phoneLabel')}</div>
              <div><FieldLabel htmlFor="cta-country-code">Código país</FieldLabel><input id="cta-country-code" value={draft.countryCode} onChange={(event) => update('countryCode', event.target.value)} className={inputClass(Boolean(errors.phoneNumber))} placeholder="+55" /></div>
              <div><FieldLabel htmlFor="cta-phone-number">Número</FieldLabel><input id="cta-phone-number" value={draft.phoneNumber} onChange={(event) => update('phoneNumber', event.target.value.replace(/\D/g, ''))} className={inputClass(Boolean(errors.phoneNumber))} placeholder="11999998888" />{shownError('phoneNumber')}</div>
            </div>}
            {draft.ctaTypes.includes('website') && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-slate-800 p-3">
              <div><FieldLabel htmlFor="cta-site-label" right={<Counter value={draft.websiteLabel} limit={25} />}>Texto do botão</FieldLabel><input id="cta-site-label" value={draft.websiteLabel} onChange={(event) => update('websiteLabel', event.target.value)} className={inputClass(Boolean(errors.websiteLabel))} />{shownError('websiteLabel')}</div>
              <div><FieldLabel htmlFor="cta-site-mode">Tipo de URL</FieldLabel><select id="cta-site-mode" value={draft.websiteMode} onChange={(event) => update('websiteMode', event.target.value)} className={inputClass()}><option value="static">Estática</option><option value="dynamic">Dinâmica</option></select></div>
              <div className="md:col-span-2"><FieldLabel htmlFor="cta-site-url" right={<Counter value={draft.websiteUrl} limit={2000} />}>URL do site</FieldLabel><input id="cta-site-url" value={draft.websiteUrl} onChange={(event) => update('websiteUrl', event.target.value)} className={inputClass(Boolean(errors.websiteUrl))} placeholder={draft.websiteMode === 'dynamic' ? 'https://exemplo.com/pedido/{{1}}' : 'https://exemplo.com'} />{shownError('websiteUrl')}</div>
              {draft.websiteMode === 'dynamic' && <div className="md:col-span-2"><FieldLabel htmlFor="cta-site-example">Exemplo do trecho dinâmico</FieldLabel><input id="cta-site-example" value={draft.websiteExample} onChange={(event) => update('websiteExample', event.target.value)} className={inputClass(Boolean(errors.websiteExample))} placeholder="pedido-123" />{shownError('websiteExample')}</div>}
            </div>}
            {shownError('cta')}
          </div>}
        </section>

        <label className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 cursor-pointer">
          <input type="checkbox" checked={draft.useForCharges} onChange={(event) => update('useForCharges', event.target.checked)} className="mt-0.5" />
          <span><span className="block text-xs font-bold text-emerald-200">Usar este template nas cobranças do SGA</span><span className="block mt-1 text-[11px] text-slate-400">Requer categoria UTILITY e as variáveis {'{{1}}'} nome, {'{{2}}'} valor, {'{{3}}'} vencimento e {'{{4}}'} link PIX, nessa ordem.</span>{draft.useForCharges && errors.charge && attempted && <span className="block mt-1 text-[11px] text-red-400">{errors.charge}</span>}</span>
        </label>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
          {!formIsValid && <p className="mr-auto self-center text-[11px] text-slate-500">Preencha os campos obrigatórios e corrija os limites para enviar.</p>}
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy || !formIsValid} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"><Send size={15} />{busy ? 'Enviando...' : 'Enviar para Análise'}</button>
        </div>
      </div>

      <aside className="xl:sticky xl:top-4 h-fit">
        <div className="mx-auto max-w-[290px] rounded-[2rem] border-[7px] border-slate-700 bg-slate-950 p-2 shadow-2xl">
          <div className="mx-auto mb-3 h-4 w-20 rounded-full bg-slate-700" />
          <div className="overflow-hidden rounded-[1.25rem] bg-[#efeae2] min-h-[420px]">
            <div className="flex items-center gap-2 bg-[#075e54] px-3 py-3 text-white"><div className="h-8 w-8 rounded-full bg-white/20 grid place-items-center"><Smartphone size={15} /></div><div><p className="text-xs font-bold">WhatsApp Business</p><p className="text-[9px] text-white/70">Prévia do template</p></div></div>
            <div className="min-h-[365px] bg-[linear-gradient(135deg,#e9e4dc_25%,#e3ddd3_25%,#e3ddd3_50%,#e9e4dc_50%,#e9e4dc_75%,#e3ddd3_75%)] bg-[length:22px_22px] p-3 flex flex-col justify-end">
              <div className="max-w-[95%] rounded-xl rounded-tl-sm bg-white p-3 shadow-sm text-[12px] text-slate-800 whitespace-pre-wrap break-words">
                {draft.headerType === 'text' && <p className="mb-2 font-bold">{draft.headerText || 'Cabeçalho'}</p>}
                {draft.headerType === 'media' && draft.headerFormat !== 'LOCATION' && <div className="mb-2 h-24 rounded-md bg-slate-200 grid place-items-center text-[10px] uppercase text-slate-500">{draft.headerFormat} de exemplo</div>}
                {draft.headerType === 'media' && draft.headerFormat === 'LOCATION' && <div className="mb-2 h-24 rounded-md bg-emerald-100 grid place-items-center text-[10px] text-emerald-700">Localização</div>}
                <p>{previewBody || 'O corpo da mensagem aparecerá aqui.'}</p>
                {draft.footer && <p className="mt-2 text-[10px] text-slate-500">{draft.footer}</p>}
                <p className="mt-1 text-right text-[9px] text-slate-400">09:41 ✓✓</p>
              </div>
              {draft.buttonMode === 'quick' && draft.quickReplies.filter(Boolean).map((reply, index) => <div key={index} className="mt-1 rounded-lg bg-white py-2 text-center text-[11px] font-semibold text-blue-600 shadow-sm">{reply || `Resposta ${index + 1}`}</div>)}
              {draft.buttonMode === 'cta' && draft.ctaTypes.includes('phone') && <div className="mt-1 rounded-lg bg-white py-2 text-center text-[11px] font-semibold text-blue-600 shadow-sm">☎ {draft.phoneLabel || 'Ligar'} · {previewPhone || 'telefone'}</div>}
              {draft.buttonMode === 'cta' && draft.ctaTypes.includes('website') && <div className="mt-1 rounded-lg bg-white py-2 text-center text-[11px] font-semibold text-blue-600 shadow-sm">↗ {draft.websiteLabel || 'Abrir site'}</div>}
            </div>
          </div>
        </div>
        {draft.useForCharges && <p className="mx-auto mt-3 max-w-[290px] text-center text-[11px] text-emerald-300">Será marcado como template de cobrança após a Meta receber o pedido.</p>}
      </aside>
    </form>
  );
}

const ZernioTemplatesCard = () => {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const draftStorageKey = profile?.id ? `sga-zernio-template-draft-${profile.id}` : null;

  useEffect(() => {
    if (hasSavedDraft(draftStorageKey)) setShowForm(true);
  }, [draftStorageKey]);

  const invoke = useCallback(async (action, payload = {}) => {
    const { data, error } = await supabase.functions.invoke('zernio-whatsapp', { body: { action, ...payload } });
    if (error) {
      let message = 'Não foi possível falar com o SGA. Tente novamente.';
      try {
        const body = await error.context?.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const refresh = useCallback(async (showNotice = false) => {
    setBusy(true);
    setErrorMessage('');
    if (showNotice) setNotice('');
    try {
      const data = await invoke('list');
      setTemplates(data.templates || []);
      if (showNotice) setNotice('Status dos templates sincronizado com a Meta.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => { refresh(); }, [refresh]);

  const createTemplate = async (payload) => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('create_template', payload);
      setTemplates((current) => [data.template, ...current.filter((item) => item.id !== data.template.id)]);
      if (draftStorageKey) {
        try { sessionStorage.removeItem(draftStorageKey); } catch {}
      }
      setShowForm(false);
      setNotice(`Template ${data.template.name} enviado à Meta com status ${data.template.status}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (template) => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('set_default', { templateId: template.id });
      setTemplates(data.templates || []);
      setNotice('Template aprovado selecionado para o envio das cobranças.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelTemplate = () => {
    if (draftStorageKey) {
      try { sessionStorage.removeItem(draftStorageKey); } catch {}
    }
    setShowForm(false);
  };

  if (loading) return <div className="bg-card border border-slate-700 rounded-xl p-6 flex justify-center"><Loader2 className="animate-spin text-accent" size={24} /></div>;

  return (
    <section className="bg-card border border-slate-700 rounded-xl p-6 shadow-lg space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-widest flex items-center gap-2"><FileText size={17} className="text-indigo-400" /> Templates Meta para WhatsApp</h2>
          <p className="text-xs text-slate-400 mt-2">Crie os modelos nesta tela, acompanhe a análise da Meta e selecione um template Utility aprovado para cobranças.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => refresh(true)} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-2"><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />Atualizar</button>
          {!showForm && <button type="button" onClick={() => { setErrorMessage(''); setNotice(''); setShowForm(true); }} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2"><Plus size={15} />Novo Template</button>}
        </div>
      </div>

      {showForm && <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 md:p-5"><TemplateForm busy={busy} storageKey={draftStorageKey} onCancel={cancelTemplate} onSubmit={createTemplate} /></div>}

      {!showForm && <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300">Como funcionam os templates</h3>
        <p className="text-xs text-slate-400">Cada template enviado fica pendente até a Meta concluir a análise. Templates de cobrança precisam ser da categoria Utility e usar as quatro variáveis exigidas pelo SGA.</p>
      </div>}

      {templates.length > 0 ? <div className="space-y-2">
        {templates.map((template) => {
          const status = String(template.status || 'PENDING').toUpperCase();
          const isChargeTemplate = template.purpose === 'charge';
          return <article key={template.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{template.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">{template.language}</span>
                <span className={`text-[10px] uppercase font-bold border rounded-full px-2 py-0.5 ${statusStyles[status] || statusStyles.PENDING}`}>{status}</span>
                {template.is_default && <span className="text-[10px] text-emerald-300 font-bold">PADRÃO</span>}
                {isChargeTemplate && <span className="text-[10px] text-indigo-300">COBRANÇAS</span>}
                {!isChargeTemplate && <span className="text-[10px] text-slate-500">GERAL</span>}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{template.category}{template.rejection_reason ? ` · ${template.rejection_reason}` : ''}</p>
            </div>
            {isChargeTemplate && <button type="button" onClick={() => setDefault(template)} disabled={busy || status !== 'APPROVED' || template.is_default} className="shrink-0 px-3 py-2 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 disabled:opacity-40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
              {template.is_default ? <CheckCircle2 size={15} /> : <Circle size={15} />}{template.is_default ? 'Selecionado' : 'Usar nas cobranças'}
            </button>}
          </article>;
        })}
      </div> : <div className="flex items-start gap-3 text-xs text-slate-500 bg-slate-900/40 border border-slate-800 rounded-lg p-3"><AlertCircle size={16} className="shrink-0" />Nenhum template encontrado neste canal. Clique em “Novo Template” para criar o primeiro.</div>}

      {(errorMessage || notice) && <p className={`text-xs rounded-lg p-3 ${errorMessage ? 'text-red-300 bg-red-500/10 border border-red-500/20' : 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'}`}>{errorMessage || notice}</p>}
    </section>
  );
};

export default ZernioTemplatesCard;
