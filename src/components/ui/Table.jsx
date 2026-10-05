import React from 'react';
import { Loader2 } from 'lucide-react';

export function Table({ children, className = '' }) {
  return (
    <div className={`hidden overflow-hidden rounded-[18px] border border-black/10 bg-white md:block ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">{children}</table>
      </div>
    </div>
  );
}

export function Thead({ children }) {
  return (
    <thead className="border-b border-black/10 bg-[#f5f5f7] text-left text-xs font-semibold text-[#66666a]">
      {children}
    </thead>
  );
}

export function Tbody({ children }) {
  return <tbody className="divide-y divide-black/5">{children}</tbody>;
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
      <td colSpan={colSpan} className="py-16 text-center">
        <Loader2 className="mx-auto animate-spin text-indigo-600" size={26} />
      </td>
    </tr>
  );
}
