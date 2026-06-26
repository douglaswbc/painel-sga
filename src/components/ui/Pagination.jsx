import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ currentPage, totalPages, onPrev, onNext, label }) {
  if (totalPages <= 1) return null;

  return (
    <div className="p-4 flex items-center justify-between">
      <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
        {label || `Página ${currentPage} / ${totalPages}`}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={currentPage === 1}
          className="p-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed rounded-xl text-zinc-300 transition-all border border-zinc-800 shadow-lg"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onNext}
          disabled={currentPage === totalPages}
          className="p-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed rounded-xl text-zinc-300 transition-all border border-zinc-800 shadow-lg"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
