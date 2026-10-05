import React from 'react';

const statusColors = {
  ativo: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pausado: 'bg-amber-50 text-amber-800 border-amber-200',
  pendente: 'bg-amber-50 text-amber-800 border-amber-200',
  pago: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelado: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  atrasado: 'bg-rose-50 text-rose-800 border-rose-200',
  despesa: 'bg-red-50 text-red-800 border-red-200',
  receita: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  disponivel: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  alugado: 'bg-amber-50 text-amber-800 border-amber-200',
  indisponivel: 'bg-red-50 text-red-800 border-red-200',
};

export function StatusBadge({ status, children, className = '' }) {
  const color = statusColors[status?.toLowerCase()] || 'bg-zinc-800 text-zinc-400';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${color} ${className}`}>
      {children || status}
    </span>
  );
}
