import React from 'react';

export function PageHeader({ icon: Icon, title, description, actions }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0066cc]/10 text-[#0066cc]">
            <Icon size={20} />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f] sm:text-[28px]">{title}</h1>
          {description && (
            <p className="mt-1 text-sm leading-5 text-[#7a7a7a]">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
