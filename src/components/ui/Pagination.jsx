import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ currentPage, totalPages, onPrev, onNext, label }) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <span className="text-sm text-zinc-500">
        {label || `Página ${currentPage} / ${totalPages}`}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={currentPage === 1}
          aria-label="Página anterior"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-white text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onNext}
          disabled={currentPage === totalPages}
          aria-label="Próxima página"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-white text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
