import React from 'react';

export function Input({ icon: Icon, label, error, className = '', ...props }) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">{label}</label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
        )}
        <input
          className={`w-full bg-zinc-950 border rounded-xl px-4 py-3 text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all ${
            error ? 'border-red-500 ring-1 ring-red-500' : 'border-zinc-800'
          } ${Icon ? 'pl-12' : ''} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p className="text-[10px] text-red-500 font-bold flex items-center gap-1 uppercase mt-1">{error}</p>
      )}
    </div>
  );
}

export function Select({ icon: Icon, label, error, children, className = '', ...props }) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">{label}</label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
        )}
        <select
          className={`w-full bg-zinc-950 border rounded-xl px-4 py-3 text-zinc-100 outline-none focus:border-indigo-500 appearance-none transition-all ${
            error ? 'border-red-500' : 'border-zinc-800'
          } ${Icon ? 'pl-12' : ''} ${className}`}
          {...props}
        >
          {children}
        </select>
      </div>
    </div>
  );
}
