import React from 'react';

const variants = {
  primary: 'bg-[#0066cc] hover:bg-[#005ab4] text-white focus-visible:outline-[#0071e3]',
  secondary: 'bg-transparent text-[#0066cc] border border-[#0066cc] hover:bg-blue-50',
  ghost: 'text-[#0066cc] hover:bg-blue-50',
  danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100',
};

const sizes = {
  sm: 'min-h-10 px-4 text-sm',
  md: 'min-h-11 px-5 text-sm',
  lg: 'min-h-12 px-6 text-base',
};

export function Button({ variant = 'primary', size = 'md', icon: Icon, children, className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full font-normal transition-transform duration-150 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}
