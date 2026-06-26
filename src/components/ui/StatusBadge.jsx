import React from 'react';

const statusColors = {
  ativo: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  pausado: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  pendente: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  pago: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  cancelado: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
  atrasado: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
  despesa: 'bg-red-500/10 text-red-500 border-red-500/20',
  receita: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  disponivel: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  alugado: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  indisponivel: 'bg-red-400/10 text-red-400 border-red-400/20',
};

export function StatusBadge({ status, children, className = '' }) {
  const color = statusColors[status?.toLowerCase()] || 'bg-zinc-800 text-zinc-400';
  return (
    <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-[0.15em] border ${color} ${className}`}>
      {children || status}
    </span>
  );
}
