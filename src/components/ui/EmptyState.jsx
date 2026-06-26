import React from 'react';

export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="py-20 text-center">
      {Icon && (
        <div className="bg-zinc-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon className="text-zinc-600" size={32} />
        </div>
      )}
      <p className="text-zinc-400 font-bold text-sm mb-1">{title}</p>
      {description && (
        <p className="text-zinc-600 text-xs">{description}</p>
      )}
    </div>
  );
}
