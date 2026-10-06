import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { candidatosService } from '../services/candidatos';

const formatDate = (value) => value ? new Date(value).toLocaleString('pt-BR') : '—';
const formatBoolean = (value) => value == null ? 'Não informado' : value ? 'Sim' : 'Não';
const formatMoney = (value) => value == null ? '—' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const Field = ({ label, value }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 break-words text-sm text-slate-200">{value ?? 'Não informado'}</p>
  </div>
);

const CandidatoDetalheModal = ({ candidato, onClose }) => {
  const [history, setHistory] = useState({ audit: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await candidatosService.getReservationHistory(candidato.id));
    } catch {
      setError('Não foi possível carregar o histórico. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [candidato.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (!candidato) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="candidate-details-title" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-card p-5 shadow-2xl md:p-7">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Ficha do candidato</p>
            <h2 id="candidate-details-title" className="mt-1 truncate text-xl font-bold text-white">{candidato.nome}</h2>
            <p className="mt-1 text-xs text-slate-500">Cadastrado em {formatDate(candidato.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar ficha"><X size={20} /></button>
        </header>

        <div className="mt-5 space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-200">Dados do candidato</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="CPF" value={candidato.cpf || 'Não informado'} />
              <Field label="Telefone" value={candidato.telefone} />
              <Field label="E-mail" value={candidato.email} />
              <Field label="Faixa etária" value={candidato.idade_faixa} />
              <Field label="Trabalha com aplicativo" value={formatBoolean(candidato.trabalha_em_app)} />
              <Field label="Possui tomada 220V" value={formatBoolean(candidato.tem_220v)} />
              <Field label="Caução disponível" value={candidato.caucao_disponivel} />
              <Field label="Processos criminais declarados" value={formatBoolean(candidato.possui_processos_criminais)} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-200">Análise e reserva</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Status do candidato" value={candidato.status} />
              <Field label="Pontuação do formulário" value={candidato.score_formulario} />
              <Field label="Pontuação de crédito" value={candidato.score_credito} />
              <Field label="Status do pagamento" value={candidato.pagamento_status} />
              <Field label="ID do pagamento" value={candidato.pagamento_id} />
              <Field label="PIX válido até" value={formatDate(candidato.reserva_expira_em)} />
              <Field label="Reserva confirmada em" value={formatDate(candidato.reserva_confirmada_em)} />
              <Field label="Atualizado em" value={formatDate(candidato.updated_at)} />
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-200">Histórico de pagamentos e alterações</h3>
              {loading && <Loader2 size={16} className="animate-spin text-indigo-400" />}
            </div>
            {error ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-200">
                <span className="flex items-center gap-2"><AlertCircle size={16} />{error}</span>
                <button type="button" onClick={loadHistory} className="font-semibold underline">Tentar novamente</button>
              </div>
            ) : loading ? (
              <p className="text-sm text-slate-500">Carregando histórico…</p>
            ) : history.audit.length === 0 && history.payments.length === 0 ? (
              <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-500">Ainda não há alterações registradas para este candidato.</p>
            ) : (
              <div className="space-y-4">
                {history.payments.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tentativas PIX</h4>
                    {history.payments.map((payment) => (
                      <article key={payment.id} className="rounded-xl border border-slate-800 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-semibold text-slate-200">{payment.status}</span>
                          <span className="text-xs text-slate-500">Criado em {formatDate(payment.criado_em)}</span>
                        </div>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500">Pagamento {payment.mercado_pago_id}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatMoney(payment.valor)}{payment.status_detalhe ? ` · ${payment.status_detalhe}` : ''}</p>
                      </article>
                    ))}
                  </div>
                )}

                {history.audit.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Alterações</h4>
                    {history.audit.map((entry) => (
                      <article key={entry.id} className="rounded-xl border border-slate-800 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-200">
                            {entry.acao === 'confirmacao_manual' ? 'Confirmação manual' : entry.acao === 'atualizacao_pagamento' ? 'Atualização do pagamento' : 'Mudança de status'}
                          </span>
                          <span className="text-xs text-slate-500">{formatDate(entry.criado_em)}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">Status: {entry.status_anterior || '—'} → {entry.status_novo || '—'}</p>
                        {(entry.pagamento_status_anterior || entry.pagamento_status_novo) && (
                          <p className="mt-1 text-xs text-slate-400">Pagamento: {entry.pagamento_status_anterior || '—'} → {entry.pagamento_status_novo || '—'}</p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">Origem: {entry.origem === 'sistema' ? 'automática' : 'operador'}{entry.motivo ? ` · ${entry.motivo}` : ''}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
};

export default CandidatoDetalheModal;
