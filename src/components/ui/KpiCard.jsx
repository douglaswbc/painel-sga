import React from 'react';

export function KpiCard({ title, value, icon: Icon, bgIcon, desc, trend }) {
  return (
    <div className="flex h-full flex-col gap-5 rounded-[18px] border border-black/10 bg-white p-5 transition-colors hover:border-black/20 sm:p-6">
      <div className="flex items-center justify-between">
        {Icon && (
          <div className={`flex h-11 w-11 items-center justify-center rounded-full ${bgIcon || 'bg-indigo-500/10'}`}>
            <Icon size={20} className="text-indigo-600" />
          </div>
        )}
        {trend && (
          <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {trend}
          </div>
        )}
      </div>
      <div className="mt-auto">
        <div className="mb-2 text-2xl font-semibold leading-tight tracking-tight text-[#1d1d1f]">{value}</div>
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-[#333333]">{title}</div>
          {desc && (
            <div className="text-xs leading-5 text-[#7a7a7a]">{desc}</div>
          )}
        </div>
      </div>
    </div>
  );
}
