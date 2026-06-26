import React from 'react';
import { CheckCircle2 } from 'lucide-react';

const dayMapIndex = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export const getRecurrenceLabel = (rec) => {
  try {
    if (!rec) return 'N/A';
    if (typeof rec === 'string' && rec.startsWith('{')) {
      const config = JSON.parse(rec);
      const unitMap = { daily: 'dia(s)', weekly: 'semana(s)', monthly: 'mês(es)', yearly: 'ano(s)' };
      let label = `A cada ${config.intervalo} ${unitMap[config.frequencia] || 'vezes'}`;
      if (config.horario) label += ` às ${config.horario}`;
      if (config.frequencia === 'weekly' && config.dias?.length > 0) {
        const dayMap = { dom: 'Dom', sun: 'Dom', seg: 'Seg', mon: 'Seg', ter: 'Ter', tue: 'Ter', qua: 'Qua', wed: 'Qua', qui: 'Qui', thu: 'Qui', sex: 'Sex', fri: 'Sex', sab: 'Sáb', sat: 'Sáb' };
        const selectedDays = [...new Set(config.dias.map(d => dayMap[d.toLowerCase()]).filter(Boolean))];
        if (selectedDays.length > 0) label += ` (${selectedDays.join(', ')})`;
      }
      if (config.termina?.tipo === 'data' && config.termina.valor) {
        label += ` • Até ${new Date(config.termina.valor).toLocaleDateString('pt-BR')}`;
      } else if (config.termina?.tipo === 'ocorrencia' && config.termina.valor) {
        label += ` • Até ${config.termina.valor} cobranças`;
      } else if (config.termina?.tipo === 'periodo' && config.termina.valor) {
        const unitLabel = { s: 'semanas', m: 'meses', a: 'anos' }[config.termina.unidade] || 'período';
        label += ` • Durante ${config.termina.valor} ${unitLabel}`;
      }
      if (config.expiracao) label += ` • Expira em ${config.expiracao}h`;
      return label;
    }
    return rec.replace('@', ' às ').replace('@', ' ');
  } catch {
    return 'Recorrência customizada';
  }
};

export function contractSummary(formData) {
  if (!formData.data_inicio || !formData.recorrencia_config) return null;
  const config = formData.recorrencia_config;
  const startDate = new Date(formData.data_inicio + 'T00:00:00');
  let simulatedCount = 0;
  let lastDate = null;
  const selectedDayIndices = config.dias.map(d => dayMapIndex[d.toLowerCase()]);

  if (config.termina.tipo === 'nunca') return null;

  let checkDate = new Date(startDate);
  const safetyLimit = 2000;

  const advanceDate = () => {
    if (config.frequencia === 'daily') checkDate.setDate(checkDate.getDate() + config.intervalo);
    else if (config.frequencia === 'monthly') checkDate.setMonth(checkDate.getMonth() + config.intervalo);
    else if (config.frequencia === 'yearly') checkDate.setFullYear(checkDate.getFullYear() + config.intervalo);
  };

  const advanceWeek = () => {
    if (checkDate.getDay() === 6) {
      checkDate.setDate(checkDate.getDate() + (7 * (config.intervalo - 1)) + 1);
    } else {
      checkDate.setDate(checkDate.getDate() + 1);
    }
  };

  if (config.termina.tipo === 'ocorrencia') {
    const target = config.termina.valor || 1;
    while (simulatedCount < target && simulatedCount < safetyLimit) {
      if (config.frequencia === 'weekly') {
        if (selectedDayIndices.includes(checkDate.getDay())) { simulatedCount++; lastDate = new Date(checkDate); }
        advanceWeek();
      } else { simulatedCount++; lastDate = new Date(checkDate); advanceDate(); }
    }
  } else if (config.termina.tipo === 'data' || config.termina.tipo === 'periodo') {
    let endDate;
    if (config.termina.tipo === 'data') {
      endDate = new Date(config.termina.valor + 'T23:59:59');
    } else {
      endDate = new Date(startDate);
      const val = config.termina.valor || 1;
      if (config.termina.unidade === 's') endDate.setDate(endDate.getDate() + (val * 7));
      else if (config.termina.unidade === 'm') endDate.setMonth(endDate.getMonth() + val);
      else if (config.termina.unidade === 'a') endDate.setFullYear(endDate.getFullYear() + val);
      endDate.setHours(23, 59, 59);
    }
    while (checkDate <= endDate && simulatedCount < safetyLimit) {
      if (config.frequencia === 'weekly') {
        if (selectedDayIndices.includes(checkDate.getDay())) { simulatedCount++; lastDate = new Date(checkDate); }
        advanceWeek();
      } else { simulatedCount++; lastDate = new Date(checkDate); advanceDate(); }
    }
  }

  return {
    totalCharges: simulatedCount,
    estimatedEndDate: lastDate,
    totalValue: simulatedCount * (formData.valor || 0),
  };
}

export function RecurrenceConfig({ config, onChange, onClose }) {
  const updateConfig = (updates) => {
    onChange({ ...config, ...updates });
  };

  return (
    <div className="p-6 bg-zinc-950 border-2 border-indigo-500/30 rounded-3xl space-y-6 animate-in slide-in-from-top-4 duration-500">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-black text-white uppercase tracking-widest">Recorrência Personalizada</h4>
        <button type="button" onClick={onClose} className="text-[10px] font-black text-emerald-500 uppercase bg-emerald-500/10 px-4 py-2 rounded-xl hover:bg-emerald-500/20 transition-all">
          Concluído
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Ritmo da Cobrança (Intervalo)</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 focus-within:border-indigo-500 transition-all">
            <span className="text-[10px] font-black text-zinc-600 uppercase">A cada</span>
            <input
              type="number" min="1"
              className="w-16 bg-transparent text-white font-black outline-none"
              value={config.intervalo || 1}
              onChange={e => updateConfig({ intervalo: Number(e.target.value) })}
            />
            <select
              className="flex-1 bg-transparent text-zinc-300 font-bold outline-none appearance-none"
              value={config.frequencia || 'weekly'}
              onChange={e => updateConfig({ frequencia: e.target.value })}
            >
              <option value="daily">Dias</option>
              <option value="weekly">Semanas</option>
              <option value="monthly">Meses</option>
              <option value="yearly">Anos</option>
            </select>
          </div>
        </div>
      </div>

      {config.frequencia === 'weekly' && (
        <div className="space-y-3">
          <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Repetir às/aos</p>
          <div className="flex justify-between bg-zinc-900/50 p-2 rounded-2xl border border-zinc-800">
            {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].map((day, idx) => {
              const label = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][idx];
              const isSelected = config.dias?.includes(day);
              return (
                <button
                  key={day} type="button"
                  onClick={() => {
                    const currentDays = config.dias || [];
                    const newDays = isSelected ? currentDays.filter(d => d !== day) : [...currentDays, day];
                    onChange({ ...config, dias: newDays });
                  }}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black transition-all ${
                    isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 scale-110' : 'bg-transparent text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Termina</p>
        <div className="space-y-4">
          {[
            { tipo: 'nunca', label: 'Nunca' },
            { tipo: 'data', label: 'Em' },
            { tipo: 'ocorrencia', label: 'Após' },
          ].map(({ tipo, label }) => (
            <label key={tipo} className="flex items-center gap-4 cursor-pointer group">
              <input type="radio" className="hidden" checked={config.termina?.tipo === tipo}
                onChange={() => onChange({ ...config, termina: { tipo, valor: tipo === 'nunca' ? null : '' } })}
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                config.termina?.tipo === tipo ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-950'
              }`}>
                {config.termina?.tipo === tipo && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-in zoom-in duration-200" />}
              </div>
              <span className="text-xs font-bold text-zinc-400 group-hover:text-zinc-200 min-w-[20px]">{label}</span>
              {tipo === 'data' && (
                <input type="date" disabled={config.termina?.tipo !== 'data'}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 outline-none text-[10px] font-black disabled:opacity-30 focus:border-indigo-500 text-white"
                  value={config.termina?.tipo === 'data' ? config.termina?.valor || '' : ''}
                  onChange={e => onChange({ ...config, termina: { tipo: 'data', valor: e.target.value } })}
                />
              )}
              {tipo === 'ocorrencia' && (
                <div className="flex items-center gap-2">
                  <input type="number" disabled={config.termina?.tipo !== 'ocorrencia'}
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 outline-none text-[10px] font-black disabled:opacity-30 focus:border-indigo-500 text-white"
                    value={config.termina?.tipo === 'ocorrencia' ? config.termina?.valor : ''}
                    onChange={e => onChange({ ...config, termina: { tipo: 'ocorrencia', valor: Number(e.target.value) } })}
                  />
                  <span className="text-[9px] font-black text-zinc-500 uppercase tracking-tighter">ocorrências</span>
                </div>
              )}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ContractSummary({ summary }) {
  if (!summary) return null;
  return (
    <div className="p-5 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl space-y-3 animate-in fade-in zoom-in duration-300">
      <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
        <CheckCircle2 size={14} /> Resumo Financeiro Estimado
      </h5>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-0.5">
          <p className="text-[8px] text-zinc-500 font-black uppercase">Total de Cobranças</p>
          <p className="text-white font-black text-lg">{summary.totalCharges}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[8px] text-zinc-500 font-black uppercase">Valor Total do Contrato</p>
          <p className="text-emerald-400 font-black text-lg">R$ {summary.totalValue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
        </div>
        <div className="col-span-2 space-y-0.5 border-t border-indigo-500/10 pt-2">
          <p className="text-[8px] text-zinc-500 font-black uppercase">Término Estimado</p>
          <p className="text-zinc-300 font-bold text-sm">
            {summary.estimatedEndDate?.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>
    </div>
  );
}
