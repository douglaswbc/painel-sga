import React from 'react';
import { X } from 'lucide-react';

export function Modal({ isOpen, onClose, title, subtitle, badge, children, size = 'max-w-lg' }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 backdrop-blur-sm animate-in fade-in duration-200 px-4 py-8 sm:py-10">
      <div className={`mx-auto w-full ${size} overflow-hidden rounded-[18px] border border-black/10 bg-white`}>
        <div className="flex items-center justify-between border-b border-black/10 bg-[#f5f5f7] p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-[#1d1d1f] sm:text-xl">{title}</h3>
              {subtitle && (
                <p className="mt-1 text-sm text-[#7a7a7a]">{subtitle}</p>
              )}
            </div>
            {badge}
          </div>
          <button onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#66666a] transition hover:bg-black/5 hover:text-[#1d1d1f]" aria-label="Fechar janela">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalBody({ children, className = '' }) {
  return <div className={`space-y-5 p-4 sm:p-6 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = '' }) {
  return (
    <div className={`flex flex-col-reverse justify-end gap-3 border-t border-black/10 pt-5 sm:flex-row ${className}`}>
      {children}
    </div>
  );
}
