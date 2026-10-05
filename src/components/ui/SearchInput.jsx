import React from 'react';
import { Search } from 'lucide-react';

export function SearchInput({ value, onChange, placeholder = 'Buscar...', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7a7a7a]" size={17} />
      <input
        type="text"
        placeholder={placeholder}
        className="min-h-11 w-full rounded-full border border-[#e0e0e0] bg-white py-2.5 pl-11 pr-4 text-sm text-[#1d1d1f] outline-none transition focus:border-[#0066cc] focus:ring-2 focus:ring-[#0066cc]/15"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
