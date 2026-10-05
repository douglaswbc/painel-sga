import React from 'react';

export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="py-20 text-center">
      {Icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
          <Icon className="text-indigo-600" size={24} />
        </div>
      )}
      <p className="mb-1 text-sm font-semibold text-zinc-800">{title}</p>
      {description && (
        <p className="text-sm leading-5 text-zinc-500">{description}</p>
      )}
    </div>
  );
}
