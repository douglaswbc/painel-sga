import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, CheckCircle2, FileText, Loader2, Plus, RefreshCw,
  Send, Smartphone, Trash2, X,
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
});

const getVariables = (text) => [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const hasUnsupportedVariableSyntax = (text) => {
  const textWithoutVariables = text.replace(/\{\{\d+\}\}/g, '');
  return textWithoutVariables.includes('{{') || textWithoutVariables.includes('}}');
};
const isSequential = (variables) => variables.every((value, index) => value === index + 1);

const getTemplateParameterSlots = (components = []) => {
  const ordered = [
    ...components.filter((component) => String(component.type).toUpperCase() === 'HEADER'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BODY'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BUTTONS'),
  ];
  const slots = [];
  for (const component of ordered) {
    const type = String(component.type).toUpperCase();
    const texts = type === 'BUTTONS'
      ? (component.buttons || []).map((button, index) => ({ text: button.url, label: `Botão de site ${index + 1}` }))
      : [{ text: component.text, label: type === 'HEADER' ? 'Cabeçalho' : 'Corpo' }];
    for (const item of texts) {
      const variables = [...new Set([...(String(item.text || '').matchAll(/\{\{(\d+)\}\}/g))].map((match) => Number(match[1])))].sort((a, b) => a - b);
      for (const variable of variables) slots.push({ position: slots.length + 1, variable, label: `${item.label} · variável {{${variable}}}` });
    }
  }
  return slots;
};

const usageFields = {
  charge: [
    ['tenant_first_name', 'Primeiro nome do locatário'],
    ['amount', 'Valor da cobrança'],
    ['due_date', 'Data de vencimento'],
    ['payment_link', 'Link PIX da cobrança'],
  ],
  payment_confirmation: [
    ['tenant_first_name', 'Primeiro nome do locatário'],
    ['amount', 'Valor pago'],
    ['paid_at', 'Data do pagamento'],
  ],
};

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

function highlightTemplateVariables(text) {
  return String(text || '').split(/(\{\{\d+\}\})/g).map((part, index) => (
    /^\{\{\d+\}\}$/.test(part)
      ? <span key={`${part}-${index}`} className="rounded bg-indigo-500/20 px-1 font-bold text-indigo-200">{part}</span>
      : <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
  ));
}

function TemplateAssociationPreview({ template }) {
  const components = template.components || [];
  const header = components.find((component) => String(component.type).toUpperCase() === 'HEADER');
  const body = components.find((component) => String(component.type).toUpperCase() === 'BODY');
  const footer = components.find((component) => String(component.type).toUpperCase() === 'FOOTER');
  const buttons = components.find((component) => String(component.type).toUpperCase() === 'BUTTONS')?.buttons || [];
  const headerFormat = String(header?.format || '').toUpperCase();
  const mediaLabel = { IMAGE: 'Imagem', VIDEO: 'Vídeo', DOCUMENT: 'Documento', LOCATION: 'Localização' }[headerFormat];

  return (
    <aside className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-300"><Smartphone size={15} className="text-emerald-400" />Prévia do template</div>
      <div className="apple-dark-preview mx-auto max-w-sm rounded-[1.5rem] border border-slate-700 bg-[#e5ddd5] p-3 shadow-inner">
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"><span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-100 text-emerald-800">WA</span>WhatsApp</div>
        <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-white p-3 text-sm leading-relaxed text-slate-800 shadow-sm">
          {header && <div className="mb-2 font-semibold">{header.text ? highlightTemplateVariables(header.text) : <span className="text-slate-500">[{mediaLabel || 'Cabeçalho de mídia'}]</span>}</div>}
          <div className="whitespace-pre-wrap">{body?.text ? highlightTemplateVariables(body.text) : <span className="text-slate-500">O corpo do template aparecerá aqui.</span>}</div>
          {footer?.text && <div className="mt-2 text-xs text-slate-500">{footer.text}</div>}
          <div className="mt-1 text-right text-[10px] text-slate-400">Agora</div>
        </div>
        {buttons.map((button, index) => <div key={`${button.type}-${index}`} className="mx-auto mt-1 max-w-[92%] rounded-lg bg-white px-3 py-2 text-center text-xs font-semibold text-blue-600 shadow-sm">{button.text || `Botão ${index + 1}`}{button.url ? <span className="block truncate text-[10px] font-normal text-slate-500">{highlightTemplateVariables(button.url)}</span> : null}</div>)}
        {!buttons.length && <p className="mt-2 px-1 text-[10px] text-slate-500">As variáveis destacadas são substituídas pelos campos associados ao lado.</p>}
      </div>
    </aside>
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
    onSubmit({
      name: draft.name.trim(), category: draft.category, language: draft.language,
      components: buildComponents(),
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

        <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-[11px] text-slate-400">Depois que a Meta aprovar o template, você poderá selecioná-lo para lembretes de cobrança ou confirmações de pagamento e associar cada variável aos dados correspondentes.</p>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
          {!formIsValid && <p className="mr-auto self-center text-[11px] text-slate-500">Preencha os campos obrigatórios e corrija os limites para enviar.</p>}
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy || !formIsValid} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"><Send size={15} />{busy ? 'Enviando...' : 'Enviar para Análise'}</button>
        </div>
      </div>

      <aside className="apple-dark-preview h-fit xl:sticky xl:top-4">
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
  const [selection, setSelection] = useState(null);
  const [variableMapping, setVariableMapping] = useState([]);
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

  const configureDefault = (template, purpose) => {
    const slots = getTemplateParameterSlots(template.components || []);
    const availableFields = usageFields[purpose];
    const existing = template.usages?.find((usage) => usage.purpose === purpose)?.variable_mapping || [];
    const mapping = slots.map((slot, index) => {
      const savedField = existing.find((item) => Number(item.position) === slot.position)?.field;
      const field = availableFields.some(([value]) => value === savedField)
        ? savedField
        : availableFields[index % availableFields.length][0];
      return { position: slot.position, field };
    });
    setSelection({ template, purpose, slots });
    setVariableMapping(mapping);
    setErrorMessage('');
    setNotice('');
  };

  const setDefault = async () => {
    if (!selection) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('set_default', {
        templateId: selection.template.id,
        purpose: selection.purpose,
        variableMapping,
      });
      setTemplates(data.templates || []);
      setSelection(null);
      setNotice(selection.purpose === 'charge'
        ? 'Template adicionado à sequência de lembretes.'
        : 'Template aprovado selecionado para as confirmações de pagamento.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const chargeSequence = useMemo(() => templates
    .map((template) => ({
      template,
      usage: template.usages?.find((usage) => usage.purpose === 'charge' && usage.is_default),
    }))
    .filter((item) => item.usage)
    .sort((a, b) => Number(a.usage.reminder_order || 1) - Number(b.usage.reminder_order || 1)), [templates]);

  const saveChargeSequence = async (templateIds) => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const data = await invoke('save_charge_order', { templateIds });
      setTemplates(data.templates || []);
      setNotice(templateIds.length
        ? 'Sequência de lembretes salva. Os templates serão enviados na ordem definida e a sequência se repetirá até o pagamento ou a expiração do PIX.'
        : 'Todos os templates foram removidos da sequência de lembretes.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const moveChargeTemplate = (index, direction) => {
    const next = [...chargeSequence];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    saveChargeSequence(next.map((item) => item.template.id));
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
          <p className="text-xs text-slate-400 mt-2">Crie os modelos, acompanhe a análise da Meta e escolha templates aprovados para cobranças e confirmações de pagamento.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => refresh(true)} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-2"><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />Atualizar</button>
          {!showForm && <button type="button" onClick={() => { setErrorMessage(''); setNotice(''); setShowForm(true); }} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2"><Plus size={15} />Novo Template</button>}
        </div>
      </div>

      {showForm && <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 md:p-5"><TemplateForm busy={busy} storageKey={draftStorageKey} onCancel={cancelTemplate} onSubmit={createTemplate} /></div>}

      {!showForm && <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300">Como funcionam os templates</h3>
        <p className="text-xs text-slate-400">Adicione vários templates aprovados aos lembretes, ordene a sequência e associe as variáveis aos dados do SGA. A sequência se repete até o pagamento ou a expiração do PIX.</p>
      </div>}

      {!showForm && <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-xs font-bold uppercase tracking-wide text-indigo-200">Sequência de lembretes</h3><p className="mt-1 text-[11px] text-slate-400">Cada novo lembrete usa o próximo modelo. Depois do último, a sequência recomeça.</p></div><span className="rounded-full bg-indigo-500/10 px-2 py-1 text-[10px] font-bold text-indigo-200">{chargeSequence.length} selecionado(s)</span></div>
        {chargeSequence.length ? <ol className="space-y-2">{chargeSequence.map(({ template }, index) => <li key={template.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-xs font-black text-indigo-200">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{template.name}<span className="ml-2 text-[10px] font-normal text-slate-500">{template.language}</span></span>
          <button type="button" disabled={busy || index === 0} onClick={() => moveChargeTemplate(index, -1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-800 disabled:opacity-30" title="Mover para cima" aria-label={`Mover ${template.name} para cima`}><ArrowUp size={14} /></button>
          <button type="button" disabled={busy || index === chargeSequence.length - 1} onClick={() => moveChargeTemplate(index, 1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-800 disabled:opacity-30" title="Mover para baixo" aria-label={`Mover ${template.name} para baixo`}><ArrowDown size={14} /></button>
          <button type="button" disabled={busy} onClick={() => saveChargeSequence(chargeSequence.filter((item) => item.template.id !== template.id).map((item) => item.template.id))} className="rounded p-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-30" title="Remover da sequência" aria-label={`Remover ${template.name} da sequência`}><Trash2 size={14} /></button>
        </li>)}</ol> : <p className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">Adicione templates aprovados usando o botão “Usar em lembretes”.</p>}
      </div>}

      {templates.length > 0 ? <div className="space-y-2">
        {templates.map((template) => {
          const status = String(template.status || 'PENDING').toUpperCase();
          const chargeUsage = template.usages?.find((usage) => usage.purpose === 'charge' && usage.is_default);
          const isChargeTemplate = Boolean(chargeUsage);
          const isPaymentTemplate = template.usages?.some((usage) => usage.purpose === 'payment_confirmation' && usage.is_default) || false;
          return <article key={template.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{template.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">{template.language}</span>
                <span className={`text-[10px] uppercase font-bold border rounded-full px-2 py-0.5 ${statusStyles[status] || statusStyles.PENDING}`}>{status}</span>
                {isChargeTemplate && <span className="inline-flex items-center rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-200">Lembrete {chargeUsage.reminder_order || 1}º</span>}
                {isPaymentTemplate && <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-200">Confirmação de pagamento</span>}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{template.category}{template.rejection_reason ? ` · ${template.rejection_reason}` : ''}</p>
            </div>
            {status === 'APPROVED' && <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => configureDefault(template, 'charge')} disabled={busy} className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-40 ${isChargeTemplate ? 'bg-emerald-600 text-white' : 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-300'}`}>
                {isChargeTemplate && <CheckCircle2 size={14} />}{isChargeTemplate ? `Editar lembrete ${chargeUsage.reminder_order || 1}º` : 'Usar em lembretes'}
              </button>
              <button type="button" onClick={() => configureDefault(template, 'payment_confirmation')} disabled={busy} className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-40 ${isPaymentTemplate ? 'bg-sky-600 text-white' : 'bg-sky-600/10 hover:bg-sky-600/20 text-sky-300'}`}>
                {isPaymentTemplate && <CheckCircle2 size={14} />}{isPaymentTemplate ? 'Confirmação selecionada' : 'Usar em confirmações'}
              </button>
            </div>}
          </article>;
        })}
      </div> : <div className="flex items-start gap-3 text-xs text-slate-500 bg-slate-900/40 border border-slate-800 rounded-lg p-3"><AlertCircle size={16} className="shrink-0" />Nenhum template encontrado neste canal. Clique em “Novo Template” para criar o primeiro.</div>}

      {selection && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelection(null); }}>
        <form onSubmit={(event) => { event.preventDefault(); setDefault(); }} className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white">Configurar uso do template</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2"><p className="text-xs text-slate-400">{selection.template.name}</p><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${selection.purpose === 'charge' ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200' : 'border-sky-400/30 bg-sky-500/10 text-sky-200'}`}>{selection.purpose === 'charge' ? 'Lembrete de cobrança' : 'Confirmação de pagamento'}</span></div>
            </div>
            <button type="button" onClick={() => setSelection(null)} disabled={busy} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar"><X size={18} /></button>
          </div>
          <p className="mt-4 text-xs text-slate-400">Associe cada variável do template a uma informação do SGA. O mapeamento define os valores enviados em cada mensagem.</p>
          <div className="mt-4 grid gap-5 lg:grid-cols-2 lg:items-start">
            <div>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-300">Associação das variáveis</h4>
              {selection.slots.length ? <div className="space-y-3">{selection.slots.map((slot, index) => <label key={`${slot.position}-${slot.label}`} className="block rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="mb-2 block text-xs font-semibold text-slate-300"><span className="mr-1 rounded bg-indigo-500/20 px-1 font-mono text-indigo-200">{`{{${slot.variable}}}`}</span>{slot.label}</span>
                <select value={variableMapping[index]?.field || ''} onChange={(event) => setVariableMapping((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value } : item))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                  {usageFields[selection.purpose].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>)}</div> : <p className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">Este template não tem variáveis. Ele será enviado sem parâmetros dinâmicos.</p>}
            </div>
            <TemplateAssociationPreview template={selection.template} />
          </div>
          <p className="mt-4 text-[11px] text-slate-500">{selection.purpose === 'charge' ? 'Este template será incluído na sequência de lembretes. Ajuste a ordem na lista acima.' : 'Este template será usado nas confirmações de pagamento deste locador.'}</p>
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-800 pt-4">
            <button type="button" onClick={() => setSelection(null)} disabled={busy} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>
            <button type="submit" disabled={busy || variableMapping.some((item) => !item.field)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar seleção'}</button>
          </div>
        </form>
      </div>}

      {(errorMessage || notice) && <p className={`text-xs rounded-lg p-3 ${errorMessage ? 'text-red-300 bg-red-500/10 border border-red-500/20' : 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'}`}>{errorMessage || notice}</p>}
    </section>
  );
};

export default ZernioTemplatesCard;
