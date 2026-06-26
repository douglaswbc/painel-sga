import React from 'react';
import { Loader2 } from 'lucide-react';

export function Table({ children, className = '' }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl hidden md:block ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">{children}</table>
      </div>
    </div>
  );
}

export function Thead({ children }) {
  return (
    <thead className="text-[10px] uppercase bg-zinc-950/50 text-zinc-500 border-b border-zinc-800 font-black tracking-widest">
      {children}
    </thead>
  );
}

export function Tbody({ children }) {
  return <tbody className="divide-y divide-zinc-800/50">{children}</tbody>;
}

export function Td({ children, className = '' }) {
  return <td className={`px-6 py-4 ${className}`}>{children}</td>;
}

export function Th({ children, className = '' }) {
  return <th className={`px-6 py-5 ${className}`}>{children}</th>;
}

export function LoadingRow({ colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-20 text-center">
        <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} />
      </td>
    </tr>
  );
}
