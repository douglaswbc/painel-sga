import React, { useId } from 'react';

export function Input({ icon: Icon, label, error, className = '', ...props }) {
  const generatedId = useId();
  const controlId = props.id || generatedId;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={controlId} className="text-sm font-semibold text-[#333333]">{label}</label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a]" size={18} />
        )}
        <input
          id={controlId}
          className={`min-h-11 w-full rounded-lg border border-[#e0e0e0] bg-white px-3.5 py-2.5 text-sm text-[#1d1d1f] outline-none transition focus:border-[#0066cc] focus:ring-2 focus:ring-[#0066cc]/15 ${
            error ? 'border-red-500 ring-2 ring-red-500/15' : ''
          } ${Icon ? 'pl-11' : ''} ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${controlId}-error` : undefined}
          {...props}
        />
      </div>
      {error && (
        <p id={`${controlId}-error`} className="mt-1 flex items-center gap-1 text-sm font-medium text-red-700">{error}</p>
      )}
    </div>
  );
}

export function Select({ icon: Icon, label, error, children, className = '', ...props }) {
  const generatedId = useId();
  const controlId = props.id || generatedId;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={controlId} className="text-sm font-semibold text-[#333333]">{label}</label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a]" size={18} />
        )}
        <select
          id={controlId}
          className={`min-h-11 w-full appearance-none rounded-lg border border-[#e0e0e0] bg-white px-3.5 py-2.5 text-sm text-[#1d1d1f] outline-none transition focus:border-[#0066cc] focus:ring-2 focus:ring-[#0066cc]/15 ${
            error ? 'border-red-500' : ''
          } ${Icon ? 'pl-11' : ''} ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${controlId}-error` : undefined}
          {...props}
        >
          {children}
        </select>
      </div>
      {error && <p id={`${controlId}-error`} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}
