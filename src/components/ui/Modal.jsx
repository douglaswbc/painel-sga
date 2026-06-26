import React from 'react';
import { X } from 'lucide-react';

export function Modal({ isOpen, onClose, title, subtitle, badge, children, size = 'max-w-lg' }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/90 backdrop-blur-sm animate-in fade-in duration-200 py-10 px-4">
      <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl w-full ${size} shadow-2xl overflow-hidden ring-1 ring-white/10 mx-auto`}>
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-xl font-bold text-white">{title}</h3>
              {subtitle && (
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">{subtitle}</p>
              )}
            </div>
            {badge}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalBody({ children, className = '' }) {
  return <div className={`p-8 space-y-6 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = '' }) {
  return (
    <div className={`pt-8 border-t border-zinc-800 flex justify-end gap-4 ${className}`}>
      {children}
    </div>
  );
}
