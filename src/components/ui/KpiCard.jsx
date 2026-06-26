import React from 'react';

export function KpiCard({ title, value, icon: Icon, bgIcon, desc, trend }) {
  return (
    <div className="bg-zinc-900 p-7 rounded-3xl border border-zinc-800 shadow-xl flex flex-col gap-6 group hover:border-indigo-500/40 transition-all duration-500 relative overflow-hidden h-full">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        {Icon && <Icon size={64} />}
      </div>
      <div className="flex items-center justify-between relative z-10">
        {Icon && (
          <div className={`p-4 rounded-2xl transition-transform group-hover:scale-110 duration-500 ${bgIcon || 'bg-indigo-500/20'}`}>
            <Icon size={28} className="text-indigo-400" />
          </div>
        )}
        {trend && (
          <div className="px-2 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] font-black rounded-lg border border-emerald-500/20">
            {trend}
          </div>
        )}
      </div>
      <div className="relative z-10 mt-auto">
        <div className="text-3xl font-black text-white tracking-tighter leading-none mb-2">{value}</div>
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{title}</div>
          {desc && (
            <div className="text-[9px] text-zinc-600 font-bold uppercase tracking-tight">{desc}</div>
          )}
        </div>
      </div>
    </div>
  );
}
