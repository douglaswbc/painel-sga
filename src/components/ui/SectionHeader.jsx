import React from 'react';

export function SectionHeader({ children, className = '' }) {
  return (
    <h4 className={`text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] border-l-2 border-indigo-500 pl-3 ${className}`}>
      {children}
    </h4>
  );
}
