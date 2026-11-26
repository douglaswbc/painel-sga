import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader2, Send, ShieldCheck, Zap } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { candidatosService } from '../services/candidatos';

const initialAnswers = {
  nome: '', cpf: '', telefone: '', email: '', idade_faixa: '',
  tem_220v: null, trabalha_em_app: null, caucao_disponivel: '', possui_processos_criminais: null,
  interesse: '', observacoes: '',
};

const CandidateApplication = () => {
  const { token } = useParams();
  const startedAt = useRef(Date.now());
  const [answers, setAnswers] = useState(initialAnswers);
  const [meta, setMeta] = useState({ loaded: false, empresa_nome: null, segmento: 'geral' });
  const [privacyNoticeRead, setPrivacyNoticeRead] = useState(false);
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    candidatosService
      .getPublicApplicationMeta(token)
      .then((res) => {
        if (!active) return;
        setMeta({
          loaded: true,
          empresa_nome: res?.empresa_nome || null,
          segmento: res?.segmento || 'geral',
        });
      })
      .catch(() => {
        if (active) setMeta((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      active = false;
    };
  }, [token]);

  const isVehicles = meta.segmento === 'veiculos';

  const setAnswer = (field) => (event) => setAnswers((current) => ({ ...current, [field]: event.target.value }));
  const setBooleanAnswer = (field) => (event) => setAnswers((current) => ({
    ...current,
    [field]: event.target.value === '' ? null : event.target.value === 'true',
  }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!privacyNoticeRead) {
      setError('Leia e confirme o aviso de privacidade para enviar sua inscrição.');
      return;
    }

    setLoading(true);
    try {
      const payloadAnswers = {
        ...answers,
        respostas_extras:
          answers.interesse || answers.observacoes
            ? {
                ...(answers.interesse ? { interesse: answers.interesse } : {}),
                ...(answers.observacoes ? { observacoes: answers.observacoes } : {}),
              }
            : undefined,
      };
      await candidatosService.submitApplication(token, payloadAnswers, startedAt.current, privacyNoticeRead, website);
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError.message || 'Não foi possível enviar sua inscrição. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <section className="w-full max-w-lg rounded-3xl border border-emerald-500/20 bg-slate-900 p-8 text-center shadow-2xl">
          <CheckCircle className="mx-auto h-12 w-12 text-emerald-400" />
          <h1 className="mt-5 text-2xl font-bold">Inscrição enviada</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">O responsável pela oportunidade recebeu seus dados e poderá entrar em contato pelos meios informados.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300"><Zap size={22} /></span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">
            {meta.empresa_nome ? `Ficha de cadastro · ${meta.empresa_nome}` : 'Ficha de cadastro'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Conte-nos um pouco sobre você</h1>
          <p className="mt-2 text-sm text-slate-400">Preencha seus dados para que o responsável possa analisar sua solicitação.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Nome completo *</span>
              <input required minLength={3} maxLength={120} autoComplete="name" value={answers.nome} onChange={setAnswer('nome')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium text-slate-300">CPF *</span>
              <input required inputMode="numeric" autoComplete="off" maxLength={14} value={answers.cpf} onChange={setAnswer('cpf')} placeholder="000.000.000-00" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Telefone com DDD *</span>
              <input required type="tel" inputMode="tel" autoComplete="tel" minLength={10} maxLength={16} value={answers.telefone} onChange={setAnswer('telefone')} placeholder="(11) 99999-9999" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">E-mail *</span>
              <input required type="email" maxLength={254} autoComplete="email" value={answers.email} onChange={setAnswer('email')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Faixa etária</span>
              <select value={answers.idade_faixa} onChange={setAnswer('idade_faixa')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500">
                <option value="">Selecione</option>
                <option value="18 a 24 anos">18 a 24 anos</option>
                <option value="25 a 34 anos">25 a 34 anos</option>
                <option value="35 a 44 anos">35 a 44 anos</option>
                <option value="45 anos ou mais">45 anos ou mais</option>
              </select>
            </label>
            {isVehicles ? (
              <>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">Trabalha com aplicativo?</span>
                  <select value={answers.trabalha_em_app == null ? '' : String(answers.trabalha_em_app)} onChange={setBooleanAnswer('trabalha_em_app')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500">
                    <option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">Tem tomada 220V disponível?</span>
                  <select value={answers.tem_220v == null ? '' : String(answers.tem_220v)} onChange={setBooleanAnswer('tem_220v')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500">
                    <option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">Possui processos criminais?</span>
                  <select value={answers.possui_processos_criminais == null ? '' : String(answers.possui_processos_criminais)} onChange={setBooleanAnswer('possui_processos_criminais')} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500">
                    <option value="">Prefiro não informar</option><option value="true">Sim</option><option value="false">Não</option>
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">Informações sobre caução disponível</span>
                  <textarea rows={3} maxLength={120} value={answers.caucao_disponivel} onChange={setAnswer('caucao_disponivel')} placeholder="Opcional" className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">Interesse / Plano / Item desejado</span>
                  <input maxLength={160} value={answers.interesse} onChange={setAnswer('interesse')} placeholder="Opcional" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">Observações adicionais</span>
                  <textarea rows={3} maxLength={240} value={answers.observacoes} onChange={setAnswer('observacoes')} placeholder="Compartilhe período desejado, dúvidas ou detalhes relevantes (opcional)" className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" />
                </label>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><ShieldCheck size={17} className="text-indigo-300" />Aviso de privacidade</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">Os dados desta inscrição serão enviados ao responsável pela oportunidade para análise da candidatura e contato sobre a vaga. A inscrição ficará visível na área de triagem desse responsável. Para tirar dúvidas ou solicitar correção dos dados, use o canal pelo qual recebeu este link.</p>
            <label className="mt-3 flex items-start gap-2.5 text-sm text-slate-300">
              <input type="checkbox" checked={privacyNoticeRead} onChange={(event) => setPrivacyNoticeRead(event.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-500" />
              <span>Li o aviso de privacidade acima. *</span>
            </label>
          </div>

          <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
            <label>Não preencha este campo<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-200">{error}</p>}

          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={17} />}
            Enviar inscrição
          </button>
          <p className="text-center text-[11px] text-slate-500">Os campos com * são obrigatórios.</p>
        </form>
      </div>
    </main>
  );
};

export default CandidateApplication;
