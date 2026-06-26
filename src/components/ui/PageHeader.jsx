import React from 'react';

export function PageHeader({ icon: Icon, title, description, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-500">
            <Icon size={24} />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm text-zinc-500 font-medium">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
