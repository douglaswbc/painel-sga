import React from 'react';
import { Search } from 'lucide-react';

export function SearchInput({ value, onChange, placeholder = 'Buscar...', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
      <input
        type="text"
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 transition-all"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
