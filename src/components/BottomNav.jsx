import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  DollarSign,
  Car,
  Menu,
  Plus,
} from 'lucide-react';

export default function BottomNav({ onOpenMenu, onOpenQuickActions, counts }) {

  const atrasadas = counts?.cobrancasAtrasadas || 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-black/10 bg-white/95 px-2 backdrop-blur-xl md:hidden safe-area-pb">
      {/* 1. Dashboard */}
      <NavLink
        to="/dashboard"
        className={({ isActive }) => `
          flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition active:scale-95
          ${isActive ? 'text-[#0066cc]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'}
        `}
      >
        <LayoutDashboard size={20} />
        <span className="mt-1">Início</span>
      </NavLink>

      {/* 2. Cobranças */}
      <NavLink
        to="/cobrancas"
        className={({ isActive }) => `
          relative flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition active:scale-95
          ${isActive ? 'text-[#0066cc]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'}
        `}
      >
        <div className="relative">
          <DollarSign size={20} />
          {atrasadas > 0 && (
            <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
              {atrasadas > 9 ? '9+' : atrasadas}
            </span>
          )}
        </div>
        <span className="mt-1">Cobranças</span>
      </NavLink>

      {/* 3. Botão Central: Ação Rápida */}
      <button
        type="button"
        onClick={onOpenQuickActions}
        className="flex flex-col items-center justify-center px-2 active:scale-95"
        aria-label="Ações rápidas"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0066cc] text-white shadow-md shadow-[#0066cc]/25">
          <Plus size={22} />
        </div>
      </button>

      {/* 4. Veículos */}
      <NavLink
        to="/veiculos"
        className={({ isActive }) => `
          flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition active:scale-95
          ${isActive ? 'text-[#0066cc]' : 'text-[#7a7a7a] hover:text-[#1d1d1f]'}
        `}
      >
        <Car size={20} />
        <span className="mt-1">Veículos</span>
      </NavLink>

      {/* 5. Menu Completo (Abre Sidebar) */}
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium text-[#7a7a7a] hover:text-[#1d1d1f] transition active:scale-95"
        aria-label="Abrir menu completo"
      >
        <Menu size={20} />
        <span className="mt-1">Menu</span>
      </button>
    </nav>
  );
}
